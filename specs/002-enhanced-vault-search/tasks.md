# Tasks: Enhanced Vault Search

**Input**: Design documents from `/specs/002-enhanced-vault-search/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Not explicitly requested in spec — test tasks omitted. Pure function unit tests included in implementation tasks per project conventions.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define shared types and data model used across all user stories

- [x] T001 Add `VaultDocument`, `VaultChunk`, `ChunkMetadata`, `SearchQuery`, `TimeRange`, `SearchResult`, `ScoreBreakdown`, `IndexMetadata`, and `IndexStats` types to src/search/types.ts (or a new src/search/searchTypes.ts if types.ts is too large). Note: `SearchQuery` does not include a `tags` field — tag filtering is deferred to a future iteration
- [x] T002 [P] Add new settings fields `hybridSearchTextWeight` (number, default 0.3), `enableReranking` (boolean, default true), and `maxChunkTokens` (number, default 512) to src/settings/model.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story — metadata extraction and header-aware chunking are used by all stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Implement `computeContentHash(content: string): string` (MD5) pure function in src/search/searchUtils.ts with unit test
- [x] T004 [P] Implement `parseTitleDate(filename: string): number | undefined` pure function in src/search/searchUtils.ts supporting `YYYY-MM-DD`, `YYYY.MM.DD`, and `YYYYMMDD` patterns, with unit test
- [x] T005 [P] Implement metadata extraction functions in src/search/searchUtils.ts: extract tags (frontmatter + inline), extract headings, and compute word count from markdown content
- [x] T006 Implement header-aware sliding window chunking in src/search/v3/chunks.ts: strip YAML frontmatter before chunking (metadata already extracted in T005), parse markdown headings into section tree, split at heading boundaries with fallback to paragraph/sentence boundaries, carry `headingPath`, `startLine`, `endLine` metadata per chunk, configurable `maxChunkTokens` and `overlapSentences`, with unit tests for the pure `chunkDocument()` function

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel

---

## Phase 3: User Story 1 — Natural Language Vault Search (Priority: P1) 🎯 MVP

**Goal**: Users can type a natural language query and get semantically relevant notes ranked by similarity within 2 seconds for vaults up to 10K notes.

**Independent Test**: Index a vault with 100+ notes. Search for a concept using different phrasing than what appears in the notes. Verify the correct notes appear in the top 5 results within 2s.

### Implementation for User Story 1

- [x] T007 [US1] Extend `SearchCore.search()` in src/search/v3/SearchCore.ts to accept `SearchQuery` type (queryText, resultLimit) and return `SearchResult[]` with `ScoreBreakdown` (semantic score populated, others zeroed). Rename existing `retrieve()` to `search()` to align with `ISearchEngine` contract
- [x] T008 [US1] Modify src/search/v3/MergedSemanticRetriever.ts to expose raw cosine similarity scores per result (not just sorted order) so they can be included in `ScoreBreakdown.semanticScore`
- [x] T009 [US1] Modify src/search/RetrieverFactory.ts to plumb the new `SearchQuery` options through to `MergedSemanticRetriever` and return results as `SearchResult[]` with score breakdown
- [x] T010 [US1] Wire header-aware chunking from T006 into the indexing pipeline in src/search/indexOperations.ts so new embeddings use `VaultChunk` with heading metadata
- [x] T011 [US1] Store `IndexMetadata` (version, embeddingModel, embeddingDimension, lastFullIndexAt, documentHashes) alongside the JSONL index in src/search/indexOperations.ts for model change detection (FR-010)
- [x] T011b [US1] Implement `isIndexStale(): boolean` and `getIndexStats(): IndexStats` methods on SearchCore in src/search/v3/SearchCore.ts per `ISearchEngine` contract (reads from `IndexMetadata` stored in T011)

**Checkpoint**: Natural language search returns ranked semantic results with score breakdown. Core search flow is functional.

---

## Phase 4: User Story 2 — Incremental Index Updates (Priority: P2)

**Goal**: On vault open or file change, only modified/new/deleted files are re-indexed instead of the full vault. Incremental indexing completes in <30s for up to 50 changes.

**Independent Test**: Index a vault, modify 3 notes, reopen. Verify only 3 notes are re-embedded (check processing count). Search for new content and confirm it appears.

### Implementation for User Story 2

- [x] T012 [US2] Implement `detectChanges(): Promise<string[]>` in src/search/indexOperations.ts — compute content hashes for all markdown files, compare against `IndexMetadata.documentHashes`, return list of changed/new file paths
- [x] T013 [US2] Implement `updateChanged(): Promise<number>` in src/search/indexOperations.ts — re-embed only the files returned by `detectChanges()`, remove index entries for deleted files, update `IndexMetadata.documentHashes`. On embedding API failure: skip the file, log the error via `logWarn()`, and continue with remaining files (failed files remain in the changed set for next run)
- [x] T014 [US2] Implement `removeDocument(filePath: string): Promise<void>` in src/search/indexOperations.ts — remove a document and all its chunks from the index
- [x] T015 [US2] Modify src/search/indexEventHandler.ts to debounce real-time file change events (500ms) and call `updateChanged()` for batched re-indexing
- [x] T016 [US2] Implement batch re-index on vault open: in src/search/indexEventHandler.ts, call `detectChanges()` on plugin load and queue changed files for re-embedding
- [x] T017 [US2] Implement `rebuildAll(onProgress?: (current: number, total: number) => void): Promise<void>` in src/search/indexOperations.ts — full re-index with progress callback for UI feedback

**Checkpoint**: Incremental indexing works — only changed files are re-embedded on vault open and file change events.

---

## Phase 5: User Story 3 — Time-Based Search Filtering (Priority: P3)

**Goal**: Users can filter search results by time period (e.g., "notes from last week about project X"), returning only notes matching both content query and time range.

**Independent Test**: Create notes across different dates. Search with a time qualifier. Verify only notes from the specified time range are returned.

### Implementation for User Story 3

- [x] T018 [US3] Enhance src/search/v3/FilterRetriever.ts to accept `TimeRange` filter and filter results by file mtime, title date (from `parseTitleDate`), and YAML frontmatter `date` field
- [x] T019 [US3] Plumb `SearchQuery.timeRange` through src/search/RetrieverFactory.ts to `FilterRetriever` so time range is applied during search flow
- [x] T020 [US3] Wire time range into src/search/v3/SearchCore.ts `search()` method — pass `SearchQuery.timeRange` to the retriever pipeline and ensure filtered results still populate full `SearchResult` type

**Checkpoint**: Time-filtered search works — queries with time qualifiers return only notes from the specified period.

---

## Phase 6: User Story 4 — Hybrid Search (Priority: P4)

**Goal**: Combine semantic similarity with BM25 keyword matching via Reciprocal Rank Fusion so exact-match queries rank #1 while semantic results also appear.

**Independent Test**: Search for a unique term that appears verbatim in one note. Verify that note ranks #1, even if other notes are semantically related.

### Implementation for User Story 4

- [x] T021 [P] [US4] Implement pure function `computeFusionScore(semanticResults, lexicalResults, k=60): Array<{id, fusionScore}>` using Reciprocal Rank Fusion in src/search/v3/SearchCore.ts with unit test
- [x] T022 [US4] Modify src/search/v3/TieredLexicalRetriever.ts to expose raw BM25 scores per result (not just sorted order) for fusion scoring
- [x] T023 [US4] Integrate fusion scoring into src/search/v3/SearchCore.ts `search()` method — after both semantic and lexical retrieval, merge results using `computeFusionScore()` with configurable `textWeight` from `SearchQuery`
- [x] T024 [US4] Populate `ScoreBreakdown.lexicalScore` and `ScoreBreakdown.fusionScore` on returned `SearchResult[]` in src/search/v3/SearchCore.ts

**Checkpoint**: Hybrid search works — exact keyword matches rank #1, semantic results fill remaining positions. `textWeight` controls balance.

---

## Phase 7: Embedding Model Safety (Cross-Cutting — FR-010)

**Goal**: Detect embedding model changes and prevent stale-index searches. This is prerequisite infrastructure for multilingual search (US5) — multilingual capability itself requires no code changes, only configuring a multilingual embedding model (see research.md §6).

**Independent Test**: Change embedding model in settings. Verify stale-index warning appears and searches are blocked until `rebuildAll()` completes.

### Implementation for Model Safety

- [x] T025 Implement embedding model change detection in src/settings/model.ts: on `embeddingModelKey` change, compare against stored `IndexMetadata.embeddingModel` and show warning notice prompting full re-index if mismatch
- [x] T026 Implement embedding dimension validation in src/search/indexOperations.ts: on index load, verify stored `IndexMetadata.embeddingDimension` matches current model's output dimension; warn and block search if mismatch
- [x] T027 Mark index as `Stale` state when embedding model changes in src/search/indexOperations.ts — prevent searches on stale index, prompt user for `rebuildAll()`

**Checkpoint**: Model changes trigger stale-index warnings. Searches blocked until re-index. Multilingual search works with no code changes when user configures a multilingual model.

---

## Phase 8: Reranking (Cross-Cutting — Enhances US1, US4)

**Goal**: Plug in a reranker as a post-processing step on fused results to measurably improve top-5 relevance (FR-005, SC-004).

**Independent Test**: Compare top-5 results with reranking enabled vs. disabled. Verify reranked order better matches expected relevance.

### Implementation for Reranking

- [x] T028 [P] Create src/search/reranker.ts with `IReranker` interface and two backend implementations: self-host (using existing `selfHostRerank()` from src/LLMProviders/selfHostServices.ts) and LLM-based (batch top-20 results, ask LLM to score 0-10 relevance)
- [x] T029 Implement reranker strategy selection in src/search/reranker.ts: use self-host cross-encoder if available, else LLM-based if LLM configured, else return original order as fallback
- [x] T030 Integrate reranker into src/search/v3/SearchCore.ts `search()` — after fusion scoring, call `IReranker.rerank()` on top-N results when `enableReranking` setting is true; populate `ScoreBreakdown.rerankScore`
- [x] T031 Wire `enableReranking` toggle from settings into `SearchCore` search flow via src/search/RetrieverFactory.ts

**Checkpoint**: Reranking improves top-5 relevance when enabled. Graceful fallback when no reranker backend is available.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, validation, and cleanup across all stories

- [x] T032 [P] Update docs/vault-search-and-indexing.md with documentation for: hybrid search, time filtering, reranking toggle, incremental indexing behavior, embedding model change handling, and recommended multilingual models
- [x] T033 [P] Add JSDoc comments to all new public functions and interfaces across all modified files
- [x] T034 Run quickstart.md verification checklist — validate all 12 items pass end-to-end
- [x] T035 Performance validation: verify search ≤2s for 10K notes (SC-001), incremental indexing ≤30s for 50 changes (SC-002), full re-index ≤30min for 10K notes (SC-006)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (types must exist first) — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Phase 2 — core search path
- **US2 (Phase 4)**: Depends on Phase 2 + T011 from US1 (needs IndexMetadata storage)
- **US3 (Phase 5)**: Depends on Phase 2 + T004 (parseTitleDate) — can run in parallel with US1/US2
- **US4 (Phase 6)**: Depends on US1 (T008 semantic scores exposed) — needs semantic pipeline working
- **Model Safety (Phase 7)**: Depends on T011 from US1 (IndexMetadata) + T017 from US2 (rebuildAll)
- **Reranking (Phase 8)**: Depends on US4 (fusion scoring in SearchCore)
- **Polish (Phase 9)**: Depends on all previous phases

### User Story Dependencies

```
Phase 1 (Setup)
  └── Phase 2 (Foundational)
        ├── US1 (Phase 3) — core search
        │     ├── US2 (Phase 4) — incremental indexing (needs T011)
        │     │     └── Model Safety (Phase 7) — FR-010 (needs T017)
        │     └── US4 (Phase 6) — hybrid search (needs T008)
        │           └── Reranking (Phase 8)
        └── US3 (Phase 5) — time filtering (independent, needs T004)
              └── (integrates with SearchCore via T020)
