# Implementation Plan: Long-Term Memory

**Branch**: `009-long-term-memory` | **Date**: 2026-04-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/009-long-term-memory/spec.md`

## Summary

Persistent cross-session memory system that automatically extracts facts from conversations, stores them as vector-embedded JSONL entries in `.copilot/memory/`, deduplicates via cosine similarity, retrieves semantically relevant memories at query time, and injects them into the AI system prompt. Includes a management UI for viewing, editing, searching, and deleting memories. Builds on the existing `UserMemoryManager` infrastructure and `EmbeddingManager` for vector operations.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain (`BaseChatModel`, `Embeddings`, `ChatPromptTemplate`), Jotai, Obsidian Plugin API, existing `EmbeddingManager`, existing `UserMemoryManager`
**Storage**: JSONL files in `.copilot/memory/` (vault-local), Obsidian `app.vault` API for file I/O
**Testing**: Jest + `@testing-library/react`, unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Desktop app plugin (feature extension)
**Performance Goals**: Memory retrieval ≤ 2s latency added to AI response; extraction ≤ 3s post-response (non-blocking)
**Constraints**: No external DB dependencies; vault-local only; max 5000 memories per vault; max 10 memories injected per turn (configurable)
**Scale/Scope**: Per-vault store, single user, up to 5000 memories

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                          | Status  | Notes                                                                                                                                                                                |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **I. Generalizable Solutions**     | ✅ PASS | No hardcoded patterns — extraction is LLM-driven, retrieval is embedding-based. Memory store works for any vault structure.                                                          |
| **II. Clean Architecture**         | ✅ PASS | Follows Repository → Manager → UIState → UI. `MemoryStore` (repository) → `LongTermMemoryManager` (manager) → Settings UI (components). Single source of truth: JSONL store on disk. |
| **III. Prompt Integrity**          | ✅ PASS | Memory injection uses existing `<saved_memories>` pattern in `getSystemPromptWithMemory()`. No modifications to user-authored prompts.                                               |
| **IV. Type Safety**                | ✅ PASS | All entities typed with interfaces. Strict mode. `@/` imports.                                                                                                                       |
| **V. Structured Logging**          | ✅ PASS | Uses `logInfo`/`logWarn`/`logError` from `@/logger`.                                                                                                                                 |
| **VI. Testable by Design**         | ✅ PASS | Core logic (extraction, dedup, retrieval) are pure functions accepting data parameters. No singletons in leaf modules.                                                               |
| **VII. Simplicity**                | ✅ PASS | Reuses existing EmbeddingManager, existing system prompt injection, existing settings patterns. No new abstractions beyond what's required.                                          |
| **VIII. Documentation Discipline** | ✅ PASS | Will update `docs/` with memory feature documentation. JSDoc on all public functions.                                                                                                |

**Gate result**: PASS — no violations. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/009-long-term-memory/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── interfaces.md
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── memory/
│   ├── UserMemoryManager.ts          # EXISTING — recent convos + saved memories
│   ├── UserMemoryManager.test.ts     # EXISTING
│   ├── memory-design.md              # EXISTING
│   ├── longTermMemoryTypes.ts        # NEW — Memory, MemoryRetrievalResult interfaces
│   ├── MemoryStore.ts                # NEW — JSONL read/write/delete/update (repository layer)
│   ├── MemoryStore.test.ts           # NEW
│   ├── sensitivePatternFilter.ts     # NEW — sensitive content filtering (pure function)
│   ├── sensitivePatternFilter.test.ts # NEW
│   ├── MemoryExtractor.ts            # NEW — LLM-based fact extraction from conversations
│   ├── MemoryExtractor.test.ts       # NEW
│   ├── MemoryDeduplicator.ts         # NEW — cosine similarity dedup + merge logic
│   ├── MemoryDeduplicator.test.ts    # NEW
│   ├── MemoryRetriever.ts            # NEW — semantic retrieval + ranking
│   ├── MemoryRetriever.test.ts       # NEW
│   ├── LongTermMemoryManager.ts      # NEW — orchestrator (manager layer)
│   └── LongTermMemoryManager.test.ts # NEW
├── components/
│   └── memory/
│       ├── MemoryManagerModal.tsx     # NEW — full memory management UI
│       └── MemoryManagerModal.test.tsx # NEW
├── settings/
│   └── v2/components/
│       └── MemorySettings.tsx        # NEW — settings section for memory config
└── system-prompts/
    └── systemPromptBuilder.ts        # UNMODIFIED — already delegates to UserMemoryManager
```

**Structure Decision**: Extends existing `src/memory/` directory. New files follow the Repository → Manager pattern: `MemoryStore` (data access) → `LongTermMemoryManager` (orchestration) → `MemoryManagerModal` (UI). Leaf modules (`MemoryExtractor`, `MemoryDeduplicator`, `MemoryRetriever`) are pure functions receiving dependencies as parameters.

## Complexity Tracking

No constitution violations — this table is empty by design.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| _(none)_  |            |                                      |
