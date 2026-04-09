# Interface Contracts: Enhanced Vault Search

**Feature**: `003-enhanced-vault-search` | **Date**: 2026-04-08

---

## 1. Search Engine Contract (`SearchCore`)

The central search orchestrator that coordinates semantic, lexical, and filter-based retrieval.

```typescript
// src/search/v3/SearchCore.ts

interface RetrieveResult {
  results: NoteIdRank[];
  queryExpansion: ExpandedQuery;
}

class SearchCore {
  constructor(app: App, getChatModel?: () => Promise<BaseChatModel | null>);

  /** Execute a structured search query with hybrid fusion pipeline */
  async search(query: SearchQuery): Promise<SearchResult[]>;

  /** Retrieve ranked note IDs with query expansion (tool integration) */
  async retrieve(query: string, options?: SearchOptions): Promise<RetrieveResult>;

  /** Check if the index is stale (dimension/model mismatch) */
  isIndexStale(): boolean;

  /** Get current index statistics */
  getIndexStats(): IndexStats;

  /** Get full-text engine statistics */
  getStats(): {
    fullTextStats: { documentsIndexed: number; memoryUsed: number; memoryPercent: number };
  };

  /** Get the shared ChunkManager instance */
  getChunkManager(): ChunkManager;

  /** Clear all ephemeral state (full-text index, caches) */
  clear(): void;
}

/** Pure function: compute RRF fusion scores from two ranked lists */
function computeFusionScore(
  semanticResults: Array<{ id: string; score: number }>,
  lexicalResults: Array<{ id: string; score: number }>,
  k?: number
): Array<{ id: string; fusionScore: number }>;
```

### Search Pipeline

```
SearchQuery
  → timeRange? → FilterRetriever (filter-first, early return)
  → no timeRange → MergedSemanticRetriever
       → HybridRetriever (semantic embeddings)
       → TieredLexicalRetriever (grep → graph → BM25+)
       → FilterRetriever (title mentions, tag matches)
       → Deduplicate + RRF fusion
       → Reranker (if enabled)
  → SearchResult[]
```

---

## 2. Reranker Contract

Pluggable reranking interface with three backends.

```typescript
// src/search/reranker.ts

interface IReranker {
  /** Re-rank search results by relevance to query */
  rerank(query: string, results: SearchResult[], maxResults: number): Promise<SearchResult[]>;
}

/** Factory: self-host > LLM > noop fallback chain */
function createReranker(getChatModel?: () => Promise<BaseChatModel | null>): IReranker;

/** Check if self-hosted reranking service is available */
function isSelfHostRerankingAvailable(): boolean;
```

| Backend            | Priority     | Candidates | Behavior                                  |
| ------------------ | ------------ | ---------- | ----------------------------------------- |
| `SelfHostReranker` | 1 (highest)  | Top 20     | Calls `selfHostRerank()` cross-encoder    |
| `LLMReranker`      | 2            | Top 20     | Prompts active chat model for 0-10 scores |
| `NoopReranker`     | 3 (fallback) | All        | Returns original order (passthrough)      |

---

## 3. Index Operations Contract

Manages the vector store index lifecycle and incremental updates.

```typescript
// src/search/indexOperations.ts

interface IndexingState {
  isIndexingPaused: boolean;
  isIndexingCancelled: boolean;
  indexedCount: number;
  totalFilesToIndex: number;
  processedFiles: Set<string>;
}

class IndexOperations {
  constructor(app: App, indexBackend: SemanticIndexBackend, embeddingsManager: EmbeddingsManager);

  /** Read persisted index metadata (model, dimensions, hashes) */
  async getStoredIndexMetadata(): Promise<IndexMetadata | null>;

  /** Check if index is stale (dimension/model mismatch) */
  async isIndexStale(): Promise<boolean>;

  /** Full or incremental index build */
  async indexVaultToVectorStore(
    overwrite?: boolean,
    options?: { userInitiated?: boolean }
  ): Promise<number>;
}
```

### Change Detection Flow

```
indexVaultToVectorStore()
  → getEligibleMarkdownFiles() (applies inclusion/exclusion patterns)
  → validateStoredEmbeddingDimension() → block if mismatch
  → checkAndHandleEmbeddingModelChange() → full rebuild if model changed
  → buildDocumentHashes() → compare against stored hashes
  → re-index changed files only
  → writeIndexMetadata() with updated hashes
```