```

### Parallel Opportunities

- **Phase 1**: T001 and T002 can run in parallel
- **Phase 2**: T003, T004, T005 can run in parallel; T006 can start in parallel but is independent
- **Phase 3 + Phase 5**: US1 and US3 can be worked on in parallel after Phase 2
- **Phase 6**: T021 (pure fusion function) can start as soon as types exist, in parallel with other US4 tasks
- **Phase 8**: T028 (reranker module) can start in parallel with US4 integration tasks
- **Phase 9**: T032 and T033 can run in parallel

---

## Implementation Strategy

### MVP Scope: User Story 1 (Phase 1 + Phase 2 + Phase 3)

Delivers core natural language vault search with header-aware chunking and semantic results. This alone provides the core differentiator over Obsidian's built-in search.

### Incremental Delivery Order

1. **MVP**: Setup → Foundational → US1 (natural language search works)
2. **+Incremental**: US2 (index stays current without full rebuilds)
3. **+Time Filtering**: US3 (search by time period)
4. **+Hybrid**: US4 (exact keyword matches rank #1)
5. **+Model Safety**: Phase 7 (embedding model change detection — enables multilingual via model config)
6. **+Reranking**: Phase 8 (improved top-N relevance)
7. **Polish**: Documentation, performance validation

---

## Summary

| Metric                   | Count |
| ------------------------ | ----- |
| **Total tasks**          | 36    |
| **Setup tasks**          | 2     |
| **Foundational tasks**   | 4     |
| **US1 tasks**            | 6     |
| **US2 tasks**            | 6     |
| **US3 tasks**            | 3     |
| **US4 tasks**            | 4     |
| **Model Safety tasks**   | 3     |
| **Reranking tasks**      | 4     |
| **Polish tasks**         | 4     |
| **Parallelizable tasks** | 11    |
| **New files**            | 1     |
| **Modified files**       | ~10   |
