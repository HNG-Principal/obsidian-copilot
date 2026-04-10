# Tasks: Composer & Note Editing

**Input**: Design documents from `/specs/007-composer-note-editing/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included — plan.md explicitly specifies unit test files adjacent to implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define all TypeScript types and pure utility functions that underpin the entire feature

- [x] T001 Define EditOperation discriminated union types (replace, insert, delete, create, rename), EditPlan, EditPlanStatus, EditResult, UndoSnapshot, ValidationResult, and FileDiff interfaces in src/core/editPlanner.ts
- [x] T002 [P] Implement `applyOperation(content: string, operation: EditOperation): string` pure function in src/core/editPlanner.ts — handles replace (exact match + fuzzy), insert (beginning, end, after anchor), and delete operations on text content
- [x] T003 [P] Implement `groupOperationsByFile(operations: EditOperation[]): Map<string, EditOperation[]>` utility in src/core/editPlanner.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core business logic modules that MUST be complete before any user story integration

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Implement `validatePlan(plan: EditPlan): Promise<ValidationResult>` in src/core/editPlanner.ts — checks file existence via Obsidian vault API, validates oldText matching for replace ops, anchor text existence for insert ops, path validity for create/rename ops
- [x] T005 Implement `computeDiffs(plan: EditPlan): Promise<FileDiff[]>` in src/core/editPlanner.ts — reads current file content, applies operations per file via applyOperation, returns FileDiff[] with originalContent and newContent
- [x] T006 [P] Implement UndoManager class in src/core/undoManager.ts — stack-based in-memory snapshot storage with createSnapshot(plan, description), undo(), canUndo(), peekDescription(), clear(), and configurable maxUndoSnapshots limit (default 20, drops oldest when exceeded)
- [x] T007 Implement EditExecutor class in src/core/editExecutor.ts — applyPlan(plan) method that: (1) validates plan via editPlanner, (2) creates undo snapshot via UndoManager, (3) applies operations sequentially per file using app.vault.modify/create/rename, (4) rolls back all changes from snapshot on any failure, (5) returns EditResult with status
- [x] T008 [P] Add `maxUndoSnapshots: number` setting (default 20, range 5–50) to CopilotSettings interface and DEFAULT_SETTINGS in src/settings/model.ts

**Checkpoint**: Foundation ready — editPlanner, editExecutor, and undoManager are functional with pure logic and vault integration

---

## Phase 3: User Story 1 — Natural Language Note Editing with Diff Preview (Priority: P1) 🎯 MVP

**Goal**: User gives a natural language editing instruction in chat, sees a diff preview of proposed changes, and can apply or reject them

**Independent Test**: Open a note, give a natural language editing instruction in chat, verify a diff preview appears, click Apply, verify the note is updated correctly

### Tests for User Story 1

- [ ] T009 [P] [US1] Unit tests for applyOperation pure function (replace exact match, replace fuzzy match, full note rewrite via replace with entire content as oldText, insert at beginning/end/after anchor, delete exact text, error on missing oldText) in src/core/editPlanner.test.ts
- [ ] T010 [P] [US1] Unit tests for validatePlan and computeDiffs (valid plan passes, invalid oldText fails, missing file fails, multi-op plan computes correct diffs) in src/core/editPlanner.test.ts
- [ ] T011 [P] [US1] Unit tests for EditExecutor.applyPlan (successful apply returns success, failed op triggers rollback, partial failure restores all files) in src/core/editExecutor.test.ts

### Implementation for User Story 1

- [x] T012 [US1] Modify editFileTool in src/tools/ComposerTools.ts to wrap oldText/newText into a single-replace EditPlan and route through editPlanner.computeDiffs() for diff generation — preserve existing tool schema signature for backwards compatibility
- [x] T013 [US1] Modify writeFileTool in src/tools/ComposerTools.ts to wrap path/content into a create (new file) or replace (existing file) EditPlan and route through editPlanner.computeDiffs() — preserve existing tool schema signature
- [x] T014 [US1] Modify ApplyViewState in src/components/composer/ApplyView.tsx to accept an optional EditPlan field, and wire ApplyViewRoot accept handler to call EditExecutor.applyPlan() instead of direct file writes when an EditPlan is present

> **Note (FR-009)**: Note referencing by title, path, or active editor context is handled by the existing `ContextManager` and `chatSelectionHighlightController` infrastructure. No new work is required — the LLM receives file paths from context and passes them to editFileTool/writeFileTool.

**Checkpoint**: User Story 1 is fully functional — edit/write tools produce EditPlan-based diffs, preview works, accept applies via EditExecutor with snapshot creation

---

## Phase 4: User Story 2 — Undo Applied Changes (Priority: P2)

**Goal**: After applying Composer edits, user can click an Undo button to restore the note to its exact pre-edit state

**Independent Test**: Apply a Composer edit, verify the note changed, click Undo, verify the note is restored to its exact previous state

### Tests for User Story 2

- [ ] T015 [P] [US2] Unit tests for UndoManager (createSnapshot stores file contents, undo restores files and pops stack, canUndo returns false on empty stack, stack depth limit drops oldest, clear empties stack) in src/core/undoManager.test.ts

### Implementation for User Story 2

- [x] T016 [US2] Add an Undo button to the ApplyViewRoot component in src/components/composer/ApplyView.tsx — visible after an edit is accepted, calls UndoManager.undo() on click and restores file content
- [x] T017 [US2] Add concurrent edit detection in UndoManager.undo() in src/core/undoManager.ts — before restoring, compare current file content to the post-edit content; if different (manual edits occurred), warn user via Obsidian Notice before proceeding
- [x] T018 [US2] Register "Undo last Copilot edit" command in src/main.ts — calls UndoManager.undo() from the command palette, shows Notice with result (success or "nothing to undo")

**Checkpoint**: User Story 2 is fully functional — undo restores files, warns on concurrent edits, accessible via UI button and command palette

---

## Phase 5: User Story 3 — Insert New Content at Specific Location (Priority: P3)

**Goal**: User asks the AI to insert content after a specific heading or at a specific position, sees a preview of the insertion, and can apply it

**Independent Test**: Reference a note with multiple headings, ask to insert content after a specific heading, verify content is added at the correct location without modifying surrounding content

### Implementation for User Story 3

- [x] T019 [US3] Enhance insert position resolution in applyOperation within src/core/editPlanner.ts — for `{ after: string }` positions, support matching heading text (e.g., "## Conclusion"), paragraph text, and partial line matching with clear error messages when anchor text is not found
- [x] T020 [US3] Add insert-specific validation in validatePlan in src/core/editPlanner.ts — verify anchor text exists in target file for 'after' position inserts, verify file exists for beginning/end inserts
- [x] T021 [US3] Unit tests for insert operations (insert at beginning, insert at end, insert after heading, insert after paragraph, error on missing anchor) in src/core/editPlanner.test.ts

**Checkpoint**: User Story 3 is fully functional — insert operations resolve positions correctly, preview shows exact insertion point, apply adds content without modifying surrounding text

---

## Phase 6: User Story 4 — Frontmatter Updates (Priority: P4)

**Goal**: User asks the AI to add/update frontmatter fields (tags, status, etc.), and the changes are scoped to the YAML frontmatter section only

**Independent Test**: Edit frontmatter via Composer — add a tag, update a field. Verify the YAML remains valid and all existing fields are preserved

### Implementation for User Story 4

- [x] T022 [US4] Add frontmatter boundary detection utility in src/core/editPlanner.ts — `extractFrontmatter(content: string): { frontmatter: string; body: string; hasFrontmatter: boolean }` that splits content at YAML `---` delimiters
- [x] T023 [US4] Ensure replace operations targeting frontmatter content are validated for YAML correctness in validatePlan in src/core/editPlanner.ts — after applying the operation, verify the resulting frontmatter is valid YAML (use existing YAML parsing or simple delimiter check)
- [x] T024 [US4] Unit tests for frontmatter operations (add tag to existing frontmatter, update field value, create frontmatter on note without one, body content unchanged after frontmatter edit, invalid YAML rejected) in src/core/editPlanner.test.ts

**Checkpoint**: User Story 4 is fully functional — frontmatter edits preserve YAML validity, body content is untouched, missing frontmatter is created correctly

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that span multiple user stories

- [x] T025 [P] Add JSDoc comments to all exported functions and interfaces in src/core/editPlanner.ts, src/core/editExecutor.ts, and src/core/undoManager.ts
- [x] T026 [P] Add structured logging (logInfo/logWarn/logError) for edit plan validation, apply, undo, and rollback operations across src/core/editPlanner.ts, src/core/editExecutor.ts, and src/core/undoManager.ts
- [x] T027 Wire UndoManager.clear() to plugin unload lifecycle in src/main.ts — ensure undo snapshots are freed when plugin is disabled or Obsidian closes
- [x] T028 Run quickstart.md verification checklist — validate all 18 checklist items pass end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (types must exist) — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 — editPlanner, editExecutor must be functional
- **User Story 2 (Phase 4)**: Depends on Phase 2 (undoManager) — can run in parallel with US1
- **User Story 3 (Phase 5)**: Depends on Phase 2 (editPlanner) — can run in parallel with US1/US2
- **User Story 4 (Phase 6)**: Depends on Phase 2 (editPlanner) — can run in parallel with US1/US2/US3
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Core MVP — no dependencies on other stories. Requires editPlanner + editExecutor + ApplyView integration
- **US2 (P2)**: Independent of US1 implementation (uses undoManager directly). Can be developed in parallel with US1 after Phase 2
- **US3 (P3)**: Independent — extends applyOperation with insert position logic. Can be developed in parallel with US1/US2
- **US4 (P4)**: Independent — adds frontmatter-scoped validation. Can be developed in parallel with US1/US2/US3

### Within Each User Story

- Tests written first (where included), then implementation
- Pure functions before integration
- Core logic before UI wiring
- Story complete before moving to next priority

### Parallel Opportunities

- T002, T003 can run in parallel (Phase 1 — independent pure functions)
- T006, T008 can run in parallel with T004, T005 (Phase 2 — different files)
- T009, T010, T011 can all run in parallel (Phase 3 — test files)
- After Phase 2, all four user stories (Phases 3–6) can proceed in parallel
- T025, T026 can run in parallel (Phase 7 — independent concerns)

---

## Parallel Example: User Story 1

```bash
# Step 1: Write tests in parallel
T009 & T010 & T011  # All test files, no dependencies between them

# Step 2: Implementation (sequential within story)
T012  # editFileTool modification
T013  # writeFileTool modification (can parallel with T012 — different tool functions)
T014  # ApplyView integration (depends on T012/T013 completing)
```

## Implementation Strategy

### MVP (Phase 1 + Phase 2 + User Story 1)

The minimum viable Composer delivers:

- Type-safe edit operations with validation
- EditPlanner computes diffs, EditExecutor applies atomically
- Existing editFileTool and writeFileTool upgraded to use EditPlan pipeline
- Diff preview works via existing ApplyView
- Undo snapshots created automatically (usable once US2 wires the UI)

**Estimated task count for MVP**: 14 tasks (T001–T014)

### Incremental Delivery

After MVP, each user story adds an independent, testable increment:

1. **US2 (Undo)**: Adds undo UI + command — 4 tasks
2. **US3 (Insert)**: Adds positional insert support — 3 tasks
3. **US4 (Frontmatter)**: Adds YAML-aware edits — 3 tasks
4. **Polish**: Cross-cutting improvements — 4 tasks
