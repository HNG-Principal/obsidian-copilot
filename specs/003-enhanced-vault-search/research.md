# Research Decisions: Enhanced Vault Search

**Feature**: `003-enhanced-vault-search` | **Date**: 2026-04-08

---

## 1. Hybrid Search Scoring Strategy

**Decision**: Reciprocal Rank Fusion (RRF) combining semantic similarity scores from `MergedSemanticRetriever` and BM25+ keyword scores from `TieredLexicalRetriever`, with configurable weight parameters.

**Rationale**: RRF is a simple, effective, and well-studied fusion technique that avoids score normalization issues between different retrieval methods. The v3 architecture already runs semantic and lexical retrieval in parallel via `MergedSemanticRetriever` — fusion is a natural post-processing step.

**Alternatives Considered**:

- **Convex combination of raw scores**: Rejected — semantic cosine similarity and BM25+ scores are on different scales, requiring normalization that can distort rankings.
- **Learn-to-rank model**: Rejected — requires training data, too complex for v1.
- **Semantic-only with query expansion**: Rejected — misses exact keyword matches (spec user story 4).

**Implementation Status**: ✅ **COMPLETE**

- `MergedSemanticRetriever` runs lexical (`TieredLexicalRetriever`) and semantic (`HybridRetriever`) in parallel
- Merges results by deduplicating on document path
- RRF fusion with configurable weights: `LEXICAL_WEIGHT=1.0`, `SEMANTIC_WEIGHT=1.0`, `TAG_MATCH_BOOST=1.1`
- `computeFusionScore()` pure function in `SearchCore.ts`
- Configurable `hybridSearchTextWeight` setting (0.0–1.0, default 0.3)

---

## 2. Incremental Indexing Strategy

**Decision**: Content hash comparison using MD5 of file content, stored alongside each chunk's metadata in `IndexMetadata.documentHashes`. Multi-layer detection: hash comparison + mtime fallback.

**Rationale**: Content hashing is the most reliable change detection method. Dual-layer (hash + mtime) handles edge cases like sync-modified files and files missing from the hash map.

**Alternatives Considered**:

- **mtime-only comparison**: Rejected — unreliable when files are synced across devices.
- **Full re-index every time**: Rejected — violates SC-002 (30s for 50 changes) for large vaults.
- **Git-style diff detection**: Overkill — we don't need diff granularity.

**Implementation Status**: ✅ **COMPLETE**

- `computeContentHash()` in `searchUtils.ts` uses MD5 (crypto-js)
- `IndexMetadata.documentHashes` stores `Record<string, string>` (filePath → hash)
- `detectChanges()` compares current hashes against stored, identifies new/modified/deleted
- `updateChanged()` re-indexes only changed files, updates metadata
- Secondary mtime check in `getFilesToIndex()` catches files missed by hash
- `removeDocument()` handles deletions
- Full test coverage in `searchUtils.test.ts` and `indexOperations.test.ts`

---

## 3. Time-Based Filtering Architecture

**Decision**: Filter-first approach — when `timeRange` is set, `FilterRetriever` runs alone as a hard constraint. Results within the time window are ordered by recency (0.3–1.0 score), not by semantic relevance.

**Rationale**: The filter-first approach is simpler and more predictable. Users who specify a time range expect strict temporal boundaries, and the current implementation keeps that behavior explicit by ordering in-window results by recency.

**Open Question**: Whether time-filtered results should be re-ranked by semantic relevance within the time window. The current filter-first approach returns results in recency order only. A fusion approach would blend semantic similarity with time constraint but adds complexity.

**Decision**: Keep filter-first for now. Document as a future enhancement.

- **Argument for filter-first**: Simpler, predictable, matches user mental model of "show me stuff from last week"
- **Argument for fusion**: Higher relevance quality for queries like "project updates from last week" where the user wants semantic matching within a time window
- **Recommendation**: Ship filter-first (working today), track fusion as a P2 enhancement

**Alternatives Considered**:

- **Pre-filter before embedding search**: Rejected — reduces recall since semantic search performs better on larger candidate sets.
- **Separate time index**: Rejected — adds storage complexity for minimal benefit over metadata filtering.

**Implementation Status**: ✅ **COMPLETE** (filter-first)

- `FilterRetriever` extracts dates from: file mtime, title date patterns (`YYYY-MM-DD`, etc.), frontmatter date
- `SearchQuery.timeRange` as `{ start?: number, end?: number }` (epoch ms)
- Generates daily note titles for date range (`[[YYYY-MM-DD]]` format)
- Recency scoring: 0.3–1.0 based on days since modification
- Limits results to `RETURN_ALL_LIMIT` (100) or `options.maxK`

---

## 4. Header-Aware Document Chunking

**Decision**: Section-aware chunking with heading hierarchy tracking — chunks break at heading boundaries and carry the heading breadcrumb (path) as metadata. Frontmatter is skipped. Code fences are respected.

**Rationale**: Breaking mid-section loses context. Header-aware chunking ensures each chunk carries its section path (e.g., `["Chapter 1", "Section 1.1"]`) for better retrieval context and result preview.

**Alternatives Considered**:

