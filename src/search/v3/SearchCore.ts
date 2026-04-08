import { LLM_TIMEOUT_MS } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { readIndexMetadata } from "@/search/indexMetadata";
import { createReranker } from "@/search/reranker";
import type { IndexMetadata, IndexStats, SearchQuery, SearchResult } from "@/search/types";
import { getSettings } from "@/settings/model";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Document } from "@langchain/core/documents";
import { App } from "obsidian";
import { ChunkManager, getSharedChunkManager } from "./chunks";
import { FullTextEngine } from "./engines/FullTextEngine";
import { FilterRetriever } from "./FilterRetriever";
import { NoteIdRank, SearchOptions } from "./interfaces";
import { ExpandedQuery, QueryExpander } from "./QueryExpander";
import { GrepScanner } from "./scanners/GrepScanner";
import { FolderBoostCalculator } from "./scoring/FolderBoostCalculator";
import { GraphBoostCalculator } from "./scoring/GraphBoostCalculator";
import { adaptiveCutoff } from "./scoring/AdaptiveCutoff";
import { ScoreNormalizer } from "./utils/ScoreNormalizer";

// Search constants
const FULLTEXT_RESULT_MULTIPLIER = 3;
export const RETURN_ALL_LIMIT = 100;

/**
 * Result from the retrieval pipeline, including both results and query expansion metadata.
 * The query expansion data can be used by the caller to understand what terms were searched.
 */
export interface RetrieveResult {
  results: NoteIdRank[];
  queryExpansion: ExpandedQuery;
}

/**
 * Combine semantic and lexical ranked lists using reciprocal rank fusion.
 */
export function computeFusionScore(
  semanticResults: Array<{ id: string; score: number }>,
  lexicalResults: Array<{ id: string; score: number }>,
  k = 60
): Array<{ id: string; fusionScore: number }> {
  const fusedScores = new Map<string, number>();

  semanticResults.forEach((result, index) => {
    fusedScores.set(result.id, (fusedScores.get(result.id) ?? 0) + 1 / (k + index + 1));
  });

  lexicalResults.forEach((result, index) => {
    fusedScores.set(result.id, (fusedScores.get(result.id) ?? 0) + 1 / (k + index + 1));
  });

  return Array.from(fusedScores.entries())
    .map(([id, fusionScore]) => ({ id, fusionScore }))
    .sort((left, right) => right.fusionScore - left.fusionScore);
}

/**
 * Core search engine that orchestrates the multi-stage retrieval pipeline
 * Updated to support unified chunking architecture
 */
export class SearchCore {
  private grepScanner: GrepScanner;
  private fullTextEngine: FullTextEngine;
  private queryExpander: QueryExpander;
  private folderBoostCalculator: FolderBoostCalculator;
  private graphBoostCalculator: GraphBoostCalculator;
  private scoreNormalizer: ScoreNormalizer;
  private chunkManager: ChunkManager;
  private indexMetadata: IndexMetadata | null = null;

  constructor(
    private app: App,
    private getChatModel?: () => Promise<BaseChatModel | null>
  ) {
    this.grepScanner = new GrepScanner(app);
    this.chunkManager = getSharedChunkManager(app);
    this.fullTextEngine = new FullTextEngine(app, this.chunkManager);
    this.queryExpander = new QueryExpander({
      getChatModel: this.getChatModel,
      maxVariants: 3,
      timeout: LLM_TIMEOUT_MS,
    });
    this.folderBoostCalculator = new FolderBoostCalculator(app);
    this.graphBoostCalculator = new GraphBoostCalculator(app, {
      enabled: true,
      maxCandidates: 20, // Absolute ceiling (note-level after chunk dedup)
      boostStrength: 0.1,
      maxBoostMultiplier: 1.15,
    });
    this.scoreNormalizer = new ScoreNormalizer({
      method: "minmax", // Use min-max to preserve monotonicity
      clipMin: 0.02,
      clipMax: 0.98,
    });
    void this.refreshIndexMetadata();
  }

