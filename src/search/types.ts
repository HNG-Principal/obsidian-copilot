/**
 * Metadata copied from a parent vault document onto each chunk.
 */
export interface ChunkMetadata {
  documentTags: string[];
  documentModifiedAt: number;
  documentTitleDate?: number;
  documentWordCount: number;
  sectionHeadings: string[];
}

/**
 * Search index representation of a vault document.
 */
export interface VaultDocument {
  filePath: string;
  contentHash: string;
  modifiedAt: number;
  titleDate?: number;
  tags: string[];
  headings: string[];
  wordCount: number;
}

/**
 * Header-aware chunk stored in the semantic index.
 */
export interface VaultChunk {
  id: string;
  documentPath: string;
  content: string;
  headingPath: string[];
  startLine: number;
  endLine: number;
  embedding?: number[];
  metadata: ChunkMetadata;
}

/**
 * Optional time filter applied to a search query.
 */
export interface TimeRange {
  start?: number;
  end?: number;
}

/**
 * User-facing search request.
 */
export interface SearchQuery {
  queryText: string;
  resultLimit: number;
  textWeight?: number;
  timeRange?: TimeRange;
}

/**
 * Individual score components captured during ranking.
 */
export interface ScoreBreakdown {
  semanticScore: number;
  lexicalScore: number;
  fusionScore: number;
  rerankScore?: number;
}

/**
 * Structured search response returned by the enhanced search engine.
 */
export interface SearchResult {
  chunk: VaultChunk;
  score: number;
  documentPath: string;
  sectionPreview: string;
  scoreBreakdown: ScoreBreakdown;
}

/**
 * Metadata persisted with the search index for incremental updates and stale-index detection.
 */
export interface IndexMetadata {
  version: number;
  embeddingModel: string;
  embeddingDimension: number;
  lastFullIndexAt: number;
  documentHashes: Record<string, string>;
  stale?: boolean;
}

/**
 * Runtime index statistics surfaced by the search engine.
 */
export interface IndexStats {
  documentCount: number;
  chunkCount: number;
  lastFullIndexAt?: number;
  embeddingModel?: string;
  stale: boolean;
}
