# Implementation Plan: Enhanced Vault Search

**Branch**: `002-enhanced-vault-search` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-enhanced-vault-search/spec.md`

## Summary

Enhanced vault search system replacing the Miyo/Brevilabs search backend with a fully self-hosted hybrid semantic + keyword search engine. Features multilingual embeddings (BYOK), incremental indexing via file change detection, time-based filtering, result reranking, and header-aware document chunking. Extends the existing v3 search architecture (`SearchCore`, `MergedSemanticRetriever`, `TieredLexicalRetriever`) and builds on the existing `EmbeddingManager` and `IndexEventHandler` infrastructure.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API, existing `EmbeddingManager` (supports OpenAI, Cohere, Google, Ollama, etc.)
**Storage**: JSONL snapshot index files in `.copilot/` (existing v3 pattern), metadata stored alongside embeddings
**Testing**: Jest + unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: Search ≤2s for 10K notes (SC-001), incremental indexing ≤30s for 50 changes (SC-002), full re-index ≤30min for 10K notes (SC-006)
**Constraints**: BYOK embedding model, offline-capable (local search engine), no external search service required
**Scale/Scope**: 10,000+ notes, multilingual, ~6 modified/new files, extends existing v3 search architecture

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                          | Status   | Notes                                                                                                                                                                                                       |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | No hardcoded corpus assumptions. Embedding model, chunk size, and scoring weights all configurable. Multilingual support via model choice, not language-specific logic.                                     |
| II. Clean Architecture             | **PASS** | Extends existing single source of truth: `SearchCore` → retrievers → index backends. `RetrieverFactory.select()` coordinates strategy. Metadata filtering is a composable layer.                            |
| III. Prompt Integrity              | **PASS** | No prompts modified. Query expansion uses existing `QueryExpander` pattern. Reranking prompt (if LLM-based) is a new, isolated module.                                                                      |
| IV. Type Safety                    | **PASS** | Extends existing `TextChunk`, `RetrieverOptions` types. `SearchQuery` and `SearchResult` types with strict time range filtering.                                                                            |
| V. Structured Logging              | **PASS** | All logging via `logInfo/logWarn/logError`.                                                                                                                                                                 |
| VI. Testable by Design             | **PASS** | Scoring functions are pure (query + documents → ranked results). Chunking is pure (text → chunks). Index operations are testable with in-memory backends.                                                   |
| VII. Simplicity & Minimal Overhead | **PASS** | Extends existing v3 architecture rather than replacing it. Reuses `EmbeddingManager`, `IndexEventHandler`, `SearchCore`. No new external services. Incremental indexing uses existing file hash comparison. |
| VIII. Documentation Discipline     | **PASS** | Will update `docs/vault-search-and-indexing.md`. JSDoc on all new functions.                                                                                                                                |

**Gate result: PASS — all principles confirmed.**

## Project Structure

### Documentation (this feature)

```text
specs/002-enhanced-vault-search/
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
│   ├── v3/
│   │   ├── SearchCore.ts                  # MODIFIED — add time-range filter support, result reranking
│   │   ├── MergedSemanticRetriever.ts     # MODIFIED — configurable scoring weights for hybrid search
│   │   ├── TieredLexicalRetriever.ts      # MODIFIED — expose BM25 scores for fusion
│   │   ├── FilterRetriever.ts             # MODIFIED — enhanced time-range filtering (date titles + mtime)
│   │   ├── QueryExpander.ts               # EXISTING — reused for query expansion
│   │   ├── chunks.ts                      # MODIFIED — add header-aware sliding window chunking
│   │   └── engines/                       # EXISTING — semantic + lexical engines
│   ├── indexOperations.ts                 # MODIFIED — incremental indexing with content hash comparison
│   ├── indexEventHandler.ts               # MODIFIED — debounced re-embedding on file change
│   ├── searchUtils.ts                     # MODIFIED — add metadata extraction (tags, headings, dates)
│   ├── RetrieverFactory.ts               # MODIFIED — plumb time-range and hybrid weight options
│   └── reranker.ts                        # NEW — result reranking (cross-encoder or LLM-based)
├── LLMProviders/
│   ├── embeddingManager.ts                # EXISTING — reused for embedding generation
│   └── selfHostServices.ts               # EXISTING — selfHostRerank() already exists, extend
└── settings/
    └── model.ts                           # MODIFIED — add hybrid search weight, reranker toggle settings
```

**Structure Decision**: Extends existing `src/search/v3/` architecture. No new top-level directories. The reranker gets its own module since it's a composable post-processing step. All changes build on established patterns.

## Complexity Tracking

> No constitution violations detected. Table left empty.
