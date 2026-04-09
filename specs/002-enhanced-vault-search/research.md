# Research Decisions: Enhanced Vault Search

**Feature**: `002-enhanced-vault-search` | **Date**: 2026-04-08

---

## 1. Hybrid Search Scoring Strategy

**Decision**: Reciprocal Rank Fusion (RRF) combining semantic similarity scores from `MergedSemanticRetriever` and BM25 keyword scores from `TieredLexicalRetriever`, with a configurable weight parameter.

**Rationale**: RRF is a simple, effective, and well-studied fusion technique. It works by combining reciprocal ranks from multiple result lists rather than raw scores, which avoids score normalization issues between different retrieval methods. The existing v3 architecture already runs semantic and lexical retrieval separately — fusion is a natural post-processing step.

**Alternatives Considered**:

- **Convex combination of raw scores**: Rejected — semantic cosine similarity and BM25 scores are on different scales, requiring normalization that can distort rankings.
- **Learn-to-rank model**: Rejected — requires training data, too complex for v1. Consider for v2.
- **Semantic-only with query expansion**: Rejected — misses exact keyword matches (spec user story 4).

**Implementation Approach**:

- After both retrievers return results, merge using RRF: `score = Σ 1/(k + rank_i)` where k=60 (standard constant)
- Configurable `textWeight` in `RetrieverOptions` (existing field) controls relative ranking influence
- When `textWeight = 0`: pure semantic. When `textWeight = 1`: pure lexical. Default `0.3`.

---

## 2. Incremental Indexing Strategy

**Decision**: Content hash comparison using MD5 of file content, stored alongside each chunk's metadata. On vault open, compare current file hashes against stored hashes to identify changed files.

**Rationale**: The existing `IndexEventHandler` listens to vault file events for real-time updates. For bulk comparison on vault open, content hashing is the most reliable method. The existing `PDFCache` already uses this pattern (`MD5 hash of file path + size + mtime`).

**Alternatives Considered**:

- **mtime-only comparison**: Rejected — unreliable when files are synced across devices (mtime can change without content change).
- **Full re-index every time**: Rejected — violates SC-002 (30s for 50 changes) for large vaults.
- **Git-style diff detection**: Overkill — we don't need diff granularity, just changed/unchanged.

**Implementation Approach**:

- Store `{ filePath, contentHash, lastIndexedAt }` per document in index metadata
- On vault open: compute hashes for all markdown files, compare against stored
- Queue only changed files for re-embedding
- Delete index entries for removed files
- New files: detected by absence in stored metadata

---

## 3. Time-Based Filtering Architecture

**Decision**: Filter at the retriever level using file metadata (modification date and date-formatted titles), applied as a post-retrieval filter on `FilterRetriever`.

**Rationale**: The existing `FilterRetriever` already supports time-range filtering. Enhancing it to also parse date-formatted titles (e.g., `2026-01-15 Meeting Notes`) provides richer temporal filtering without requiring a separate time index.

**Alternatives Considered**:

- **Pre-filter before embedding search**: Rejected — reduces recall since semantic search performs better on larger candidate sets.
- **Separate time index**: Rejected — adds storage complexity for minimal benefit over metadata filtering.
- **LLM-parsed time expressions only**: Rejected — the existing `getTimeRangeMsTool` already parses natural language time expressions.

**Implementation Approach**:

- Extend `FilterRetriever` to extract dates from:
  1. File modification time (`file.stat.mtime`)
  2. File title date patterns (`YYYY-MM-DD`, `YYYY.MM.DD`, etc.)
  3. YAML frontmatter `date` field
- `SearchQuery.timeRange` as `{ start?: number, end?: number }` (epoch ms)
- Use existing `getTimeRangeMsTool` to parse natural language time expressions

---

## 4. Header-Aware Document Chunking

**Decision**: Sliding window chunking with header boundary awareness — chunks prefer to break at heading boundaries and carry the heading context (breadcrumb) as metadata.

**Rationale**: The existing `chunks.ts` handles chunking but doesn't optimize for header boundaries. Breaking mid-section loses context. Header-aware chunking ensures each chunk carries its section path (e.g., "Introduction > Background") for better retrieval context.

**Alternatives Considered**:

- **Fixed-size chunks only**: Rejected — breaks mid-sentence and loses structural context.
- **One chunk per heading section**: Rejected — some sections are very long or very short, leading to inconsistent chunk sizes.
- **Recursive character splitter (LangChain default)**: Rejected — not heading-aware.

**Implementation Approach**:

- Parse markdown headings to build a section tree
- Split at heading boundaries when possible, fall back to paragraph/sentence boundaries
- Each chunk carries metadata: `{ headingPath: string[], startLine: number, endLine: number }`
- Overlap: include last 1-2 sentences of previous chunk as context prefix
- Max chunk size: configurable (default 512 tokens for embedding model compatibility)

---

## 5. Reranking Strategy

**Decision**: Pluggable reranker with two backends — self-hosted cross-encoder (when available via Miyo/selfHostRerank) and LLM-based reranking as fallback.

**Rationale**: The existing `selfHostRerank()` in `selfHostServices.ts` already provides reranking when the self-hosted backend is available. For users without a self-hosted backend, LLM-based reranking (asking the LLM to score relevance) provides a BYOK alternative.

**Alternatives Considered**:

- **No reranking**: Rejected — spec FR-005 requires reranking. SC-004 requires measurable improvement.
- **Client-side cross-encoder (WASM)**: Rejected for v1 — bundle size concern. Reconsider for v2.
- **Always LLM-based**: Rejected — expensive and slow for every search. Cross-encoder is faster when available.

**Implementation Approach**:

- `reranker.ts` exports `rerankResults(query, results, options): Promise<SearchResult[]>`
- Strategy selection: self-host cross-encoder if available, else LLM-based, else skip (return original order)
- LLM reranking: batch top-20 results, ask LLM to score 0-10 relevance per result, re-sort
- Only applied to top-N results (default 20) for performance
- Configurable toggle in settings: `enableReranking` (default true)

---

## 6. Multilingual Embedding Support

**Decision**: Support multilingual search by allowing users to configure a multilingual embedding model (e.g., Cohere `embed-multilingual-v3.0`, OpenAI `text-embedding-3-large`). No language-specific logic in the search pipeline.

**Rationale**: Constitution I (Generalizable Solutions) prohibits language-specific handling. Multilingual search is achieved by model choice, not code changes. The existing `EmbeddingManager` already supports multiple providers — users just select a multilingual model.

**Alternatives Considered**:

- **Language detection + per-language models**: Rejected — violates Constitution I, adds complexity.
- **Translation layer before embedding**: Rejected — adds latency and translation errors.
- **Hardcoded multilingual model**: Rejected — violates BYOK principle.

**Implementation Approach**:

- No code changes needed for multilingual support — it's a model configuration choice
- Document recommended multilingual models in `docs/vault-search-and-indexing.md`
- Re-index detection: when `embeddingModelKey` changes in settings, trigger full re-index prompt (FR-010)
- Embedding dimension validation: check new model's dimension matches stored embeddings, warn if mismatch
