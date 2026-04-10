import { getDecryptedKey } from "@/encryptionService";
import { logInfo } from "@/logger";
import {
  IWebSearchProvider,
  WebSearchProviderSettings,
  WebSearchProviderType,
  WebSearchResponse,
  WebSearchResult,
} from "@/services/webContextTypes";
import { getSettings } from "@/settings/model";
import { safeFetchNoThrow } from "@/utils";

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const PERPLEXITY_CHAT_URL = "https://api.perplexity.ai/chat/completions";

interface WebSearchProviderDependencies {
  fetchImpl: typeof safeFetchNoThrow;
  decryptKey: typeof getDecryptedKey;
  now: () => number;
}

const defaultDependencies: WebSearchProviderDependencies = {
  fetchImpl: safeFetchNoThrow,
  decryptKey: getDecryptedKey,
  now: () => Date.now(),
};

interface FirecrawlSearchResult {
  title?: string;
  description?: string;
  url?: string;
}

interface SearxngSearchResult {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
}

abstract class BaseWebSearchProvider implements IWebSearchProvider {
  readonly providerType: WebSearchProviderType;

  protected constructor(
    providerType: WebSearchProviderType,
    protected readonly settings: WebSearchProviderSettings,
    protected readonly dependencies: WebSearchProviderDependencies
  ) {
    this.providerType = providerType;
  }

  abstract search(query: string, maxResults: number): Promise<WebSearchResponse>;

  protected async readJson(response: Response): Promise<any> {
    const payload = await response.json();
    return typeof payload === "string" ? JSON.parse(payload) : payload;
  }

  protected buildResponse(
    query: string,
    results: WebSearchResult[],
    summary?: string
  ): WebSearchResponse {
    return {
      query,
      results,
      provider: this.providerType,
      timestamp: this.dependencies.now(),
      totalResults: results.length,
      summary,
    };
  }
}

class FirecrawlProvider extends BaseWebSearchProvider {
  constructor(settings: WebSearchProviderSettings, dependencies: WebSearchProviderDependencies) {
    super("firecrawl", settings, dependencies);
  }

  async search(query: string, maxResults: number): Promise<WebSearchResponse> {
    if (!this.settings.firecrawlApiKey) {
      throw new Error("Firecrawl API key is required for web search.");
    }

    const apiKey = await this.dependencies.decryptKey(this.settings.firecrawlApiKey);
    const response = await this.dependencies.fetchImpl(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, limit: maxResults }),
    });
    const payload = await this.readJson(response);

    if (!response.ok) {
      throw new Error(`Firecrawl search failed (${response.status}): ${await response.text()}`);
    }

    const rawData = payload?.data;
    const items: FirecrawlSearchResult[] = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData?.web)
        ? rawData.web
        : [];

    const results = items.slice(0, maxResults).map((item, index) => ({
      url: item.url || "",
      title: item.title || `Result ${index + 1}`,
      snippet: item.description || "",
      source: "firecrawl",
      rank: index + 1,
    }));

    logInfo(`[webSearchProvider] Firecrawl returned ${results.length} results for query: ${query}`);
    return this.buildResponse(query, results);
  }
}

class PerplexityProvider extends BaseWebSearchProvider {
  constructor(settings: WebSearchProviderSettings, dependencies: WebSearchProviderDependencies) {
    super("perplexity", settings, dependencies);
  }

  async search(query: string, maxResults: number): Promise<WebSearchResponse> {
    if (!this.settings.perplexityApiKey) {
      throw new Error("Perplexity API key is required for web search.");
    }

    const apiKey = await this.dependencies.decryptKey(this.settings.perplexityApiKey);
    const response = await this.dependencies.fetchImpl(PERPLEXITY_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: query }],
      }),
    });
    const payload = await this.readJson(response);

    if (!response.ok) {
      throw new Error(
        `Perplexity Sonar search failed (${response.status}): ${await response.text()}`
      );
    }

    const summary = payload?.choices?.[0]?.message?.content ?? "";
    const citations: string[] = Array.isArray(payload?.citations) ? payload.citations : [];
    const results = citations.slice(0, maxResults).map((url, index) => ({
      url,
      title: `Perplexity Source ${index + 1}`,
      snippet: summary,
      content: index === 0 ? summary : undefined,
      source: "perplexity",
      rank: index + 1,
    }));

    logInfo(
      `[webSearchProvider] Perplexity returned ${results.length} sources for query: ${query}`
    );
    return this.buildResponse(query, results, summary);
  }
}

class SearxngProvider extends BaseWebSearchProvider {
  constructor(settings: WebSearchProviderSettings, dependencies: WebSearchProviderDependencies) {
    super("searxng", settings, dependencies);
  }

  async search(query: string, maxResults: number): Promise<WebSearchResponse> {
    const baseUrl = this.settings.searxngUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error(
        "SearXNG URL is required when SearXNG is selected as the web search provider."
      );
    }

    const response = await this.dependencies.fetchImpl(
      `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&language=all&categories=general`,
      { method: "GET" }
    );
    const payload = await this.readJson(response);

    if (!response.ok) {
      throw new Error(`SearXNG search failed (${response.status}): ${await response.text()}`);
    }

    const items: SearxngSearchResult[] = Array.isArray(payload?.results) ? payload.results : [];
    const results = items.slice(0, maxResults).map((item, index) => ({
      url: item.url || "",
      title: item.title || `Result ${index + 1}`,
      snippet: item.content || "",
      source: item.engine || "searxng",
      rank: index + 1,
    }));

    logInfo(`[webSearchProvider] SearXNG returned ${results.length} results for query: ${query}`);
    return this.buildResponse(query, results);
  }
}

/**
 * Create a provider instance for the currently configured web search backend.
 */
export function createWebSearchProvider(
  settings: WebSearchProviderSettings = getWebSearchProviderSettings(),
  dependencies: Partial<WebSearchProviderDependencies> = {}
): IWebSearchProvider {
  const mergedDependencies = { ...defaultDependencies, ...dependencies };
  switch (settings.webSearchProvider) {
    case "perplexity":
      return new PerplexityProvider(settings, mergedDependencies);
    case "searxng":
      return new SearxngProvider(settings, mergedDependencies);
    case "firecrawl":
    default:
      return new FirecrawlProvider(settings, mergedDependencies);
  }
}

/**
 * Project Copilot settings to the subset used by web search providers.
 */
export function getWebSearchProviderSettings(): WebSearchProviderSettings {
  const settings = getSettings();
  return {
    webSearchProvider: settings.webSearchProvider,
    searxngUrl: settings.searxngUrl,
    firecrawlApiKey: settings.firecrawlApiKey,
    perplexityApiKey: settings.perplexityApiKey,
  };
}
