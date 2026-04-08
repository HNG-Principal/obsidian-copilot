# Implementation Plan: Long-Term Memory

**Branch**: `009-long-term-memory` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/009-long-term-memory/spec.md`

## Summary

Persistent cross-session memory system that automatically extracts factual knowledge from chat conversations at the end of each AI response turn, stores it in a structured local file with project tags, retrieves semantically relevant memories for injection into the AI system prompt, deduplicates overlapping entries, and provides a management UI for viewing/editing/deleting memories. Extends the existing `UserMemoryManager` pattern with a new `LongTermMemoryManager` class, implements a custom `LongTermMemoryRetriever` for cosine-similarity search over stored embeddings (not reusing vault `RetrieverFactory`), and integrates into the existing `BaseChainRunner` post-response hook.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API
**Storage**: Structured JSON file in vault (`.copilot/long-term-memory.json`), optional markdown export to configurable `memoryFolderName` folder
**Testing**: Jest + `@testing-library/react`, unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: Memory retrieval ≤2s latency per turn (SC-005), extraction non-blocking (fire-and-forget)
**Constraints**: Offline-capable (local-only storage), configurable max 10 memories injected per turn, sensitive pattern filtering
**Scale/Scope**: Thousands of memories per vault, single UI management panel, 3 new settings, ~6 source files

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._
_Post-design re-evaluation: 2026-04-08 — ALL PASS confirmed._

| Principle                          | Status   | Notes                                                                                                                                                                                                                                                                         |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | No hardcoded patterns — sensitive pattern list is configurable via regex, memory extraction is content-agnostic, no folder/naming assumptions. Confirmed in research.md §6.                                                                                                   |
| II. Clean Architecture             | **PASS** | `LongTermMemoryManager` is single source of truth. Pure leaf functions (`memoryExtractor`, `memoryDeduplicator`, `sensitivePatternFilter`) isolated for testability. `IMemoryStore` interface decouples persistence. `ILongTermMemoryManager` interface defined in contracts. |
| III. Prompt Integrity              | **PASS** | No existing prompts modified. New extraction prompt in `memoryExtractor.ts`. Injection via existing `getSystemPromptWithMemory()` adds `<long_term_memories>` XML section additively.                                                                                         |
| IV. Type Safety                    | **PASS** | `memoryTypes.ts` defines all interfaces with strict types. `MemoryCategory` as union type. `MemoryStoreData` with schema version.                                                                                                                                             |
| V. Structured Logging              | **PASS** | All logging via `logInfo/logWarn/logError` from `@/logger`.                                                                                                                                                                                                                   |
| VI. Testable by Design             | **PASS** | Three pure leaf modules with zero singleton imports: `memoryExtractor` (prompt build + response parse), `memoryDeduplicator` (merge logic), `sensitivePatternFilter` (regex filter). Manager receives `app` via constructor.                                                  |
| VII. Simplicity & Minimal Overhead | **PASS** | Reuses existing embedding model infrastructure (via `EmbeddingManager`). Custom retriever instead of overloading vault `RetrieverFactory`. Single JSON file storage. No new WASM deps, no SQLite. ~6 new source files. Extends existing fire-and-forget pattern.              |
| VIII. Documentation Discipline     | **PASS** | Will update `docs/` when user-facing behavior ships. JSDoc on all new functions.                                                                                                                                                                                              |

**Gate result: PASS — all principles confirmed post-design.**

## Project Structure

### Documentation (this feature)

```text
specs/009-long-term-memory/
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
├── memory/
│   ├── UserMemoryManager.ts           # Existing — extended to delegate LTM
│   ├── UserMemoryManager.test.ts      # Existing
│   ├── LongTermMemoryManager.ts       # NEW — core LTM logic
│   ├── LongTermMemoryManager.test.ts  # NEW — unit tests
│   ├── memoryTypes.ts                 # NEW — Memory, MemoryRetrievalResult types
│   ├── memoryExtractor.ts             # NEW — pure function: extract facts from messages
│   ├── memoryExtractor.test.ts        # NEW — unit tests
│   ├── memoryDeduplicator.ts          # NEW — pure function: dedup/merge logic
│   ├── memoryDeduplicator.test.ts     # NEW — unit tests
│   ├── sensitivePatternFilter.ts      # NEW — pure function: filter sensitive content
│   ├── sensitivePatternFilter.test.ts # NEW — unit tests
│   └── memory-design.md              # Existing design doc
├── components/
│   └── memory/
│       ├── MemoryManagementModal.tsx   # NEW — modal for viewing/editing/deleting
│       └── MemoryListItem.tsx          # NEW — individual memory row component
├── settings/
│   └── model.ts                       # MODIFIED — add LTM settings
├── tools/
│   └── memoryTools.ts                 # EXISTING — no changes needed (existing updateMemoryTool uses UserMemoryManager)
└── LLMProviders/
    └── chainRunner/
        └── BaseChainRunner.ts         # MODIFIED — add LTM extraction hook
```

**Structure Decision**: Extends existing `src/memory/` directory following the established pattern. Pure logic extracted into leaf modules (`memoryExtractor`, `memoryDeduplicator`, `sensitivePatternFilter`) for testability per Constitution VI. UI components in new `src/components/memory/` subdirectory following existing component organization. No new top-level directories.

## Complexity Tracking

> No constitution violations detected. Table left empty.
