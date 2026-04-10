# Implementation Plan: Projects Mode

**Branch**: `008-projects-mode` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-projects-mode/spec.md`

## Summary

Project-scoped chat and context system that allows users to define named projects with specific vault folders, custom system prompts, pinned context files, and isolated conversation histories. Extends the existing `ProjectManager` singleton, `ProjectChainRunner`, `ProjectContextCache`, and project UI components. Adds project-aware search scoping, improved project switching with automatic context refresh, and restoration of the active project on plugin startup.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API
**Storage**: Project configs in `CopilotSettings.projectList`, project conversations in `.copilot/chat-history/` (prefixed with project ID)
**Testing**: Jest + unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: Project switch <1s (SC-001); scoped search returns zero results from non-scoped folders (SC-002); background context refresh target <3s
**Constraints**: Backwards compatible with existing project system, project isolation must extend to the in-scope context sources for this feature (search, files, prompts)
**Scale/Scope**: ~8 modified files, extends existing project infrastructure

## Constitution Check

| Principle                          | Status   | Notes                                                                                                                                                     |
| ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | Projects are user-defined with arbitrary folder paths, names, prompts, and pinned files. No hardcoded folder structures or special-case project behavior. |
| II. Clean Architecture             | **PASS** | `ProjectManager` (lifecycle) → `ChatManager` (isolated messages, prompt injection) → `ProjectContextCache` (indexed context). Clean layering.             |
| III. Prompt Integrity              | **PASS** | No existing prompts modified. Project system prompts are user-authored and injected via `ChatManager.injectProcessedUserCustomPromptIntoSystemPrompt()`.  |
| IV. Type Safety                    | **PASS** | `ProjectConfig` type covers all project properties. `ProjectManager` methods are fully typed.                                                             |
| V. Structured Logging              | **PASS** | All logging via `logInfo/logWarn/logError`.                                                                                                               |
| VI. Testable by Design             | **PASS** | Project config validation is pure. Path scoping is pure (project folders → search filter). Context refresh is orchestrated through mockable interfaces.   |
| VII. Simplicity & Minimal Overhead | **PASS** | Extends existing `ProjectManager`, `ProjectChainRunner`. No new infrastructure — project isolation already partially implemented in ChatManager.          |
| VIII. Documentation Discipline     | **PASS** | JSDoc on all new functions. Will update `docs/projects.md`.                                                                                               |

**Gate result: PASS — all principles confirmed.**

## Project Structure

### Documentation (this feature)

```text
specs/008-projects-mode/
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
├── aiParams.ts                                    # MODIFIED — ProjectConfig pinned files extension, ProjectState type
├── core/
│   ├── ChatManager.ts                             # MODIFIED — project-aware message repo switching
│   └── ChatPersistenceManager.ts                  # MODIFIED — project-prefixed chat history files
├── cache/
│   └── projectContextCache.ts                     # MODIFIED — scoped search and context caching
├── LLMProviders/
│   ├── projectManager.ts                          # MODIFIED — enhanced project lifecycle, restoration, validation wiring
│   ├── projectValidation.ts                       # NEW — pure project validation and path-filter helpers
│   └── chainRunner/
│       └── ProjectChainRunner.ts                  # EXISTING — thin wrapper, may add model override logic
├── components/
│   ├── chat-components/
│   │   └── ProjectList.tsx                        # MODIFIED — project list UI, switching, sorting
│   ├── modals/project/
│   │   └── AddProjectModal.tsx                    # MODIFIED — project create/edit modal
│   └── project/
│       └── progress-card.tsx                      # EXISTING — context loading progress
├── settings/
│   └── model.ts                                   # MODIFIED — persisted active project setting
└── state/
    └── ChatUIState.ts                             # MODIFIED — project switch notification
```

**Structure Decision**: This feature primarily extends the existing project infrastructure. One small pure helper module for validation/path-filter logic is acceptable to keep leaf logic testable. `projectManager.ts` remains the primary orchestration target. ChatManager's project isolation (MessageRepository per project) is already implemented and just needs hardening. Project-scoped search is handled by `ProjectContextCache` using `contextSource.inclusions/exclusions` patterns, not by `VectorStoreManager` path filtering.

## Complexity Tracking

> No constitution violations detected. Table left empty.
