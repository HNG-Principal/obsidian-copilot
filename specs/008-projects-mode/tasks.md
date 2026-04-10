# Tasks: Projects Mode

**Input**: Design documents from `/specs/008-projects-mode/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Not explicitly requested in spec — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Exact file paths included in descriptions

---

## Phase 1: Setup (Type Extensions & Persisted Selection)

**Purpose**: Extend the existing project types only where the approved feature requires new data.

- [x] T001 Add `pinnedFiles?: string[]` to `ProjectConfig` in `src/aiParams.ts`
- [x] T002 [P] Add `ProjectState` type (`projectId`, `isContextReady`, `isLoading`, `messageCount`, `lastSwitchedAt`) in `src/aiParams.ts`
- [x] T003 [P] Add persisted `activeProjectId: string | null` to `CopilotSettings` defaults in `src/settings/model.ts`

---

## Phase 2: Foundational (Validation & Core Manager Methods)

**Purpose**: Pure validation function and core ProjectManager CRUD methods that all user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Create `validateProjectConfig(config: Partial<ProjectConfig>): string[]` pure function in `src/LLMProviders/projectValidation.ts` — validate name non-empty, `contextSource.inclusions/exclusions` patterns, `modelConfigs.temperature` range [0.0, 2.0], and `pinnedFiles` path shape
- [x] T005 [P] Create `computeSearchPathFilter(inclusions: string, exclusions: string): { include: string[]; exclude: string[] }` pure function in `src/LLMProviders/projectValidation.ts` — normalize comma-separated patterns into arrays for deterministic path matching
- [x] T006 Add `createProject(config: Partial<ProjectConfig>): Promise<ProjectConfig>` to `ProjectManager` in `src/LLMProviders/projectManager.ts` — generate ID, set `created` and `UsageTimestamps`, validate, persist to `settings.projectList`
- [x] T007 Add `updateProject(projectId: string, updates: Partial<ProjectConfig>): Promise<void>` to `ProjectManager` in `src/LLMProviders/projectManager.ts` — validate, merge, persist, trigger cache refresh when scope or pinned files change
- [x] T008 Add `deleteProject(projectId: string, archiveHistory?: boolean): Promise<void>` to `ProjectManager` in `src/LLMProviders/projectManager.ts` — remove from `settings.projectList`, clear `ProjectContextCache`, optionally delete `{projectId}__` chat history files
- [x] T009 Add `clearProject(): Promise<void>` to `ProjectManager` in `src/LLMProviders/projectManager.ts` — exit project mode, persist `activeProjectId = null`, notify ChatManager to switch to default repository
- [x] T010 Add `listProjects(): ProjectConfig[]` convenience method to `ProjectManager` in `src/LLMProviders/projectManager.ts` — return `getSettings().projectList`
- [x] T011 [P] Add `getProjectState(projectId: string): ProjectState | undefined` to `ProjectManager` in `src/LLMProviders/projectManager.ts` — return runtime state from `ProjectLoadTracker` with `isContextReady` and `isLoading`

**Checkpoint**: Core project CRUD and validation ready. User story implementation can begin.

---

## Phase 3: User Story 1 — Create and Use a Scoped Project (Priority: P1) 🎯 MVP

**Goal**: Users create named projects with folder scopes. Vault searches only return notes from scoped folders.

**Independent Test**: Create a project scoped to one folder. Search for a topic present in both scoped and non-scoped folders. Verify only results from the scoped folder are returned.

### Implementation for User Story 1

- [x] T012 [US1] Harden `ProjectContextCache.get(project)` in `src/cache/projectContextCache.ts` — scope markdown discovery to `contextSource.inclusions`, apply `contextSource.exclusions`, and treat empty inclusions as full-vault behavior
- [x] T013 [US1] Handle renamed or deleted scoped folders in `src/cache/projectContextCache.ts` — log warning, skip missing paths, and keep project mode usable
- [x] T014 [US1] Wire `createProject` into `AddProjectModal` in `src/components/modals/project/AddProjectModal.tsx` — call `ProjectManager.createProject()` on submit and surface validation errors to the user
- [x] T015 [US1] Ensure no-project mode falls back to full-vault context in `src/LLMProviders/projectManager.ts` and `src/cache/projectContextCache.ts`

**Checkpoint**: Projects can be created with folder scopes. Search/context is correctly filtered to scoped folders.

---

## Phase 4: User Story 2 — Project Switching (Priority: P2)

**Goal**: Users switch projects via the sidebar. Context, search scope, system prompt, and model update instantly. Chat history is preserved per project.

**Independent Test**: Create two projects with different scopes and system prompts. Switch between them. Verify context, search scope, and system prompt update immediately. Verify each project's chat history is isolated.

### Implementation for User Story 2

- [x] T016 [US2] Enhance `switchProject(project)` in `src/LLMProviders/projectManager.ts` — auto-save the current project's chat via `ChatPersistenceManager.saveChat()` before switching and handle save failures gracefully
- [x] T017 [US2] Auto-load the target project's latest chat in `src/LLMProviders/projectManager.ts` — after switching MessageRepository, load history only when the target repository is empty
- [x] T018 [US2] Persist `activeProjectId` during project changes in `src/LLMProviders/projectManager.ts` — save the selected project on switch and clear it in no-project mode
- [x] T019 [US2] Add `isContextReady(projectId)` tracking to `ProjectContextCache` in `src/cache/projectContextCache.ts` — set false on refresh start and true on completion
- [x] T020 [US2] Update `ChatUIState` in `src/state/ChatUIState.ts` — notify subscribers on project switch and expose context loading state to the UI
- [x] T021 [US2] Show active/loading state in `ProjectList.tsx` in `src/components/chat-components/ProjectList.tsx` — indicate the active project clearly and display context refresh progress
- [x] T022 [US2] Handle message-before-context-ready in `src/LLMProviders/projectManager.ts` — use available cached context and avoid blocking sends while refresh is in progress
- [x] T023 [US2] Restore the last active project on plugin startup in `src/main.ts` and/or `src/LLMProviders/projectManager.ts` — read persisted `activeProjectId`, restore if present, otherwise fall back to no-project mode

**Checkpoint**: Project switching is instant (<1s for UI), chat histories are preserved and isolated, context refreshes in background.

---

## Phase 5: User Story 3 — Per-Project System Prompt and Model (Priority: P3)

**Goal**: Each project can have its own system prompt and model. When chatting in a project, the configured prompt and model are used.

**Independent Test**: Create a project with a custom system prompt and model. Chat in the project. Verify responses reflect the custom prompt and the correct model is used.

### Implementation for User Story 3

- [x] T024 [US3] Apply `projectModelKey` during project chain setup in `src/LLMProviders/projectManager.ts` and/or `src/LLMProviders/chainRunner/ProjectChainRunner.ts`
- [x] T025 [US3] Apply `modelConfigs.temperature` overrides in `src/LLMProviders/projectManager.ts` — use project temperature when set and fall back to global settings when unset
- [x] T026 [US3] Resolve project `systemPrompt` fallback in `src/core/ChatManager.ts` — use the active project's prompt when present and the global default otherwise
- [x] T027 [US3] Expose model and system prompt editors in `src/components/modals/project/AddProjectModal.tsx`

**Checkpoint**: Per-project model and system prompt are applied correctly. Fallback to global settings works.

---

## Phase 6: User Story 4 — Pinned Context Files (Priority: P4)

**Goal**: Users pin files to a project. Pinned files are always included in AI context within that project.

**Independent Test**: Pin 3 files to a project. Start a new chat. Ask a question requiring knowledge from a pinned file (without mentioning it). Verify the AI uses the pinned content.

### Implementation for User Story 4

- [x] T028 [US4] Extend `ProjectContextCache` in `src/cache/projectContextCache.ts` — always include `pinnedFiles` content in project context regardless of `contextSource.inclusions`
- [x] T029 [US4] Handle pinned file edge cases in `src/cache/projectContextCache.ts` — skip missing files with warnings, truncate oversized content with notice, and refresh pinned content when files change on disk
- [x] T030 [US4] Add pinned files UI to `AddProjectModal` in `src/components/modals/project/AddProjectModal.tsx` — file picker, add/remove controls, and vault file autocomplete
- [x] T031 [US4] Show pinned file count in `ProjectList.tsx` in `src/components/chat-components/ProjectList.tsx`

**Checkpoint**: Pinned files are always included in AI context. UI allows managing pinned files per project.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, edge cases that affect multiple stories.

- [x] T032 [P] Update `docs/projects.md` with documentation for creation, switching, scoping, pinned files, per-project model/prompt, and restart restoration
- [x] T033 [P] Handle project deletion UX in `src/components/chat-components/ProjectList.tsx` — confirmation dialog, option to archive or delete chat history, call `ProjectManager.deleteProject()`
- [x] T034 Verify backwards compatibility — existing projects without `pinnedFiles` or persisted `activeProjectId` continue to work with no migration failures
- [x] T035 Verify project persistence across Obsidian restarts — projects and their configs survive restart and the active project restores cleanly on plugin load
- [x] T036 Add JSDoc comments for all new functions and methods introduced in `src/LLMProviders/projectValidation.ts`, `src/LLMProviders/projectManager.ts`, `src/cache/projectContextCache.ts`, and startup restoration wiring
- [ ] T037 [P] Run `quickstart.md` verification checklist — validate all items from the verification checklist pass end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — can start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1 — Scoped Projects)**: Depends on Phase 2
- **Phase 4 (US2 — Switching)**: Depends on Phase 2. Can run in parallel with Phase 3.
- **Phase 5 (US3 — Prompt/Model)**: Depends on Phase 2. Can run in parallel with Phases 3-4.
- **Phase 6 (US4 — Pinned Files)**: Depends on Phase 2. Can run in parallel with Phases 3-5.
- **Phase 7 (Polish)**: Depends on all desired user stories being complete.

### User Story Independence

- **US1 (Scoped Projects)**: No dependencies on other stories. Core MVP.
- **US2 (Switching)**: Independent of US1 at code level (switching already exists). US1 makes switching more meaningful.
- **US3 (Prompt/Model)**: Independent — verifies existing per-project model/prompt plumbing. No code dependencies on US1/US2.
- **US4 (Pinned Files)**: Independent — adds new `pinnedFiles` field and context inclusion logic. No dependencies on US1/US2/US3.

### Within Each User Story

- Context/cache changes before UI changes
- Manager logic before component wiring
- Core implementation before edge case handling

### Parallel Opportunities per Phase

**Phase 1**: T001, T002, T003 can all run in parallel (different files)
**Phase 2**: T004+T005 in parallel, then T006-T011 in sequence where they touch `projectManager.ts`
**Phase 3**: T012+T013 sequential in `projectContextCache.ts`, then T014+T015 can proceed
**Phase 4**: T016+T017 sequential in `projectManager.ts`, T019+T020+T021 can follow in parallel, then T022+T023
**Phase 5**: T024+T025+T026 can run in parallel across different files, T027 after
**Phase 6**: T028+T029 sequential in `projectContextCache.ts`, then T030+T031 in parallel
**Phase 7**: T032+T033+T037 can run in parallel; T034-T036 after implementation is complete

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (type extensions)
2. Complete Phase 2: Foundational (validation + CRUD)
3. Complete Phase 3: User Story 1 (scoped projects)
4. **STOP and VALIDATE**: Create a project, verify search scoping works
5. Ship MVP — users can create scoped projects

### Incremental Delivery

1. Phase 1 + Phase 2 → Foundation ready
2. - Phase 3 (US1) → Scoped projects work → **MVP** 🎯
3. - Phase 4 (US2) → Switching is hardened with auto-save
4. - Phase 5 (US3) → Per-project model/prompt verified
5. - Phase 6 (US4) → Pinned files add persistent context
6. - Phase 7 → Documentation and polish

Each phase adds value without breaking previous functionality.