---

## 4. Chunking Contract

Header-aware document chunking with heading breadcrumb.

```typescript
// src/search/v3/chunks.ts

interface ChunkOptions {
  maxChars: number; // max chars per chunk (default: CHUNK_SIZE)
  overlap: number; // char overlap between chunks (default: 0)
  maxBytesTotal: number; // memory budget (default: 10MB)
}

/** Chunk a document into header-aware VaultChunks */
function chunkDocument(
  content: string,
  filePath: string,
  options: ChunkDocumentOptions
): VaultChunk[];

class ChunkManager {
  constructor(app: App);

  /** Get chunks for multiple notes, with caching */
  async getChunks(notePaths: string[], opts?: Partial<ChunkOptions>): Promise<Chunk[]>;

  /** Read chunk text by ID (async) */
  async getChunkText(id: string): Promise<string>;

  /** Clear chunk cache */
  clearCache(): void;
}

/** Get or create shared ChunkManager singleton */
function getSharedChunkManager(app: App): ChunkManager;

/** Reset shared ChunkManager (for testing) */
function resetSharedChunkManager(): void;
```

### Chunking Guarantees

- Chunks break at heading boundaries (h1-h6)
- Each chunk carries `headingPath[]` breadcrumb from parent headings
- YAML frontmatter is excluded from chunks
- Headings inside code fences are ignored
- Chunks do not exceed `maxChars`

---

## 5. Query Expansion Contract

LLM-based query expansion for improved recall.

```typescript
// src/search/v3/QueryExpander.ts

interface QueryExpanderOptions {
  maxVariants?: number; // Max query variants (default: 3)
  timeout?: number; // LLM call timeout ms
  cacheSize?: number; // LRU cache size
  getChatModel?: () => Promise<BaseChatModel | null>;
}

interface ExpandedQuery {
  queries: string[]; // All queries (original + expanded)
  salientTerms: string[]; // Key terms for filtering
  originalQuery: string; // Original user query
  expandedQueries: string[]; // LLM-generated alternative phrasings
}

class QueryExpander {
  constructor(options?: QueryExpanderOptions);

  /** Expand a query into alternative phrasings with salient terms */
  async expand(query: string): Promise<ExpandedQuery>;
}
```

---

## 6. Pure Utility Functions Contract

Side-effect-free functions for search operations.

```typescript
// src/search/searchUtils.ts

/** MD5 content hash for change detection */
function computeContentHash(content: string): string;

/** Extract date from filename patterns (YYYY-MM-DD, etc.) */
function parseTitleDate(filename: string): number | undefined;

/** Extract #tags from markdown content */
function extractMarkdownTags(content: string): string[];

/** Extract h1-h6 headings from markdown content */
function extractMarkdownHeadings(content: string): string[];

/** Count words in content */
function computeWordCount(content: string): number;

/** Detect embedding vector dimension by probing */
async function getVectorLength(embeddingInstance: Embeddings | undefined): Promise<number>;

/** Determine if a file matches inclusion/exclusion patterns */
function shouldIndexFile(
  file: TFile,
  inclusions: PatternCategory | null,
  exclusions: PatternCategory | null,
  isProject?: boolean
): boolean;
```

---

## 7. Settings Contract

Search-related settings that affect behavior.

| Setting                  | Type      | Default | Description                       |
| ------------------------ | --------- | ------- | --------------------------------- |
| `enableReranking`        | `boolean` | `true`  | Enable reranking after fusion     |
| `hybridSearchTextWeight` | `number`  | `0.3`   | Lexical weight (0.0–1.0)          |
| `enableIndexSync`        | `boolean` | `false` | Persist index metadata to vault   |
| `embeddingModelKey`      | `string`  | —       | Active embedding model identifier |

---

## 8. Event Hooks

Search-related events published to the Obsidian event system.

| Event           | Payload         | Trigger                                           |
| --------------- | --------------- | ------------------------------------------------- |
| File modify     | `TFile`         | Vault file modified → incremental re-index        |
| File delete     | `TFile`         | Vault file deleted → remove from index            |
| File rename     | `TFile, string` | Vault file renamed → update index path            |
| Settings change | —               | Embedding model changed → trigger stale detection |