  /**
   * Search using the enhanced SearchQuery contract.
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    await this.refreshIndexMetadata();

    if (this.isIndexStale()) {
      logWarn("SearchCore: Search blocked because the index is stale");
      return [];
    }

    if (query.timeRange) {
      const filterRetriever = new FilterRetriever(this.app, {
        salientTerms: [],
        maxK: query.resultLimit,
        returnAll: true,
        timeRange: {
          startTime: query.timeRange.start ?? Number.MIN_SAFE_INTEGER,
          endTime: query.timeRange.end ?? Number.MAX_SAFE_INTEGER,
        },
      });
      const filterDocuments = await filterRetriever.getRelevantDocuments(query.queryText);
      return filterDocuments
        .slice(0, query.resultLimit)
        .map((doc) => this.documentToSearchResult(doc));
    }

    if (getSettings().enableSemanticSearchV3) {
      const { MergedSemanticRetriever } = await import("./MergedSemanticRetriever");
      const mergedRetriever = new MergedSemanticRetriever(this.app, {
        maxK: query.resultLimit,
        salientTerms: [],
        textWeight: query.textWeight ?? getSettings().hybridSearchTextWeight,
        returnAll: false,
      });
      const documents = await mergedRetriever.getRelevantDocuments(query.queryText);
      const fusionScores = new Map(
        computeFusionScore(
          documents
            .filter((doc) => (doc.metadata?.semanticScore ?? 0) > 0)
            .sort(
              (left, right) =>
                (right.metadata?.semanticScore ?? 0) - (left.metadata?.semanticScore ?? 0)
            )
            .map((doc) => ({
              id: this.getDocumentIdentifier(doc),
              score: doc.metadata?.semanticScore ?? 0,
            })),
          documents
            .filter((doc) => (doc.metadata?.lexicalScore ?? 0) > 0)
            .sort(
              (left, right) =>
                (right.metadata?.lexicalScore ?? 0) - (left.metadata?.lexicalScore ?? 0)
            )
            .map((doc) => ({
              id: this.getDocumentIdentifier(doc),
              score: doc.metadata?.lexicalScore ?? 0,
            }))
        ).map((entry) => [entry.id, entry.fusionScore])
      );

      const fusedResults = documents
        .map((doc) =>
          this.documentToSearchResult(doc, fusionScores.get(this.getDocumentIdentifier(doc)))
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, query.resultLimit);

      if (!getSettings().enableReranking) {
        return fusedResults;
      }

      const reranker = createReranker(this.getChatModel);
      return reranker.rerank(query.queryText, fusedResults, query.resultLimit);
    }

    const retrieveResult = await this.retrieve(query.queryText, {
      maxResults: query.resultLimit,
      enableLexicalBoosts: getSettings().enableLexicalBoosts,
    });

    const results = await Promise.all(
      retrieveResult.results.map((result) => this.noteRankToSearchResult(result))
    );

    if (!getSettings().enableReranking) {
      return results;
    }

    const reranker = createReranker(this.getChatModel);
    return reranker.rerank(query.queryText, results, query.resultLimit);
  }

  /**
   * Return whether the persisted index is stale.
   */
  isIndexStale(): boolean {
    return Boolean(this.indexMetadata?.stale);
  }

  /**
   * Return persisted index statistics.
   */
  getIndexStats(): IndexStats {
    return {
      documentCount: Object.keys(this.indexMetadata?.documentHashes ?? {}).length,
      chunkCount: 0,
      lastFullIndexAt: this.indexMetadata?.lastFullIndexAt,
      embeddingModel: this.indexMetadata?.embeddingModel,
      stale: Boolean(this.indexMetadata?.stale),
    };
  }

