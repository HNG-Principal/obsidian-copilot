# Interface Contracts: Enhanced Vault Search

**Feature**: `002-enhanced-vault-search` | **Date**: 2026-04-08

---

## Core Interfaces

### ISearchEngine (extends existing SearchCore)

```typescript
interface ISearchEngine {
  /**
   * Execute a hybrid search with optional time and tag filters.
   * Returns ranked results after fusion scoring and optional reranking.
   */
  search(query: SearchQuery): Promise<SearchResult[]>;

  /**
   * Check if the index needs rebuilding (embedding model changed).
   */
  isIndexStale(): boolean;

  /**
   * Get index statistics (document count, chunk count, last indexed).
   */
  getIndexStats(): IndexStats;
}
```

### IIndexManager (extends existing IndexOperations)

```typescript
interface IIndexManager {
  /**
   * Incremental update: re-index only changed files.
   * Returns count of documents re-indexed.
   */
  updateChanged(): Promise<number>;

  /**
   * Full re-index: rebuild entire index from scratch.
   * Emits progress events for UI feedback.
   */
  rebuildAll(onProgress?: (current: number, total: number) => void): Promise<void>;

  /**
   * Remove a document and all its chunks from the index.
   */
  removeDocument(filePath: string): Promise<void>;

  /**
   * Check which files have changed since last index.
   * Returns array of file paths needing re-indexing.
   */
  detectChanges(): Promise<string[]>;
}
```

### IReranker

```typescript
interface IReranker {
  /**
   * Rerank search results for improved relevance.
   * @param query - Original search query text
   * @param results - Candidate results to rerank
   * @param maxResults - Maximum results to return after reranking
   * @returns Reranked results with updated scores
   */
  rerank(query: string, results: SearchResult[], maxResults: number): Promise<SearchResult[]>;
}
```

---

## Pure Function Type Contracts

### Chunk Documents

```typescript
/**
 * Split a markdown document into header-aware chunks with overlap.
 * Pure function: text in → chunks out.
 */
type ChunkDocument = (
  content: string,
  filePath: string,
  options: { maxChunkTokens: number; overlapSentences: number }
) => VaultChunk[];
```

### Compute Fusion Score

```typescript
/**
 * Combine semantic and lexical scores using Reciprocal Rank Fusion.
 * Pure function: ranked lists in → fused ranked list out.
 */
type ComputeFusionScore = (
  semanticResults: Array<{ id: string; score: number }>,
  lexicalResults: Array<{ id: string; score: number }>,
  k?: number // RRF constant, default 60
) => Array<{ id: string; fusionScore: number }>;
```

### Compute Content Hash

```typescript
/**
 * Compute MD5 hash of file content for change detection.
 */
type ComputeContentHash = (content: string) => string;
```

### Parse Title Date

```typescript
/**
 * Extract a date from a filename if it follows a date pattern.
 * Returns undefined if no date pattern detected.
 */
type ParseTitleDate = (filename: string) => number | undefined;
```

---

## Settings Contract

New/modified settings in `CopilotSettings`:

| Setting                  | Type      | Default | Range    | Description                                  |
| ------------------------ | --------- | ------- | -------- | -------------------------------------------- |
| `hybridSearchTextWeight` | `number`  | `0.3`   | 0.0–1.0  | Weight for keyword matching in hybrid search |
| `enableReranking`        | `boolean` | `true`  | —        | Enable result reranking                      |
| `maxChunkTokens`         | `number`  | `512`   | 128–2048 | Maximum tokens per chunk                     |

Existing settings reused:

- `embeddingModelKey` — embedding model selection (triggers re-index detection)
- `enableSemanticSearchV3` — v3 search toggle
- `numPartitions` — index partitioning
- `indexVaultToVectorStore` — index enable/disable

---

## Event Hooks

| Hook                    | Trigger          | Handler                                                |
| ----------------------- | ---------------- | ------------------------------------------------------ |
| File created/modified   | Vault file event | `IndexEventHandler` → `IIndexManager.updateChanged()`  |
| File deleted            | Vault file event | `IndexEventHandler` → `IIndexManager.removeDocument()` |
| Embedding model changed | Settings change  | Detect stale index → prompt user for full re-index     |
| Vault opened            | Plugin load      | `IIndexManager.detectChanges()` → batch re-index       |
| Search executed         | User query       | `ISearchEngine.search()` → fusion → optional rerank    |
