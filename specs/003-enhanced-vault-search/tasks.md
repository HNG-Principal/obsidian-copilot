# Tasks: Enhanced Vault Search

**Input**: Design documents from `/specs/003-enhanced-vault-search/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Context**: The v3 search architecture is **already implemented**. All 12 core components are complete with 21 test files. Tasks focus on verifying the implementation against the spec, reconciling artifact-level inconsistencies (chunking and time-filter behavior), closing explicit requirement-coverage gaps, measuring the stated success criteria, and satisfying constitution validation gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Verification Infrastructure)

**Purpose**: Confirm all existing infrastructure is healthy before verifying user stories

- [x] T001 Run full search test suite and confirm all tests pass via `npm test -- --testPathPattern="src/search"`
- [x] T002 [P] Verify all search types in `src/search/types.ts` match data-model.md entity definitions (VaultDocument, VaultChunk, ChunkMetadata, SearchQuery, TimeRange, SearchResult, ScoreBreakdown, IndexMetadata, IndexStats)
- [x] T003 [P] Verify `src/search/reranker.ts` exports match contracts/interfaces.md (IReranker interface, createReranker factory, isSelfHostRerankingAvailable)
- [x] T004 [P] Verify indexing entry points in `src/search/indexOperations.ts` use the configured provider from `src/LLMProviders/embeddingManager.ts` and process markdown-note inputs only, matching FR-001 assumptions

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Validate the core search pipeline and indexing backbone that all user stories depend on

**⚠️ CRITICAL**: No user story verification can be meaningful until these pass

- [x] T005 Verify `SearchCore.search()` pipeline in `src/search/v3/SearchCore.ts` handles both timeRange and non-timeRange paths correctly per contracts/interfaces.md pipeline diagram
- [x] T006 [P] Verify embedding dimension validation in `src/search/indexOperations.ts` — confirm `validateStoredEmbeddingDimension()` blocks indexing on mismatch and sets `stale: true` in metadata
- [x] T007 [P] Verify stale index detection in `src/search/dbOperations.ts` — confirm `checkAndHandleEmbeddingModelChange()` triggers full rebuild with user Notice on model switch (FR-010)
- [x] T008 [P] Verify `computeContentHash()` in `src/search/searchUtils.ts` produces stable MD5 hashes and existing test in `src/search/searchUtils.test.ts` covers determinism
- [x] T009 Verify `ChunkManager` in `src/search/v3/chunks.ts` correctly caches chunks and `getSharedChunkManager()` returns singleton per contracts/interfaces.md
- [x] T010 [P] Verify metadata persisted from `src/search/indexOperations.ts` into `src/search/types.ts` includes file path, modification date, headings, and tags, and that `src/search/v3/FilterRetriever.ts` and `src/search/v3/engines/FullTextEngine.ts` consume that metadata for filtering/ranking (FR-007)
- [x] T011 Resolve the chunking contract across `specs/003-enhanced-vault-search/spec.md`, `specs/003-enhanced-vault-search/plan.md`, `specs/003-enhanced-vault-search/research.md`, and `src/search/v3/chunks.ts`: decide whether the feature guarantees sliding-window overlap or header-aware non-overlapping chunks, then update the artifacts and `src/search/v3/chunks.test.ts` to match (FR-008)

**Checkpoint**: Foundation verified — user story acceptance testing can begin

---

## Phase 3: User Story 1 — Natural Language Vault Search (Priority: P1) 🎯 MVP

**Goal**: Verify semantic search returns relevant notes ranked by similarity within 2s for 10K notes (SC-001)

**Independent Test**: Index a vault with 100+ notes. Search with different phrasing than note content. Verify correct notes in top 5.

### Verification for User Story 1

- [x] T012 [US1] Verify `MergedSemanticRetriever` in `src/search/v3/MergedSemanticRetriever.ts` runs semantic and lexical retrieval in parallel and merges results via RRF fusion
- [x] T013 [US1] Verify `QueryExpander.expand()` in `src/search/v3/QueryExpander.ts` generates alternative phrasings with salient terms — confirm existing tests in `src/search/v3/QueryExpander.test.ts` cover multilingual prompts and timeout fallback
- [x] T014 [P] [US1] Verify `SearchResult.scoreBreakdown` in `src/search/v3/SearchCore.ts` populates all fields (semanticScore, lexicalScore, fusionScore, rerankScore) per data-model.md ScoreBreakdown entity
- [x] T015 [P] [US1] Verify `SearchResult.sectionPreview` in `src/search/v3/SearchCore.ts` returns a truncated content preview suitable for display — confirm sourceDocument path is included (FR-009)
- [x] T016 [US1] Add acceptance test in `src/search/v3/SearchCore.search.test.ts` verifying that a natural language query returns semantically relevant results (mock embeddings with known cosine similarity) — validates SC-001 acceptance scenario 1
- [x] T017 [US1] Add a representative latency benchmark in `src/search/v3/SearchCore.search.test.ts` or `specs/003-enhanced-vault-search/quickstart.md` for a 10K-note corpus and verify `SearchCore.search()` meets SC-001 (≤2s)

**Checkpoint**: Natural language search verified — can search vault by meaning, not just keywords

---

## Phase 4: User Story 2 — Incremental Index Updates (Priority: P2)

**Goal**: Verify only changed files are re-indexed, completing in <30s for 50 changes (SC-002)

**Independent Test**: Index a vault, modify 3 notes, verify only 3 re-embedded via logs/count

### Verification for User Story 2

- [x] T018 [US2] Verify `detectChanges()` in `src/search/indexOperations.ts` correctly identifies new, modified, and deleted files by comparing `IndexMetadata.documentHashes` against current vault state
- [x] T019 [US2] Verify `updateChanged()` in `src/search/indexOperations.ts` re-indexes only changed files and updates `documentHashes` in metadata — confirm existing tests in `src/search/indexOperations.test.ts` cover add/modify/delete scenarios
- [x] T020 [P] [US2] Verify dual-layer change detection: content hash comparison (via `computeContentHash`) AND mtime fallback (via `getFilesToIndex` mtime check) in `src/search/indexOperations.ts`
- [x] T021 [P] [US2] Verify `indexEventHandler.ts` in `src/search/indexEventHandler.ts` debounces vault file events (create, modify, delete, rename) and triggers re-indexing
- [x] T022 [US2] Add acceptance test in `src/search/indexOperations.test.ts` verifying that after modifying N files, only N files are re-embedded (not the full vault) — validates SC-002 acceptance scenario 1
- [x] T023 [US2] Add a 50-changed-note benchmark in `src/search/indexOperations.test.ts` or `specs/003-enhanced-vault-search/quickstart.md` and verify incremental indexing meets SC-002 (<30s)

**Checkpoint**: Incremental indexing verified — vault stays current without full rebuild

---

## Phase 5: User Story 3 — Time-Based Search Filtering (Priority: P3)

**Goal**: Verify time range filters correctly restrict results to matching dates (FR-004)

**Independent Test**: Create notes across dates, search with time qualifier, verify only matching dates returned

### Verification for User Story 3

- [x] T024 [US3] Verify `FilterRetriever` in `src/search/v3/FilterRetriever.ts` correctly handles `timeRange` filter — confirm it extracts dates from file mtime, title date patterns, and frontmatter date
- [x] T025 [US3] Reconcile time-range query behavior across `specs/003-enhanced-vault-search/spec.md`, `specs/003-enhanced-vault-search/plan.md`, `specs/003-enhanced-vault-search/research.md`, and `src/search/v3/SearchCore.ts`: decide whether time-aware queries combine hybrid retrieval with filtering or use the current filter-first branch, then update the artifacts and tests to match
- [x] T026 [P] [US3] Verify recency scoring (0.3–1.0 range) in `src/search/v3/FilterRetriever.ts` — confirm newer notes within time window score higher than older ones
- [x] T027 [P] [US3] Verify `parseTitleDate()` in `src/search/searchUtils.ts` handles YYYY-MM-DD and other date formats — confirm existing tests in `src/search/searchUtils.test.ts` cover edge cases
- [x] T028 [US3] Add an acceptance test in `src/search/v3/SearchCore.search.test.ts` for the chosen time-aware behavior using queries like "project updates from last week" and "meeting notes from January 2026" so User Story 3 is explicitly covered end to end

**Checkpoint**: Time filtering verified — users can constrain results to specific date ranges

---

## Phase 6: User Story 4 — Hybrid Search (Priority: P4)

**Goal**: Verify exact keyword matches rank #1 in hybrid results (SC-003)

**Independent Test**: Search for a unique project code name that exists verbatim in one note, verify it ranks #1

### Verification for User Story 4

- [x] T029 [US4] Verify `FullTextEngine` in `src/search/v3/engines/FullTextEngine.ts` BM25+ scoring with field boosts (title=5, heading=2.5, tags=4, body=1) — confirm existing tests in `src/search/v3/engines/FullTextEngine.test.ts` validate exact keyword match ranking
- [x] T030 [US4] Verify `computeFusionScore()` in `src/search/v3/SearchCore.ts` correctly combines semantic and lexical ranked lists via RRF — confirm existing test coverage
- [x] T031 [P] [US4] Verify `hybridSearchTextWeight` setting (0.0–1.0, default 0.3) in `src/settings/model.ts` is properly consumed by `SearchCore` to weight lexical vs semantic scores
- [x] T032 [P] [US4] Verify `TieredLexicalRetriever` in `src/search/v3/TieredLexicalRetriever.ts` multi-stage pipeline (grep → graph boost → BM25+) provides exact-match escalation — confirm existing tests cover tiered fallback
- [x] T033 [US4] Add acceptance test in `src/search/v3/SearchCore.search.test.ts` verifying that a unique exact-match term ranks #1 when hybrid search is enabled — validates SC-003 acceptance scenario 1
- [x] T034 [US4] Add a comparison test or benchmark in `src/search/v3/SearchCore.search.test.ts` showing hybrid search outperforms pure vector search on keyword-specific queries, matching SC-003

**Checkpoint**: Hybrid search verified — both exact keywords and semantic meaning contribute to ranking

---

## Phase 7: User Story 5 — Multilingual Search (Priority: P5)

**Goal**: Verify cross-language search works when multilingual embedding model is configured (SC-005)

**Independent Test**: Notes in 2 languages about same topic, search in one language, verify other appears

### Verification for User Story 5

- [x] T035 [US5] Verify CJK bigram tokenizer in `src/search/v3/engines/FullTextEngine.ts` — confirm `tokenizeMixed()` handles CJK character ranges ([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]) alongside ASCII tokens
- [x] T036 [P] [US5] Verify Unicode-aware tag regex in `src/search/v3/FilterRetriever.ts` — confirm `extractTagsFromQuery()` uses `\p{L}\p{N}` Unicode property escapes with ASCII fallback
- [x] T037 [P] [US5] Verify `EmbeddingManager` in `src/LLMProviders/embeddingManager.ts` supports multilingual model configuration — confirm model selection does not hardcode English-only models
- [x] T038 [US5] Add an acceptance test in `src/search/v3/SearchCore.search.test.ts` asserting cross-language results appear in the top 10 for a multilingual corpus, matching SC-005
- [x] T039 [US5] Verify existing tests in `src/search/v3/engines/FullTextEngine.test.ts` cover CJK tokenization — confirm both CJK bigrams and mixed CJK+ASCII content are tested

**Checkpoint**: Multilingual support verified — cross-language retrieval works with appropriate embedding model

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, performance validation, and remaining enhancements

- [x] T040 [P] Update user-facing documentation in `docs/vault-search-and-indexing.md` with current search capabilities: hybrid search, incremental indexing, time filtering, reranking, multilingual support (Constitution VIII)
- [x] T041 [P] Add JSDoc comments to any public methods in `src/search/v3/SearchCore.ts` that are missing documentation per Constitution VIII
- [x] T042 [P] Verify `MemoryManager` in `src/search/v3/utils/MemoryManager.ts` and `FullTextEngine` enforce the configured lexical-search RAM budget, including the 35% chunk allocation guard, and confirm the memory limit path is logged
- [x] T043 Verify reranker fallback chain in `src/search/reranker.ts`: `createReranker()` returns SelfHostReranker when available, LLMReranker when chat model provided, and NoopReranker otherwise — confirm existing tests in `src/search/reranker.test.ts` cover all 3 paths
- [x] T044 Verify `enableReranking` setting toggle in `src/settings/model.ts` correctly gates reranking in `SearchCore.search()` — confirm disabled setting returns un-reranked results
- [x] T045 Add an evaluation task in `src/search/v3/SearchCore.search.test.ts` or `specs/003-enhanced-vault-search/quickstart.md` to measure whether reranking improves top-5 relevance over raw cosine similarity on a fixed query set, matching SC-004
- [x] T046 Add a benchmark in `src/search/indexOperations.test.ts` or `specs/003-enhanced-vault-search/quickstart.md` for a full 10K-note re-index and verify SC-006 (≤30 minutes)
- [x] T047 Audit `src/search/**/*.ts`, `src/LLMProviders/embeddingManager.ts`, `src/LLMProviders/selfHostServices.ts`, and `src/search/reranker.ts` to verify search/indexing data only leaves the plugin through configured embedding or reranking providers, matching FR-011
- [x] T048 Run quickstart.md validation — execute all 8 verification steps from `specs/003-enhanced-vault-search/quickstart.md` and confirm all pass
- [x] T049 Run `npm run format && npm run lint` and confirm zero warnings/errors per constitution quality gates
- [x] T050 Run `npm run test` and confirm all unit tests pass per constitution quality gates
- [x] T051 Run `npm run build` and confirm the production build succeeds per constitution quality gates

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 passing — BLOCKS all user stories
  - T011 (chunking contract) must complete before chunking behavior is considered signed off
- **User Stories (Phases 3–7)**: All depend on Phase 2 completion
  - User stories can proceed **in parallel** (each verifies independent functionality)
  - Or sequentially in priority order (P1 → P2 → P3 → P4 → P5)
  - T025 (time-aware query behavior reconciliation) must complete before User Story 3 is considered signed off
- **Polish (Phase 8)**: Can start after Phase 3 (MVP) but ideally after all stories verified

### User Story Dependencies

- **US1 (P1) — Natural Language Search**: Foundation only — no other story dependency
- **US2 (P2) — Incremental Indexing**: Foundation only — independent of US1
- **US3 (P3) — Time Filtering**: Foundation only — uses FilterRetriever independently
- **US4 (P4) — Hybrid Search**: Foundation only — builds on same fusion pipeline as US1 but tests different behavior
- **US5 (P5) — Multilingual**: Foundation only — primarily about embedding model + CJK tokenizer

### Within Each User Story

1. Verify existing implementation meets spec
2. Verify existing tests cover acceptance scenarios
3. Add missing acceptance tests and benchmarks where coverage is incomplete
4. Reconcile artifact-level decisions where spec, plan, and implementation diverge

### Parallel Opportunities

**Phase 2** (after Phase 1):

```
T006 ─┐
T007 ─┼── All [P] tasks in parallel
T008 ─┤
T010 ─┘
```

**Phases 3–7** (after Phase 2):

```
US1 (Phase 3) ──┐
US2 (Phase 4) ──┤
US3 (Phase 5) ──┼── All stories in parallel
US4 (Phase 6) ──┤
US5 (Phase 7) ──┘
```

**Phase 8** (after Phase 3 MVP):

```
T040 ─┐
T041 ─┼── All [P] polish tasks in parallel
T042 ─┘
```

---

## Implementation Strategy

### MVP Scope

- **Phase 1 + Phase 2 + Phase 3 (US1)**: Natural language search verified end to end
- This represents the minimum viable increment — semantic search working and validated

### Incremental Delivery

1. MVP: US1 verified (semantic search with query expansion)
2. +US2: Incremental indexing verified (index stays fresh)
3. +US3: Time filtering verified (date-based constraints)
4. +US4: Hybrid search verified (keyword + semantic fusion)
5. +US5: Multilingual support verified (CJK + cross-language)
6. Polish: Documentation updated, performance validated

### Key Risk: All Components Already Implemented

Since the v3 architecture is complete, the primary risk is **verification and artifact-alignment gaps** — components that work individually but don't meet spec acceptance criteria in combination, or artifacts that describe different intended behavior. The acceptance tests and reconciliation tasks added in T011, T016, T022, T025, T033, T038, T045, and T046 mitigate this risk.