- **Fixed-size chunks only**: Rejected — breaks mid-sentence and loses structural context.
- **One chunk per heading section**: Rejected — some sections are very long or very short.
- **Recursive character splitter (LangChain default)**: Rejected — not heading-aware.

**Implementation Status**: ✅ **COMPLETE**

- `chunkDocument()` in `chunks.ts` builds section tree from headings
- `parseHeadings()` extracts h1-h6 with code fence awareness
- `buildSections()` creates hierarchical breadcrumb via stack-based tracking
- `findFrontmatterEndLine()` skips YAML frontmatter
- Each chunk carries: `headingPath[]`, `startLine`, `endLine`, `metadata`
- Configurable `maxChars` via `CHUNK_SIZE` constant
- Sentence-boundary overlap is supported by `chunkDocument()` via `overlapSentences`, while shared `ChunkManager` defaults remain conservative (`overlap: 0`) for normal indexing/search flows
- Full test coverage in `chunks.test.ts`

---

## 5. Reranking Strategy

**Decision**: Pluggable reranker with three backends — self-hosted cross-encoder (highest priority), LLM-based reranking (fallback), and no-op (disabled/unavailable).

**Rationale**: Self-host reranking is fastest when available. LLM-based reranking provides a BYOK alternative. No-op is the safe fallback.

**Alternatives Considered**:

- **No reranking**: Rejected — spec FR-005 requires reranking. SC-004 requires measurable improvement.
- **Client-side cross-encoder (WASM)**: Rejected for v1 — bundle size concern.
- **Always LLM-based**: Rejected — expensive and slow for every search.

**Implementation Status**: ✅ **COMPLETE**

- `IReranker` interface in `reranker.ts`
- `SelfHostReranker`: calls `selfHostRerank()` from `selfHostServices.ts`, processes top 20 candidates
- `LLMReranker`: calls active chat model with scoring prompt, parses JSON scores, re-ranks
- `NoopReranker`: returns original order (passthrough)
- `createReranker()` factory: self-host > LLM > noop fallback chain
- Settings toggle: `enableReranking` (default true)
- Integration: called in `SearchCore.ts` after fusion scoring in both semantic and lexical paths
- Test coverage in `reranker.test.ts`

---

## 6. Multilingual Embedding Support

**Decision**: Support multilingual search by allowing users to configure a multilingual embedding model. CJK languages additionally supported via bigram tokenization in the full-text engine. No language-specific logic in the search pipeline.

**Rationale**: Constitution I (Generalizable Solutions) prohibits language-specific handling. Multilingual search is achieved by model choice + CJK tokenizer, not hardcoded language lists.

**Alternatives Considered**:

- **Language detection + per-language models**: Rejected — violates Constitution I.
- **Translation layer before embedding**: Rejected — adds latency and translation errors.
- **Hardcoded multilingual model**: Rejected — violates BYOK principle.

**Implementation Status**: ✅ **COMPLETE**

- `EmbeddingManager` supports multilingual models from all providers (OpenAI, Cohere, Google, Ollama, etc.)
- `FullTextEngine` includes CJK bigram tokenizer (`[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+`)
- `QueryExpander` prompt works across 5+ languages
- Re-index detection on `embeddingModelKey` change triggers full rebuild
- Embedding dimension validation ensures model consistency

---

## 7. Full-Text Engine Architecture

**Decision**: Ephemeral per-query MiniSearch index with BM25+ scoring, rather than a persistent full-text database.

**Rationale**: Ephemeral indexes are simpler (no persistence layer), always fresh (uses current vault state), memory-bounded (via `MemoryManager`), and fast enough for per-query use. This avoids the complexity of maintaining a separate persistent full-text index alongside the vector index.

**Alternatives Considered**:

- **Persistent SQLite FTS5**: Rejected — adds dependency, storage management, and sync complexity.
- **Orama persistent DB**: Legacy approach (deprecated), replaced by MiniSearch.
- **FlexSearch persistent index**: Rejected — MiniSearch has better BM25+ scoring.

**Implementation Status**: ✅ **COMPLETE**

- `FullTextEngine` in `engines/FullTextEngine.ts`
- Hybrid tokenizer: ASCII word splitting + CJK bigram generation
- Field weights: title=5, heading=2.5, headings=1.5, path=1.5, tags=4, body=1
- Memory-bounded via `MemoryManager` (35% of system budget)
- Built from `ChunkManager` candidates per query
- Cleared after use via `clearIndex()`

---

## 8. Query Expansion Strategy

**Decision**: LLM-based query expansion generating alternative phrasings for better recall, with salient term extraction from the original query only.

**Rationale**: Expanding the query to include related phrasings significantly improves recall for natural language search. Extracting salient terms from the original query (not expansions) prevents term drift.

**Implementation Status**: ✅ **COMPLETE**

- `QueryExpander` in `QueryExpander.ts`
- Generates `ExpandedQuery` with `queries[]`, `salientTerms[]`, `originalQuery`, `expandedQueries[]`
- Caching, timeout protection, fallback extraction
- Multilingual prompt support
- Integrated with `TieredLexicalRetriever` and `SearchTools.ts`
