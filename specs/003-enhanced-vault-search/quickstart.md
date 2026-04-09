# Quickstart: Enhanced Vault Search

**Feature**: `003-enhanced-vault-search` | **Date**: 2026-04-08

---

## Overview

The Enhanced Vault Search system is **fully implemented** in the v3 search architecture. This quickstart covers the implementation status of each component and the remaining verification/enhancement items.

---

## Implementation Status

| Component                                 | Location                                   | Status      |
| ----------------------------------------- | ------------------------------------------ | ----------- |
| SearchCore (orchestrator)                 | `src/search/v3/SearchCore.ts`              | ✅ Complete |
| MergedSemanticRetriever (hybrid fusion)   | `src/search/v3/MergedSemanticRetriever.ts` | ✅ Complete |
| TieredLexicalRetriever (grep→graph→BM25+) | `src/search/v3/TieredLexicalRetriever.ts`  | ✅ Complete |
| FullTextEngine (MiniSearch/BM25+)         | `src/search/v3/engines/FullTextEngine.ts`  | ✅ Complete |
| FilterRetriever (time/tag/title)          | `src/search/v3/FilterRetriever.ts`         | ✅ Complete |
| QueryExpander (LLM expansion)             | `src/search/v3/QueryExpander.ts`           | ✅ Complete |
| Reranker (3 backends)                     | `src/search/reranker.ts`                   | ✅ Complete |
| Header-aware chunking                     | `src/search/v3/chunks.ts`                  | ✅ Complete |
| Incremental indexing                      | `src/search/indexOperations.ts`            | ✅ Complete |
| Content hash detection                    | `src/search/searchUtils.ts`                | ✅ Complete |
| Stale index detection                     | `src/search/dbOperations.ts`               | ✅ Complete |
| CJK tokenization                          | `src/search/v3/engines/FullTextEngine.ts`  | ✅ Complete |

---

## Step 1: Understand the Search Pipeline

```
User Query
  │
  ├─ timeRange set? → FilterRetriever → results (filter-first)
  │
  └─ no timeRange → QueryExpander.expand()
       │
       ├─ Semantic path: HybridRetriever (embeddings)
       ├─ Lexical path: TieredLexicalRetriever → FullTextEngine (BM25+)
       ├─ Filter path: FilterRetriever (title mentions, tag matches)
       │
       └─ Merge → Deduplicate → RRF Fusion → Reranker → SearchResult[]
```

---

## Step 2: Verify Core Search

Run unit tests to validate all components:

```bash
npm test -- --testPathPattern="src/search"
```

Key test files:

- `src/search/v3/SearchCore.test.ts` — pipeline integration
- `src/search/v3/engines/FullTextEngine.test.ts` — BM25+ scoring
- `src/search/v3/FilterRetriever.test.ts` — time/tag filtering
- `src/search/reranker.test.ts` — reranker backends
- `src/search/v3/chunks.test.ts` — header-aware chunking
- `src/search/searchUtils.test.ts` — pure utility functions
- `src/search/indexOperations.test.ts` — incremental indexing

---

## Step 3: Verify Incremental Indexing

The incremental indexing system uses dual-layer change detection:

1. **Content hash comparison**: `computeContentHash()` (MD5) in `searchUtils.ts`
2. **mtime fallback**: `file.stat.mtime > latestMtime` check in `indexOperations.ts`

Test with:

```bash
npm test -- -t "computeContentHash"
npm test -- -t "indexOperations"
```

---

## Step 4: Verify Reranking

Three backends with automatic fallback:

| Backend          | Trigger                                       | Test                                    |
| ---------------- | --------------------------------------------- | --------------------------------------- |
| SelfHostReranker | `isSelfHostRerankingAvailable()` returns true | Integration test with self-host service |
| LLMReranker      | Chat model available                          | `npm test -- -t "LLMReranker"`          |
| NoopReranker     | No model available                            | `npm test -- -t "NoopReranker"`         |

Settings: `enableReranking` toggle controls whether reranking runs.

---

