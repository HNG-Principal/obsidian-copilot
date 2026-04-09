import { type RerankResponse, type Youtube4llmResponse } from "@/LLMProviders/brevilabsClient";
import { getDecryptedKey } from "@/encryptionService";
import { logError, logInfo, logWarn } from "@/logger";
import {
  createWebSearchProvider,
  getWebSearchProviderSettings,
} from "@/services/webSearchProvider";
import { getSettings } from "@/settings/model";

const SUPADATA_TRANSCRIPT_URL = "https://api.supadata.ai/v1/transcript";
const SELF_HOST_RERANK_PATHS = ["/v0/rerank", "/rerank"];

/** Poll interval for Supadata async jobs (ms) */
const SUPADATA_POLL_INTERVAL = 2000;
/** Maximum time to wait for a Supadata async job (ms) */
const SUPADATA_POLL_TIMEOUT = 60000;

/** Clean web search result — no legacy Perplexity wrapper */
export interface SelfHostWebSearchResult {
  content: string;
  citations: string[];
}

interface SelfHostRerankItem {
  index: number;
  relevance_score?: number;
  score?: number;
}

interface SelfHostRerankPayload {
  response?: RerankResponse["response"];
  results?: SelfHostRerankItem[];
  data?: SelfHostRerankItem[];
  model?: string;
  usage?: {
    total_tokens?: number;
  };
  elapsed_time_ms?: number;
}

/**
 * Check whether the currently selected self-host search provider has an API key configured.
 */
export function hasSelfHostSearchKey(): boolean {
  const settings = getSettings();
  switch (settings.webSearchProvider) {
    case "searxng":
      return !!settings.searxngUrl;
    case "perplexity":
      return !!settings.perplexityApiKey;
    case "firecrawl":
    default:
      return !!settings.firecrawlApiKey;
  }
}

/**
 * Dispatch self-host web search to the provider selected in settings.
 * Returns content + citations directly without the legacy Perplexity wrapper.
 */
export async function selfHostWebSearch(query: string): Promise<SelfHostWebSearchResult> {
  const provider = createWebSearchProvider(getWebSearchProviderSettings());
  const response = await provider.search(query, 5);
  const citations = response.results.map((result) => result.url).filter(Boolean);
  const content = response.results
    .map(
      (result) => `### ${result.title}\n${result.content || result.snippet}\nSource: ${result.url}`
    )
    .join("\n\n");
  logInfo(`[selfHostWebSearch] ${response.provider}: ${response.results.length} results`);
  return { content, citations };
}

/**
 * Re-rank search results using the configured self-host backend.
 */
export async function selfHostRerank(query: string, documents: string[]): Promise<RerankResponse> {
  const settings = getSettings();
  const baseUrl = settings.selfHostUrl?.trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Self-host rerank requires a configured self-host URL");
  }

  const authorization = await resolveSelfHostAuthorizationHeader();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authorization ? { Authorization: authorization } : {}),
  };
  const body = JSON.stringify({
    query,
    documents,
    model: "rerank-2",
  });

  let lastError: Error | null = null;
  for (const path of SELF_HOST_RERANK_PATHS) {
    const endpoint = `${baseUrl}${path}`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 404 || response.status === 405) {
          logWarn(`[selfHostRerank] Endpoint unavailable at ${endpoint}: ${response.status}`);
          lastError = new Error(`Self-host rerank failed (${response.status}): ${text}`);
          continue;
        }
        throw new Error(`Self-host rerank failed (${response.status}): ${text}`);
      }

      const payload = (await response.json()) as SelfHostRerankPayload;
      const normalized = normalizeSelfHostRerankPayload(payload);
      logInfo(`[selfHostRerank] reranked ${documents.length} documents via ${endpoint}`);
      return normalized;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (path !== SELF_HOST_RERANK_PATHS[SELF_HOST_RERANK_PATHS.length - 1]) {
        continue;
      }
    }
  }

  throw lastError ?? new Error("Self-host rerank failed");
}

/**
 * YouTube transcript via Supadata direct API (self-host mode).
 * Returns the same Youtube4llmResponse shape as BrevilabsClient.youtube4llm().
 */
export async function selfHostYoutube4llm(url: string): Promise<Youtube4llmResponse> {
  const startTime = Date.now();
  const apiKey = await getDecryptedKey(getSettings().supadataApiKey);

  const transcriptUrl = `${SUPADATA_TRANSCRIPT_URL}?url=${encodeURIComponent(url)}&mode=auto&text=true`;

  const response = await fetch(transcriptUrl, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });

  if (response.status === 200) {
    const json = await response.json();
    const elapsed = Date.now() - startTime;
    logInfo(`[selfHostYoutube4llm] transcript received in ${elapsed}ms`);
    return {
      response: { transcript: json.content || "" },
      elapsed_time_ms: elapsed,
    };
  }

  if (response.status === 201 || response.status === 202) {
    const json = await response.json();
    const jobId = json.job_id;
    if (!jobId) {
      throw new Error("Supadata returned async status but no job_id");
    }
    return await pollSupadataJob(jobId, apiKey, startTime);
  }

  const text = await response.text();
  throw new Error(`Supadata transcript request failed (${response.status}): ${text}`);
}

/**
 * Poll a Supadata async transcript job until it completes or times out.
 */
async function pollSupadataJob(
  jobId: string,
  apiKey: string,
  startTime: number
): Promise<Youtube4llmResponse> {
  const deadline = Date.now() + SUPADATA_POLL_TIMEOUT;
  const pollUrl = `${SUPADATA_TRANSCRIPT_URL}/${jobId}`;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SUPADATA_POLL_INTERVAL));

    const pollResponse = await fetch(pollUrl, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    });

    if (pollResponse.status === 200) {
      const json = await pollResponse.json();
      const elapsed = Date.now() - startTime;
      logInfo(`[selfHostYoutube4llm] async transcript completed in ${elapsed}ms`);
      return {
        response: { transcript: json.content || "" },
        elapsed_time_ms: elapsed,
      };
    }

    if (pollResponse.status === 202) {
      continue;
    }

    const text = await pollResponse.text();
    logError(`[selfHostYoutube4llm] poll failed (${pollResponse.status}): ${text}`);
    throw new Error(`Supadata poll failed (${pollResponse.status}): ${text}`);
  }

  throw new Error(`Supadata transcript timed out after ${SUPADATA_POLL_TIMEOUT}ms`);
}

async function resolveSelfHostAuthorizationHeader(): Promise<string | null> {
  const settings = getSettings();
  const rawKey = settings.selfHostApiKey || settings.plusLicenseKey;
  if (!rawKey) {
    return null;
  }

  const decryptedKey = await getDecryptedKey(rawKey);
  if (!decryptedKey) {
    return null;
  }

  return `Bearer ${decryptedKey}`;
}

function normalizeSelfHostRerankPayload(payload: SelfHostRerankPayload): RerankResponse {
  if (payload.response?.data) {
    return {
      response: payload.response,
      elapsed_time_ms: payload.elapsed_time_ms ?? 0,
    };
  }

  const items = payload.results ?? payload.data ?? [];
  return {
    response: {
      object: "list",
      data: items.map((item) => ({
        index: item.index,
        relevance_score: item.relevance_score ?? item.score ?? 0,
      })),
      model: payload.model ?? "self-host-rerank",
      usage: {
        total_tokens: payload.usage?.total_tokens ?? 0,
      },
    },
    elapsed_time_ms: payload.elapsed_time_ms ?? 0,
  };
}
