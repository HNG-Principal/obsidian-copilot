# Tasks: Long-Term Memory

**Input**: Design documents from `/specs/009-long-term-memory/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/interfaces.md, quickstart.md

**Tests**: Included — plan.md explicitly lists `.test.ts` files as deliverables for each core module.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- Single project: `src/` at repository root
- Tests adjacent to implementation: `src/memory/*.test.ts`
- Components: `src/components/memory/`
- Settings: `src/settings/v2/components/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Type definitions and settings schema — no business logic, just the shared contracts all modules depend on

- [x] T001 Define all type definitions in `src/memory/longTermMemoryTypes.ts` — Memory, MemoryCategory, MemorySource, MemoryEmbedding header type, MemoryRetrievalResult, MemoryExtractionResult per data-model.md
- [x] T002 [P] Add long-term memory settings fields and defaults to `src/settings/model.ts` — enableLongTermMemory (boolean, default true), maxLongTermMemories (number, default 5000), maxMemoriesRetrieved (number, default 10), memoryDeduplicationThreshold (number, default 0.85) in CopilotSettings interface and DEFAULT_SETTINGS

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: JSONL persistence layer that ALL user stories depend on — extraction writes to it, retrieval reads from it, management UI mutates it

**⚠️ CRITICAL**: No user story work can begin until MemoryStore is implemented and tested

- [x] T003 Implement MemoryStore JSONL persistence in `src/memory/MemoryStore.ts` — loadMemories() (parse memories.jsonl, filter deleted tombstones), loadEmbeddings() (parse embeddings.jsonl header + vectors into Map), appendMemory() (append to both JSONL files), save() (rewrite full files for compaction/bulk updates), exists() (check directory and files), ensureDirectory() (create `.copilot/memory/` on first run). Use `app.vault.adapter` for file I/O per research.md
- [x] T004 [P] Write unit tests for MemoryStore in `src/memory/MemoryStore.test.ts` — test first-run directory creation, append + load round-trip, tombstone filtering on load, embedding header parsing, model mismatch detection, save/compaction, corrupt line handling (skip malformed JSON lines gracefully)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Automatic Fact Extraction (Priority: P1) 🎯 MVP

**Goal**: After each AI response, the system automatically extracts factual information from the conversation and stores it as memories in the JSONL store

**Independent Test**: Chat with the AI about a personal preference ("I prefer dark mode in all my editors"). Check `.copilot/memory/memories.jsonl` — verify a memory entry was created with the extracted fact, correct category, and a valid embedding in `embeddings.jsonl`

### Implementation for User Story 1

- [x] T005 [P] [US1] Implement sensitive pattern filter as pure function in `src/memory/sensitivePatternFilter.ts` — filterSensitiveContent(text, patterns) returns { filtered, hadSensitive }. Default patterns: API keys, tokens, passwords, secrets per FR-010. Export default pattern list
- [x] T006 [P] [US1] Implement extraction prompt builder and response parser in `src/memory/MemoryExtractor.ts` — buildExtractionPrompt(messages, existingMemories) returns { systemPrompt, userPrompt } for LLM call; parseExtractionResponse(llmResponse) parses structured LLM output into array of { content, category, isUpdate, updatedMemoryId }. Both are pure functions per contracts/interfaces.md
- [x] T007 [US1] Write unit tests for MemoryExtractor in `src/memory/MemoryExtractor.test.ts` — test prompt construction includes existing memories for dedup hints, response parsing handles valid/malformed/empty LLM output, category classification, isUpdate detection
- [x] T008 [US1] Write unit tests for sensitivePatternFilter in `src/memory/sensitivePatternFilter.test.ts` — test API key patterns, token patterns, password patterns, clean text passthrough, mixed content filtering
- [x] T009 [US1] Implement LongTermMemoryManager constructor and extractAndStore() in `src/memory/LongTermMemoryManager.ts` — constructor takes MemoryStore + EmbeddingManager dependencies (no singletons). extractAndStore(messages, chatModel) orchestrates: filter sensitive content → build extraction prompt → invoke chatModel → parse response → generate embeddings via EmbeddingManager → append to store. Fire-and-forget with error logging per ILongTermMemoryManager contract
- [x] T010 [US1] Wire extraction hook into BaseChainRunner.handleResponse() in `src/LLMProviders/chainRunner/BaseChainRunner.ts` — after successful response, call LongTermMemoryManager.extractAndStore() with conversation messages and chat model. Guard with enableLongTermMemory settings check. Fire-and-forget (no await, errors logged)
- [x] T011 [US1] Write unit tests for LongTermMemoryManager extraction flow in `src/memory/LongTermMemoryManager.test.ts` — test extractAndStore() end-to-end with mocked MemoryStore, EmbeddingManager, and ChatModel. Verify: memories appended to store, embeddings generated, sensitive content filtered, errors logged not thrown, disabled toggle skips extraction

**Checkpoint**: At this point, conversations automatically extract and persist facts. Verifiable by inspecting `.copilot/memory/memories.jsonl` after chatting.

---

## Phase 4: User Story 2 — Semantic Memory Retrieval (Priority: P2)

**Goal**: Before each AI response, the system retrieves semantically relevant memories and injects them into the system prompt so the AI has long-term context

**Independent Test**: After US1 has stored memories, start a new chat session. Ask a question that relates to a previously stored fact. Verify the AI's response demonstrates knowledge of the stored memory. Inspect system prompt to confirm `<long_term_memories>` XML section is present

### Implementation for User Story 2

- [x] T012 [P] [US2] Implement MemoryRetriever in `src/memory/MemoryRetriever.ts` — retrieveRelevantMemories(query, allMemories, allEmbeddings, queryEmbedding, maxResults) as pure function: compute cosine similarity between query embedding and all memory embeddings, filter out sensitive memories, rank by similarity score, return top-N MemoryRetrievalResult[] per contracts. Include cosine similarity computation inline (no external dependency)
- [x] T013 [P] [US2] Write unit tests for MemoryRetriever in `src/memory/MemoryRetriever.test.ts` — test cosine similarity ranking, sensitive memory exclusion, maxResults limit, empty store handling, project tag filtering (when applicable), score thresholding
- [x] T014 [US2] Implement getRelevantMemoriesPrompt() in `src/memory/LongTermMemoryManager.ts` — embed query via EmbeddingManager, call MemoryRetriever, format results as bullet-point string for XML injection, increment accessCount + lastAccessedAt on returned memories, return null if no relevant memories or feature disabled. Limit to maxMemoriesRetrieved from settings
- [x] T015 [US2] Wire retrieval into getUserMemoryPrompt() in `src/memory/UserMemoryManager.ts` — call LongTermMemoryManager.getRelevantMemoriesPrompt() with the current user query, append `<long_term_memories>` XML section to existing user memory prompt string (after `<saved_memories>`). `systemPromptBuilder.ts` already delegates to `getUserMemoryPrompt()` — no changes needed there

**Checkpoint**: At this point, US1 + US2 form an end-to-end loop: facts are extracted, stored, and surfaced in subsequent conversations via system prompt injection

---

## Phase 5: User Story 3 — Memory Management UI (Priority: P3)

**Goal**: Users can view, search, edit, and delete their stored memories through a dedicated management modal, and configure memory settings

**Independent Test**: Open the memory management command. Verify all stored memories are displayed with content, category, and timestamps. Edit a memory's content — verify the change persists. Delete a memory — verify it no longer appears. Toggle the sensitive flag — verify it excludes the memory from retrieval

### Implementation for User Story 3

- [x] T016 [P] [US3] Implement CRUD methods in LongTermMemoryManager in `src/memory/LongTermMemoryManager.ts` — getAllMemories() loads and returns all non-deleted memories for UI display, updateMemory(id, updates) modifies content/category/sensitive fields and re-embeds if content changed, deleteMemory(id) physically removes the memory via save() rewrite (hard delete per FR-007 "permanently")
- [x] T017 [P] [US3] Create MemoryManagerModal component in `src/components/memory/MemoryManagerModal.tsx` — React functional component using Radix UI primitives and Tailwind CSS. Features: list all memories with content/category/date, search/filter by keyword, inline edit content and category, toggle sensitive flag, delete with confirmation, show memory count and store statistics. Use LongTermMemoryManager methods for all operations
- [x] T018 [US3] Add MemorySettings section in `src/settings/v2/components/MemorySettings.tsx` — settings controls for enableLongTermMemory toggle, maxLongTermMemories number input (100-10000), maxMemoriesRetrieved number input (1-50), memoryDeduplicationThreshold slider (0.5-1.0). Wire to settings model via Jotai updateSetting()
- [x] T019 [US3] Register memory management command and modal in `src/main.ts` — add Obsidian command "Manage long-term memories" that opens MemoryManagerModal. Initialize LongTermMemoryManager singleton in plugin onload() with MemoryStore and EmbeddingManager dependencies

**Checkpoint**: Users can now view, search, edit, delete, and configure their long-term memories through the UI

---

## Phase 6: User Story 4 — Deduplication (Priority: P4)

**Goal**: When new facts are extracted, the system detects semantically similar existing memories and merges them instead of creating duplicates, keeping the memory store clean

**Independent Test**: Mention the same fact in three different conversations (e.g., "I use TypeScript" / "My preferred language is TypeScript" / "I code in TypeScript"). Check the memory store — verify only one memory entry exists for that fact, with the most complete/recent content

### Implementation for User Story 4

- [x] T020 [US4] Implement MemoryDeduplicator in `src/memory/MemoryDeduplicator.ts` — two-stage approach per contracts: findDuplicateCandidates(existingEmbeddings, newEmbedding, threshold) computes cosine similarity and returns candidates above threshold; mergeMemories(existing, extracted, chatModel) uses LLM to produce merged content for candidates. Top-level deduplicateMemories() function orchestrates both stages and returns { toInsert, toUpdate } per DeduplicateMemories contract
- [x] T021 [P] [US4] Write unit tests for MemoryDeduplicator in `src/memory/MemoryDeduplicator.test.ts` — test cosine threshold filtering, below-threshold pairs kept separate, LLM merge prompt construction, merge result parsing, edge cases (empty store, identical content, ambiguous similarity)
- [x] T022 [US4] Integrate dedup into extractAndStore() flow in `src/memory/LongTermMemoryManager.ts` — after extraction and embedding generation, call MemoryDeduplicator.deduplicateMemories() before store write. For toInsert items: appendMemory(). For toUpdate items: update existing memory content + re-embed + update timestamps
- [x] T023 [US4] Implement store pruning when exceeding max limit in `src/memory/LongTermMemoryManager.ts` — after successful extraction+dedup, check store count against maxLongTermMemories. When exceeded, compute pruneScore = 0.4 × normalize(accessCount) + 0.3 × normalize(lastAccessedAt recency) + 0.3 × normalize(age) (higher = more valuable), sort ascending, remove bottom 10% via soft delete, trigger save() for compaction

**Checkpoint**: Extraction now automatically deduplicates against existing memories and prunes when store limit is exceeded

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and final validation

- [x] T024 [P] Implement exportMarkdown() in `src/memory/LongTermMemoryManager.ts` — export all non-sensitive memories to `Long-Term Memories.md` in the configured memory folder per FR-002 and ILongTermMemoryManager contract
- [x] T025 [P] Implement reEmbed() in `src/memory/LongTermMemoryManager.ts` — re-embed all memories when embedding model changes. Detect model mismatch from embeddings.jsonl header vs current EmbeddingManager model. Return count of re-embedded entries. Wire to settings change subscription
- [x] T026 [P] Add long-term memory documentation in `docs/` — document the feature for end users: what it does, how to enable/disable, settings options, memory management UI, how extraction works, privacy considerations for sensitive data
- [x] T027 Run quickstart.md validation — execute all verification steps from quickstart.md: first-run directory creation, extraction after chat, retrieval in new session, management UI operations, dedup behavior, settings toggle, embedding model change re-embed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup (Phase 1) — types must exist before MemoryStore
- **User Stories (Phase 3+)**: ALL depend on Foundational (Phase 2) completion — MemoryStore BLOCKS everything
  - User stories can then proceed sequentially in priority order (P1 → P2 → P3 → P4)
  - US2 builds on US1 output (retrieves what US1 stores) but is independently testable
  - US3 can start after Phase 2 (needs MemoryStore + LongTermMemoryManager skeleton)
  - US4 modifies extractAndStore() from US1 — best done after US1 is stable
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational (Phase 2) — No dependencies on other stories
- **US2 (P2)**: Can start after Foundational (Phase 2) — Benefits from US1 having stored data, but MemoryRetriever is independently testable with mock data
- **US3 (P3)**: Can start after Foundational (Phase 2) + US1 T009 (LongTermMemoryManager skeleton) — CRUD methods build on the manager class created in US1
- **US4 (P4)**: Should start after US1 is complete — modifies extractAndStore() flow, needs stable extraction pipeline

### Within Each User Story

- Pure functions (filters, prompt builders, retrievers) before orchestrators
- Orchestrator (LongTermMemoryManager) before integration wiring
- Integration wiring (BaseChainRunner, systemPromptBuilder) last
- Tests can be written in parallel with their implementation (same story, different files)

### Parallel Opportunities

- T001 and T002 can run in parallel (different files)
- T003 and T004 can run in parallel (implementation + tests)
- T005, T006 can run in parallel (different files, both pure functions)
- T007, T008 can run in parallel (different test files)
- T012, T013 can run in parallel (implementation + tests)
- T017, T018 can run in parallel (manager methods + UI component in different files)
- T025, T026, T027 can all run in parallel (different files/concerns)

---

## Parallel Example: User Story 1

```bash
# Start with pure functions in parallel:
Task T005: "Implement sensitive pattern filter in src/memory/sensitivePatternFilter.ts"
Task T006: "Implement extraction prompt builder in src/memory/MemoryExtractor.ts"

# Then tests in parallel:
Task T007: "Write unit tests for MemoryExtractor in src/memory/MemoryExtractor.test.ts"
Task T008: "Write unit tests for sensitivePatternFilter in src/memory/sensitivePatternFilter.test.ts"

# Then orchestrator (depends on T005, T006):
Task T009: "Implement LongTermMemoryManager.extractAndStore() in src/memory/LongTermMemoryManager.ts"

# Then wiring + tests (depends on T009):
Task T010: "Wire extraction hook in BaseChainRunner.ts"
Task T011: "Write unit tests for LongTermMemoryManager"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (types + settings)
2. Complete Phase 2: Foundational (MemoryStore)
3. Complete Phase 3: User Story 1 (extraction pipeline)
4. **STOP and VALIDATE**: Verify memories appear in `.copilot/memory/memories.jsonl` after chatting
5. This delivers the core value: automatic fact extraction and persistence

### Incremental Delivery

1. Complete Setup + Foundational → Storage layer ready
2. Add US1 (Extraction) → Facts stored automatically → **MVP!**
3. Add US2 (Retrieval) → Memories surfaced in AI responses → End-to-end loop complete
4. Add US3 (Management UI) → Users can inspect and manage memories → Full user control
5. Add US4 (Deduplication) → Store stays clean over time → Long-term quality
6. Each story adds value without breaking previous stories

### Key Integration Points

| Integration Point       | File                                              | Story        | Description                                                         |
| ----------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| Post-response hook      | `src/LLMProviders/chainRunner/BaseChainRunner.ts` | US1 (T010)   | Call extractAndStore() after AI response                            |
| System prompt injection | `src/memory/UserMemoryManager.ts`                 | US2 (T015)   | Append `<long_term_memories>` XML section via getUserMemoryPrompt() |
| Plugin initialization   | `src/main.ts`                                     | US3 (T019)   | Create LongTermMemoryManager, register command                      |
| Settings model          | `src/settings/model.ts`                           | Setup (T002) | Add 4 new settings fields                                           |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same story
- [Story] label maps each task to its user story for traceability
- All new modules accept dependencies as constructor/function parameters — no internal singleton access (per CLAUDE.md testing guidelines)
- LongTermMemoryManager is the only class that grows across stories (extraction in US1, retrieval in US2, CRUD in US3, dedup integration in US4)
- Use `logInfo()`, `logWarn()`, `logError()` from `@/logger` — never `console.log`
- Use `@/` absolute imports for all inter-module references
- Adjacent test files: `MemoryStore.test.ts` next to `MemoryStore.ts`, etc.
