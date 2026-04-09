# Implementation Plan: Enhanced Vault Search

**Branch**: `003-enhanced-vault-search` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-enhanced-vault-search/spec.md`

## Summary

Enhanced vault search system with a local-first hybrid semantic + keyword search engine. Features multilingual embeddings (BYOK), incremental indexing via file change detection, time-based filtering, result reranking, and header-aware document chunking. Builds on the existing mature v3 search architecture (`SearchCore`, `MergedSemanticRetriever`, `TieredLexicalRetriever`, `FilterRetriever`, `QueryExpander`, `FullTextEngine`) and the existing `EmbeddingManager`, `IndexEventHandler`, and `reranker.ts` infrastructure — all of which are already implemented.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API, MiniSearch (BM25+ full-text engine), existing `EmbeddingManager` (supports OpenAI, Cohere, Google, Ollama, etc.)
**Storage**: JSONL snapshot index files in `.copilot/` (existing v3 pattern), index metadata persisted via `indexMetadata.ts`, in-memory MiniSearch ephemeral indices per query
**Testing**: Jest + unit tests adjacent to implementation (`.test.ts` files)
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: Search ≤2s for 10K notes (SC-001), incremental indexing ≤30s for 50 changes (SC-002), full re-index ≤30min for 10K notes (SC-006)
**Constraints**: BYOK embedding model, offline-capable (local search engine), no external search service required, RAM-budget-aware via `MemoryManager`
**Scale/Scope**: 10,000+ notes, multilingual (CJK bigram tokenization + multilingual embeddings via model choice), extends existing v3 search architecture

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                          | Status   | Notes                                                                                                                                                                                                      |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | No hardcoded corpus assumptions. Embedding model, chunk size, scoring weights all configurable. Multilingual support via model choice + CJK bigram tokenizer, not language-specific logic.                 |
| II. Clean Architecture             | **PASS** | Follows existing v3 layering: `SearchCore` → retrievers → engines → backends. `RetrieverFactory` coordinates strategy. Metadata filtering is a composable layer via `FilterRetriever`.                     |
| III. Prompt Integrity              | **PASS** | No prompts modified. Query expansion uses existing `QueryExpander` pattern. LLM-based reranking is an isolated module in `reranker.ts`.                                                                    |
| IV. Type Safety                    | **PASS** | All search types defined in `src/search/types.ts`: `VaultChunk`, `VaultDocument`, `SearchQuery`, `SearchResult`, `TimeRange`, `ScoreBreakdown`, `IndexMetadata`. Strict interfaces throughout.             |
| V. Structured Logging              | **PASS** | All logging via `logInfo`/`logWarn`/`logError` from `@/logger`. No `console.*` calls.                                                                                                                      |
| VI. Testable by Design             | **PASS** | Scoring functions are pure (`computeFusionScore`). Chunking via `chunkDocument()` is pure (text → chunks). Search utils (`computeContentHash`, `parseTitleDate`) are pure functions with plain arguments.  |
| VII. Simplicity & Minimal Overhead | **PASS** | Extends existing v3 architecture rather than replacing it. Reuses `EmbeddingManager`, `IndexEventHandler`, `SearchCore`, `MiniSearch`. No new external services or abstractions beyond what spec requires. |
| VIII. Documentation Discipline     | **PASS** | Will update `docs/vault-search-and-indexing.md` for user-facing changes. JSDoc on all new/modified functions.                                                                                              |

**Gate result: PASS — all principles confirmed.**

## Project Structure

### Documentation (this feature)

```text
specs/003-enhanced-vault-search/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── search/
│   ├── types.ts                           # Core types: VaultChunk, VaultDocument, SearchQuery, SearchResult, TimeRange, ScoreBreakdown, IndexMetadata
│   ├── reranker.ts                        # IReranker interface + NoopReranker, SelfHostReranker, LLMReranker
│   ├── indexOperations.ts                 # Full + incremental indexing with content hash change detection
│   ├── indexEventHandler.ts               # Vault file event → debounced re-indexing
│   ├── indexMetadata.ts                   # Metadata persistence (version, embedding model, document hashes)
│   ├── searchUtils.ts                     # Pure utils: contentHash, titleDateParsing, tagExtraction, headingParsing
│   ├── RetrieverFactory.ts               # Factory for creating retriever pipelines (semantic, lexical, self-host)
│   ├── vectorStoreManager.ts             # Vector store lifecycle management
│   ├── chunkedStorage.ts                 # Chunk storage operations
│   ├── indexBackend/
│   │   ├── SemanticIndexBackend.ts        # Backend interface contract
│   │   ├── OramaIndexBackend.ts           # Orama-based backend
│   │   └── MiyoIndexBackend.ts            # Miyo self-host backend
│   └── v3/
│       ├── SearchCore.ts                  # Main search orchestrator: query→filter→hybrid→rerank→results
│       ├── MergedSemanticRetriever.ts     # Hybrid search: parallel semantic+lexical → RRF fusion
│       ├── TieredLexicalRetriever.ts      # Multi-stage lexical: grep→graph expansion→BM25+ (FlexSearch)
│       ├── FilterRetriever.ts             # Deterministic filters: title mentions, tags, time-range
│       ├── QueryExpander.ts               # LLM-based query expansion + salient term extraction
│       ├── chunks.ts                      # Header-aware chunking: chunkDocument(), ChunkManager
│       ├── mergeResults.ts                # Merge filter + search results with deduplication
│       ├── engines/
│       │   └── FullTextEngine.ts          # BM25+ via MiniSearch with CJK bigram tokenizer
│       ├── scanners/
│       │   └── GrepScanner.ts             # Initial candidate discovery via grep
│       ├── scoring/
│       │   ├── AdaptiveCutoff.ts          # Score threshold calculation
│       │   ├── FolderBoostCalculator.ts   # Folder-based relevance boost
│       │   └── GraphBoostCalculator.ts    # Graph-based boost (backlinks/outlinks)
│       └── utils/
│           ├── ScoreNormalizer.ts          # Min-max normalization
│           ├── FuzzyMatcher.ts            # Flexible term matching
│           ├── MemoryManager.ts           # RAM budget management for indexing
│           └── tagUtils.ts                # Tag extraction and normalization
├── LLMProviders/
│   ├── embeddingManager.ts                # Embedding provider singleton (OpenAI, Cohere, Google, Ollama, etc.)
│   └── selfHostServices.ts               # selfHostRerank(), self-hosted endpoints
├── settings/
│   └── model.ts                           # Search settings: hybridSearchTextWeight, enableReranking, maxSemanticChunkTokens
└── tools/
    └── SearchTools.ts                     # Public search entry point: performLexicalSearch()