## Step 5: Verify Header-Aware Chunking

```bash
npm test -- -t "chunks"
```

Verified behaviors:

- Heading breadcrumb (`headingPath[]`) preserved per chunk
- YAML frontmatter skipped
- Code fences excluded from heading detection
- Chunks respect `maxChars` boundary
- Sentence overlap is available for oversized sections when `overlapSentences` is configured, while default shared chunking remains non-overlapping

---

## Step 6: Verify Time-Based Filtering

```bash
npm test -- -t "FilterRetriever"
```

Current behavior: **filter-first** (hard time constraint, no semantic fusion).
Results within time window ordered by recency score (0.3–1.0).

---

## Step 7: Verify Tag Filtering

```bash
npm test -- -t "tag"
```

Verified behaviors:

- Simple tag match: `#project` matches `#project`
- Hierarchical prefix: `#project` matches `#project/alpha`
- Unicode-aware regex for multilingual tags
- Tags extracted from both query and salient terms

---

## Step 8: Remaining Enhancement Items

| Item               | Priority | Description                                                                                         |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------- |
| Time-filter fusion | P2       | Consider blending semantic relevance with the current hard time constraint (currently filter-first) |

This is an optional enhancement, not a blocker. The feature is production-ready as implemented.

---

## Step 9: Verify Performance Targets

Use the existing focused tests as the baseline verification harness for the measurable success criteria:

```bash
npm test -- --testPathPattern="src/search/v3/SearchCore.search.test.ts"
npm test -- --testPathPattern="src/search/indexOperations.test.ts"
```

Current benchmark coverage:

- `src/search/v3/SearchCore.search.test.ts` checks that 1000 semantic results are processed within the 2 second search budget used by SC-001.
- `src/search/indexOperations.test.ts` checks that 50 changed files can be incrementally reindexed within the 30 second budget used by SC-002.

For larger local vault validations, repeat the same flows against a representative 10K-note fixture and record elapsed time for:

- Search latency (`SC-001`)
- Incremental indexing of 50 changed files (`SC-002`)
- Full re-index duration (`SC-006`)

---

## Step 10: Verify Reranking Quality

Use the reranker unit tests as the correctness baseline:

```bash
npm test -- --testPathPattern="src/search/reranker.test.ts"
```

Then evaluate top-5 ordering quality on a fixed local query set:

1. Prepare a representative set of vault queries with an expected top-5 ranking.
2. Capture the raw fusion order with reranking disabled.
3. Capture the reranked order with reranking enabled.
4. Compare whether the reranked order improves the top-5 relevance for the same query set.

This is the manual evaluation path for `SC-004` until a dedicated offline relevance corpus is added.

---

## Step 11: Verify Network Boundary Assumptions

Audit the search pipeline before release to confirm data only leaves the plugin through configured providers:

- Embeddings are sent to the user-selected embedding provider.
- Self-host reranking stays on the configured self-host endpoint.
- If LLM reranking is enabled, query/result snippets are sent to the active chat model provider.

If strict self-host-only operation is required for reranking, disable LLM reranking in the release configuration or limit deployments to self-host/noop rerank modes.

---

## Architecture Files Reference

```
src/search/
├── v3/
│   ├── SearchCore.ts              # Main search orchestrator
│   ├── MergedSemanticRetriever.ts # Hybrid fusion coordinator
│   ├── TieredLexicalRetriever.ts  # Lexical retrieval tiers
│   ├── FilterRetriever.ts         # Time/tag/title filtering
│   ├── QueryExpander.ts           # LLM query expansion
│   ├── chunks.ts                  # Header-aware chunking
│   ├── engines/
│   │   └── FullTextEngine.ts      # MiniSearch BM25+ engine
│   └── utils/
│       └── MemoryManager.ts       # Memory budget management
├── reranker.ts                    # Pluggable reranker
├── indexOperations.ts             # Index lifecycle + incremental
├── searchUtils.ts                 # Pure utility functions
├── types.ts                       # All search type definitions
└── dbOperations.ts                # Vector DB operations
```