  /**
   * Main retrieval pipeline (now chunk-based by default)
   * @param query - User's search query
   * @param options - Search options
   * @returns Ranked list of chunk IDs with query expansion metadata
   */
  async retrieve(query: string, options: SearchOptions = {}): Promise<RetrieveResult> {
    // Create empty expansion for early returns
    const emptyExpansion: ExpandedQuery = {
      queries: [],
      salientTerms: [],
      originalQuery: query || "",
      expandedQueries: [],
    };

    // Input validation: check query
    if (!query || typeof query !== "string") {
      logWarn("SearchCore: Invalid query provided");
      return { results: [], queryExpansion: emptyExpansion };
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      logWarn("SearchCore: Empty query provided");
      return { results: [], queryExpansion: emptyExpansion };
    }

    if (trimmedQuery.length > 1000) {
      logWarn("SearchCore: Query too long, truncating");
      query = trimmedQuery.substring(0, 1000);
    } else {
      query = trimmedQuery;
    }

    // Validate and sanitize options with bounds checking
    const returnAll = Boolean(options.returnAll);
    const maxResults = returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(Math.max(1, options.maxResults || 30), 100);
    const candidateLimit = returnAll
      ? RETURN_ALL_LIMIT
      : Math.min(Math.max(10, options.candidateLimit || 200), 1000);
    const enableLexicalBoosts = Boolean(options.enableLexicalBoosts ?? true); // Default to enabled

    try {
      // Log search start with minimal verbosity
      logInfo(`SearchCore: Searching for "${query}"`);

      // 1. Expand query into variants and terms (skip if pre-expanded data provided)
      let expanded: ExpandedQuery;
      if (options.preExpandedQuery) {
        // Use pre-expanded data to avoid double LLM calls
        logInfo("SearchCore: Using pre-expanded query data (skipping QueryExpander)");
        expanded = {
          queries: options.preExpandedQuery.queries || [query],
          salientTerms: options.preExpandedQuery.salientTerms || [],
          originalQuery: options.preExpandedQuery.originalQuery || query,
          expandedQueries: options.preExpandedQuery.expandedQueries || [],
        };
      } else {
        expanded = await this.queryExpander.expand(query);
      }
      const queries = expanded.queries;
      // Combine expanded salient terms with any provided salient terms
      const salientTerms = options.salientTerms
        ? [...new Set([...expanded.salientTerms, ...options.salientTerms])]
        : expanded.salientTerms;

      // Build recall queries from expanded queries and salient terms
      const recallQueries: string[] = [];
      const recallLookup = new Set<string>();

      const addRecallTerm = (term: string | undefined) => {
        if (!term) {
          return;
        }
        const normalized = term.toLowerCase();
        if (normalized.length === 0 || recallLookup.has(normalized)) {
          return;
        }
        recallLookup.add(normalized);
        recallQueries.push(normalized);
      };

      queries.forEach(addRecallTerm);
      salientTerms.forEach(addRecallTerm);

      // Only log details if expansion produced significant variants
      if (queries.length > 1 || salientTerms.length > 0) {
        logInfo(
          `Query expansion: variants=${JSON.stringify(queries)}, salient=${JSON.stringify(
            salientTerms
          )}`
        );
      }

      // 2. GREP for initial candidates (use all terms for maximum recall)
      const grepLimit = returnAll ? RETURN_ALL_LIMIT : 200;
      const grepHits = await this.grepScanner.batchCachedReadGrep(recallQueries, grepLimit);

      // 3. Limit candidates (no graph expansion - we use graph for boost only)
      const candidates = grepHits.slice(0, candidateLimit);

      // Log candidate info concisely
      logInfo(`SearchCore: ${candidates.length} candidates (from ${grepHits.length} grep hits)`);

      // 5. Run lexical search only (semantic search removed)
      const lexicalResults = await this.executeLexicalSearch(
        candidates,
        recallQueries,
        salientTerms,
        maxResults,
        expanded.originalQuery,
        returnAll
      );

      // 6. Apply boosts to lexical results (if enabled)
      let finalResults = lexicalResults;
      if (enableLexicalBoosts) {
        finalResults = this.folderBoostCalculator.applyBoosts(finalResults);
        finalResults = this.graphBoostCalculator.applyBoost(finalResults);
      }

      // 7. Apply score normalization to prevent auto-1.0
      finalResults = this.scoreNormalizer.normalize(finalResults);

      // 8. Clean up full-text index to free memory
      this.fullTextEngine.clear();

      // 9. Note-diverse top-K selection
      if (finalResults.length > maxResults) {
        finalResults = selectDiverseTopK(finalResults, maxResults);
      }

      // Log final result summary
      if (finalResults.length > 0) {
        const topResult = this.app.vault.getAbstractFileByPath(finalResults[0].id);
        logInfo(
          `SearchCore: ${finalResults.length} results found (top: ${topResult?.name || finalResults[0].id})`
        );
      } else {
        logInfo("SearchCore: No results found");
      }

      return { results: finalResults, queryExpansion: expanded };
    } catch (error) {
      logError("SearchCore: Retrieval failed", error);

      // Fallback to simple grep results (guaranteed to return [])
      try {
        const fallbackResults = await this.fallbackSearch(query, maxResults);
        return { results: fallbackResults, queryExpansion: emptyExpansion };
      } catch (fallbackError) {
        logError("SearchCore: Fallback search also failed", fallbackError);
        return { results: [], queryExpansion: emptyExpansion }; // Always return empty array on complete failure
      }
    }
  }