```

**Structure Decision**: Extends existing `src/search/` and `src/search/v3/` architecture. No new top-level directories. All changes build on established patterns in the mature v3 search pipeline.

## Post-Design Constitution Re-Check

_Re-evaluated after Phase 1 design (research.md, data-model.md, contracts/, quickstart.md)._

| Principle                          | Status   | Post-Design Notes                                                                                                                                                                                              |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | Confirmed: research.md documents no hardcoded logic. All filtering/chunking/scoring uses configurable parameters. CJK support via bigram tokenizer, not language lists.                                        |
| II. Clean Architecture             | **PASS** | Confirmed: contracts/interfaces.md shows clean layering — SearchCore orchestrates, retrievers compose, engines are pluggable, reranker has IReranker interface.                                                |
| III. Prompt Integrity              | **PASS** | Confirmed: QueryExpander and LLMReranker prompts exist in their own modules. No changes to system prompts or model adapter prompts.                                                                            |
| IV. Type Safety                    | **PASS** | Confirmed: data-model.md reflects all types in `src/search/types.ts`. All entities have strict interfaces with proper optional markers.                                                                        |
| V. Structured Logging              | **PASS** | Confirmed: all search modules use `logInfo`/`logWarn`/`logError`. No console.\* calls.                                                                                                                         |
| VI. Testable by Design             | **PASS** | Confirmed: quickstart.md shows all core functions testable with plain arguments — `computeFusionScore`, `chunkDocument`, `computeContentHash`, `parseTitleDate`.                                               |
| VII. Simplicity & Minimal Overhead | **PASS** | Confirmed: research.md documents deliberate simplicity choices (ephemeral MiniSearch, filter-first time, conservative default chunk overlap with optional sentence overlap where needed). No over-engineering. |
| VIII. Documentation Discipline     | **PASS** | Confirmed: quickstart.md documents all components and their status. `docs/vault-search-and-indexing.md` update noted as required.                                                                              |

**Post-design gate: PASS — no regressions from design decisions.**

## Complexity Tracking

> No constitution violations detected. Table left empty.
