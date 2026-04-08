# Implementation Plan: Projects Mode

**Branch**: `008-projects-mode` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-projects-mode/spec.md`

## Summary

Project-scoped chat and context system that allows users to define named projects with specific vault folders, custom system prompts, and isolated conversation histories. Extends the existing `ProjectManager` singleton, `ProjectChainRunner`, `ProjectContextCache`, and project UI components. Adds project templates, project-aware search scoping, and improved project switching with automatic context refresh.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API
**Storage**: Project configs in `CopilotSettings.projectList`, project conversations in `.copilot/chat-history/` (prefixed with project ID)
**Testing**: Jest + unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: Project switch <2s (SC-001), context refresh <3s (SC-002)
**Constraints**: Backwards compatible with existing project system, project isolation must extend to all context sources (search, files, prompts, tools)
**Scale/Scope**: ~8 modified files, extends existing project infrastructure

## Constitution Check

| Principle                          | Status   | Notes                                                                                                                                                           |
| ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | Projects are user-defined with arbitrary folder paths, names, and prompts. No hardcoded project templates or folder structures.                                 |
| II. Clean Architecture             | **PASS** | `ProjectManager` (lifecycle) → `ProjectChainRunner` (LLM config) → `ProjectContextCache` (indexed context) → `ChatManager` (isolated messages). Clean layering. |
| III. Prompt Integrity              | **PASS** | No existing prompts modified. Project system prompts are user-authored and injected via existing `getEffectiveUserPrompt()`.                                    |
| IV. Type Safety                    | **PASS** | `ProjectConfig` type covers all project properties. `ProjectManager` methods are fully typed.                                                                   |
| V. Structured Logging              | **PASS** | All logging via `logInfo/logWarn/logError`.                                                                                                                     |
| VI. Testable by Design             | **PASS** | Project config validation is pure. Path scoping is pure (project folders → search filter). Context refresh is orchestrated through mockable interfaces.         |
| VII. Simplicity & Minimal Overhead | **PASS** | Extends existing `ProjectManager`, `ProjectChainRunner`. No new infrastructure — project isolation already partially implemented in ChatManager.                |
| VIII. Documentation Discipline     | **PASS** | JSDoc on all new functions. Will update `docs/projects.md`.                                                                                                     |

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
├── core/
│   ├── ChatManager.ts                     # MODIFIED — project-aware message repo switching
│   └── ChatPersistenceManager.ts          # MODIFIED — project-prefixed chat history files
├── cache/
│   └── projectContextCache.ts             # MODIFIED — scoped search and context caching
├── services/
│   └── ProjectManager.ts                  # MODIFIED — enhanced project lifecycle, templates
├── LLMProviders/
│   └── ProjectChainRunner.ts              # MODIFIED — project-scoped chain config
├── search/
│   └── VectorStoreManager.ts              # MODIFIED — project-scoped search filtering
├── components/
│   └── project/                           # MODIFIED — project UI (create, switch, settings)
├── settings/
│   └── model.ts                           # MODIFIED — ProjectConfig schema, project templates
└── state/
    └── ChatUIState.ts                     # MODIFIED — project switch notification
```

**Structure Decision**: No new files needed — this feature extends the existing project infrastructure. `ProjectManager.ts` is the primary modification target. ChatManager's project isolation (MessageRepository per project) is already implemented and just needs hardening.

## Complexity Tracking

> No constitution violations detected. Table left empty.