  /**
   * Fallback search using only grep
   * @param query - Search query
   * @param limit - Maximum results
   * @returns Basic grep results as NoteIdRank
   */
  private async fallbackSearch(query: string, limit: number): Promise<NoteIdRank[]> {
    try {
      const grepHits = await this.grepScanner.grep(query, limit);
      return grepHits.map((id, idx) => ({
        id,
        score: 1 / (idx + 1),
        engine: "grep",
      }));
    } catch (error) {
      logError("SearchCore: Fallback search failed", error);
      return [];
    }
  }

  /**
   * Get statistics about the last retrieval
   */
  getStats(): {
    fullTextStats: { documentsIndexed: number; memoryUsed: number; memoryPercent: number };
  } {
    return {
      fullTextStats: this.fullTextEngine.getStats(),
    };
  }

  /**
   * Get the shared ChunkManager instance
   */
  getChunkManager(): ChunkManager {
    return this.chunkManager;
  }

  /**
   * Clear all caches and reset state
   */
  clear(): void {
    this.fullTextEngine.clear();
    this.queryExpander.clearCache();
    logInfo("SearchCore: Cleared all caches");
  }

  private async refreshIndexMetadata(): Promise<void> {
    this.indexMetadata = await readIndexMetadata(this.app, getSettings().enableIndexSync);
  }

  private async noteRankToSearchResult(result: NoteIdRank): Promise<SearchResult> {
    const documentPath = result.id.includes("#") ? result.id.split("#")[0] : result.id;
    const file = this.app.vault.getAbstractFileByPath(documentPath);
    const fileCache = file ? this.app.metadataCache.getFileCache(file as any) : undefined;
    const chunkContent = result.id.includes("#")
      ? await this.chunkManager.getChunkText(result.id)
      : "";

    return {
      chunk: {
        id: result.id,
        documentPath,
        content: chunkContent,
        headingPath: [],
        startLine: 0,
        endLine: 0,
        metadata: {
          documentTags: fileCache?.tags?.map((tag: { tag: string }) => tag.tag) ?? [],
          documentModifiedAt: (file as any)?.stat?.mtime ?? 0,
          documentTitleDate: undefined,
          documentWordCount: chunkContent.split(/\s+/).filter(Boolean).length,
          sectionHeadings: [],
        },
      },
      score: result.score,
      documentPath,
      sectionPreview: chunkContent.slice(0, 200),
      scoreBreakdown: {
        semanticScore: result.score,
        lexicalScore: 0,
        fusionScore: 0,
      },
    };
  }

  private getDocumentIdentifier(doc: Document): string {
    return (
      doc.metadata?.chunkId ?? doc.metadata?.path ?? doc.metadata?.documentPath ?? doc.pageContent
    );
  }

