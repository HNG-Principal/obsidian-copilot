import { selfHostRerank } from "@/LLMProviders/selfHostServices";
import { logWarn } from "@/logger";
import type { SearchResult } from "@/search/types";
import { getSettings } from "@/settings/model";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";

const SELF_HOST_GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000;
const SELF_HOST_PERMANENT_VALIDATION_COUNT = 3;

/**
 * Strategy interface for post-processing search results.
 */
export interface IReranker {
  /**
   * Re-rank search results for improved top-N relevance.
   */
  rerank(query: string, results: SearchResult[], maxResults: number): Promise<SearchResult[]>;
}

class NoopReranker implements IReranker {
  /**
   * Return the original search order when no reranker backend is available.
   */
  async rerank(
    _query: string,
    results: SearchResult[],
    maxResults: number
  ): Promise<SearchResult[]> {
    return results.slice(0, maxResults);
  }
}

class SelfHostReranker implements IReranker {
  /**
   * Re-rank search results using the configured self-host backend.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    maxResults: number
  ): Promise<SearchResult[]> {
    if (results.length === 0) {
      return results;
    }

    const candidateResults = results.slice(0, Math.min(results.length, 20));

    try {
      const rerankResponse = await selfHostRerank(
        query,
        candidateResults.map((result) => result.sectionPreview || result.chunk.content)
      );

      const rerankedCandidates = rerankResponse.response.data
        .map((item) => {
          const result = candidateResults[item.index];
          if (!result) {
            return null;
          }

          return {
            ...result,
            score: item.relevance_score,
            scoreBreakdown: {
              ...result.scoreBreakdown,
              rerankScore: item.relevance_score,
            },
          };
        })
        .filter((result) => result !== null) as SearchResult[];

      if (rerankedCandidates.length === 0) {
        return results.slice(0, maxResults);
      }

      return [...rerankedCandidates, ...results.slice(candidateResults.length)].slice(
        0,
        maxResults
      );
    } catch (error) {
      logWarn("Self-host reranking failed, returning original search order", error);
      return results.slice(0, maxResults);
    }
  }
}

class LLMReranker implements IReranker {
  constructor(private getChatModel?: () => Promise<BaseChatModel | null>) {}

  /**
   * Re-rank search results using the active chat model.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    maxResults: number
  ): Promise<SearchResult[]> {
    if (!this.getChatModel || results.length === 0) {
      return results.slice(0, maxResults);
    }

    const chatModel = await this.getChatModel();
    if (!chatModel) {
      return results.slice(0, maxResults);
    }

    const candidateResults = results.slice(0, Math.min(results.length, 20));
    const prompt = [
      "Score each result for relevance to the query on a 0-10 scale.",
      'Return strict JSON in the shape {"scores":[number,...]} with one score per result in order.',
      `Query: ${query}`,
      JSON.stringify(
        candidateResults.map((result, index) => ({
          index,
          path: result.documentPath,
          preview: result.sectionPreview,
        }))
      ),
    ].join("\n\n");

    try {
      const response = await chatModel.invoke([new HumanMessage(prompt)]);
      const content = Array.isArray(response.content)
        ? response.content
            .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
            .join("\n")
        : String(response.content ?? "");
      const scores = parseScores(content, candidateResults.length);
      if (scores.length === 0) {
        return results.slice(0, maxResults);
      }

      const rerankedCandidates = candidateResults
        .map((result, index) => {
          const rerankScore = scores[index] ?? result.scoreBreakdown.rerankScore ?? result.score;
          return {
            ...result,
            score: rerankScore / 10,
            scoreBreakdown: {
              ...result.scoreBreakdown,
              rerankScore,
            },
          };
        })
        .sort((left, right) => right.score - left.score);

      return [...rerankedCandidates, ...results.slice(candidateResults.length)].slice(
        0,
        maxResults
      );
    } catch (error) {
      logWarn("LLM reranking failed, returning original search order", error);
      return results.slice(0, maxResults);
    }
  }
}

/**
 * Select the best available reranker implementation.
 */
export function createReranker(getChatModel?: () => Promise<BaseChatModel | null>): IReranker {
  if (isSelfHostRerankingAvailable()) {
    return new SelfHostReranker();
  }

  if (!getChatModel) {
    return new NoopReranker();
  }

  return new LLMReranker(getChatModel);
}

/**
 * Determine whether self-host reranking should be preferred.
 */
export function isSelfHostRerankingAvailable(): boolean {
  const settings = getSettings();
  if (!settings.enableSelfHostMode || !settings.selfHostUrl) {
    return false;
  }

  if (settings.selfHostModeValidatedAt == null) {
    return false;
  }

  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    return true;
  }

  return Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS;
}

/**
 * Parse model-provided rerank scores from a JSON payload.
 */
function parseScores(content: string, expectedLength: number): number[] {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { scores?: unknown };
    if (!Array.isArray(parsed.scores)) {
      return [];
    }

    return parsed.scores
      .slice(0, expectedLength)
      .map((score) => Number(score))
      .filter((score) => Number.isFinite(score))
      .map((score) => Math.min(10, Math.max(0, score)));
  } catch {
    return [];
  }
}
