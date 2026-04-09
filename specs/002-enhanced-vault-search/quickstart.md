# Quickstart: Enhanced Vault Search

**Feature**: `002-enhanced-vault-search` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: Enhanced Chunking

Modify `src/search/v3/chunks.ts`:

- Add header-aware sliding window chunking
- Parse markdown headings to build section tree
- Each chunk carries `headingPath`, `startLine`, `endLine` metadata
- Configurable `maxChunkTokens` with sentence-boundary splitting
- Overlap: last 1-2 sentences of previous chunk

### Step 2: Metadata Extraction

Modify `src/search/searchUtils.ts`:

- Extract tags from YAML frontmatter and inline tags
- Extract all headings from document
- Parse date from filename (multiple patterns: `YYYY-MM-DD`, `YYYY.MM.DD`)
- Compute content hash (MD5) for change detection

### Step 3: Incremental Indexing

Modify `src/search/indexOperations.ts`:

- Store `IndexMetadata` with document hashes and embedding model
- `detectChanges()`: compare current file hashes against stored
- `updateChanged()`: re-embed only changed/new files, remove deleted
- `rebuildAll()`: full re-index with progress callback

Modify `src/search/indexEventHandler.ts`:

- Debounce real-time file changes (500ms)
- Batch re-index on vault open

### Step 4: Hybrid Score Fusion

Add fusion scoring to `src/search/v3/SearchCore.ts`:

- After semantic and lexical retrieval, merge using RRF
- Pure function `computeFusionScore()` for testability
- Configurable `textWeight` parameter controlling relative influence

Modify `src/search/v3/MergedSemanticRetriever.ts`:

- Expose raw semantic scores for fusion

Modify `src/search/v3/TieredLexicalRetriever.ts`:

- Expose BM25 scores for fusion

### Step 5: Enhanced Time Filtering

Modify `src/search/v3/FilterRetriever.ts`:

- Filter by file mtime AND title date AND frontmatter date
- Accept `TimeRange` with `start`/`end` epoch ms
- Integrate with existing `getTimeRangeMsTool` for natural language parsing

### Step 6: Reranker Module

Create `src/search/reranker.ts`:

- `IReranker` interface with pluggable backends
- Self-host backend: use existing `selfHostRerank()` from `selfHostServices.ts`
- LLM backend: batch top-20 results, ask LLM to score relevance
- Fallback: return original order if no reranker available
- Applied as post-processing on top-N results only

### Step 7: Settings and Model Change Detection

Modify `src/settings/model.ts`:

- Add `hybridSearchTextWeight`, `enableReranking`, `maxChunkTokens`
- On `embeddingModelKey` change: compare against `IndexMetadata.embeddingModel`
- If mismatch: show warning notice, prompt for full re-index

### Step 8: Wire SearchCore

Modify `src/search/v3/SearchCore.ts`:

- Plumb `SearchQuery` with time range and tag filters
- Call fusion scoring after retrieval
- Call reranker on fused results
- Return `SearchResult[]` with score breakdown

---

## Prerequisites

- Existing v3 search architecture functional
- `EmbeddingManager` working with at least one provider
- Existing `IndexEventHandler` operational

---

## Verification Checklist

- [ ] Natural language query returns semantically relevant results in <2s for 1K note vault
- [ ] Exact keyword search returns exact match as top result (hybrid)
- [ ] Incremental index detects and re-embeds only changed files
- [ ] Full re-index completes for test vault
- [ ] Time-filtered search returns only notes from specified period
- [ ] Reranking improves top-5 relevance (manual comparison)
- [ ] Embedding model change triggers stale index warning
- [ ] Deleted files are removed from index
- [ ] New files are indexed within 10 seconds
- [ ] Chunks carry heading path metadata
- [ ] Score breakdown available in search results
- [ ] All pure functions have passing unit tests

---

## Key Files Reference

| File                                       | Purpose                           |
| ------------------------------------------ | --------------------------------- |
| `src/search/v3/SearchCore.ts`              | Main search engine (modified)     |
| `src/search/v3/chunks.ts`                  | Header-aware chunking (modified)  |
| `src/search/v3/FilterRetriever.ts`         | Time-range filtering (modified)   |
| `src/search/v3/MergedSemanticRetriever.ts` | Semantic scoring (modified)       |
| `src/search/v3/TieredLexicalRetriever.ts`  | BM25 scoring (modified)           |
| `src/search/indexOperations.ts`            | Incremental indexing (modified)   |
| `src/search/indexEventHandler.ts`          | File change handling (modified)   |
| `src/search/searchUtils.ts`                | Metadata extraction (modified)    |
| `src/search/reranker.ts`                   | Result reranking (new)            |
| `src/search/RetrieverFactory.ts`           | Strategy orchestration (modified) |