  private documentToSearchResult(doc: Document, fusionScore?: number): SearchResult {
    const metadata = doc.metadata ?? {};
    const documentPath = metadata.path ?? metadata.documentPath ?? "";
    const headingPath = Array.isArray(metadata.headingPath)
      ? metadata.headingPath
      : metadata.heading
        ? [metadata.heading]
        : [];
    const score = fusionScore ?? metadata.rerank_score ?? metadata.score ?? 0;

    return {
      chunk: {
        id: metadata.chunkId ?? documentPath,
        documentPath,
        content: doc.pageContent,
        headingPath,
        startLine: typeof metadata.startLine === "number" ? metadata.startLine : 0,
        endLine: typeof metadata.endLine === "number" ? metadata.endLine : 0,
        metadata: {
          documentTags: metadata.documentTags ?? metadata.tags ?? [],
          documentModifiedAt: metadata.mtime ?? 0,
          documentTitleDate: metadata.documentTitleDate,
          documentWordCount:
            metadata.documentWordCount ?? doc.pageContent.split(/\s+/).filter(Boolean).length,
          sectionHeadings: metadata.documentHeadings ?? headingPath,
        },
      },
      score,
      documentPath,
      sectionPreview: doc.pageContent.slice(0, 200),
      scoreBreakdown: {
        semanticScore: metadata.semanticScore ?? 0,
        lexicalScore: metadata.lexicalScore ?? 0,
        fusionScore: fusionScore ?? metadata.fusionScore ?? 0,
        rerankScore: metadata.rerankScore ?? metadata.rerank_score,
      },
    };
  }

  /**
   * Execute lexical search with full-text index
   * @param candidates - Candidate documents to index
   * @param recallQueries - All queries for recall (original + expanded + salient terms)
   * @param salientTerms - Salient terms for scoring (extracted from original query)
   * @param maxResults - Maximum number of results
   * @param originalQuery - The original user query for scoring
   * @param returnAll - Whether to return all results up to RETURN_ALL_LIMIT
   * @returns Ranked list of documents from lexical search
   */
  private async executeLexicalSearch(
    candidates: string[],
    recallQueries: string[],
    salientTerms: string[],
    maxResults: number,
    originalQuery?: string,
    returnAll: boolean = false
  ): Promise<NoteIdRank[]> {
    try {
      // Build ephemeral full-text index
      const buildStartTime = Date.now();
      const indexed = await this.fullTextEngine.buildFromCandidates(candidates);
      const buildTime = Date.now() - buildStartTime;

      // Search the index
      const searchStartTime = Date.now();
      const effectiveMaxResults = returnAll
        ? RETURN_ALL_LIMIT
        : Number.isFinite(maxResults)
          ? Math.min(maxResults, 1000)
          : candidates.length || 30;
      const searchLimit = returnAll
        ? RETURN_ALL_LIMIT * FULLTEXT_RESULT_MULTIPLIER
        : Math.max(effectiveMaxResults * FULLTEXT_RESULT_MULTIPLIER, FULLTEXT_RESULT_MULTIPLIER);
      const results = this.fullTextEngine.search(
        recallQueries,
        searchLimit,
        salientTerms,
        originalQuery
      );
      const searchTime = Date.now() - searchStartTime;

      // Single consolidated log for lexical search
      logInfo(
        `Full-text: ${indexed} docs indexed (${buildTime}ms), ${results.length} results (${searchTime}ms)`
      );
      return results;
    } catch (error) {
      logError("Full-text search failed", error);
      return [];
    }
  }
}

/**
 * Select top-K results with note diversity guarantee.
 * Delegates to adaptiveCutoff with score cutoff disabled (threshold=0),
 * so only diversity and ceiling logic apply.
 *
 * @param results - Score-sorted results (descending)
 * @param limit - Maximum results to return
 * @returns Diverse top-K results, sorted by score descending
 */
export function selectDiverseTopK(results: NoteIdRank[], limit: number): NoteIdRank[] {
  if (results.length <= limit) {
    return results;
  }

  return adaptiveCutoff(results, {
    floor: 0,
    ceiling: limit,
    relativeThreshold: 0,
    absoluteMinScore: 0,
    ensureDiversity: true,
  }).results;
}
