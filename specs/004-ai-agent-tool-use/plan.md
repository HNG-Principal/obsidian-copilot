# Implementation Plan: AI Agent & Tool Use

**Branch**: `004-ai-agent-tool-use` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-ai-agent-tool-use/spec.md`

## Summary

AI agent mode with a structured tool-use pipeline enabling the LLM to execute actions (search, file operations, web queries) through a registry-based tool system. Features tool approval UI, streaming tool call visualization, error recovery, multi-step agent loops, and autonomous operation mode. Extends the existing `ToolRegistry`, `BaseChainRunner`, and `BUILTIN_TOOLS` infrastructure. Introduces a standardized tool execution lifecycle with approval gates, result formatting, and citation tracking.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API
**Storage**: Tool state in memory (per-conversation), tool configs in `CopilotSettings`
**Testing**: Jest + unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: Tool execution <5s for local tools (SC-001), agent loop ≤10 turns (SC-002)
**Constraints**: Tools run in plugin process (no sandboxing), approval gate for destructive operations, streaming visualization required
**Scale/Scope**: 10+ built-in tools, extensible registry, ~8 modified/new files

## Constitution Check

| Principle                          | Status   | Notes                                                                                                                                                       |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | Tool registry dispatches by metadata — no hardcoded tool references in agent loop. Category-based approval, not tool-name-based.                            |
| II. Clean Architecture             | **PASS** | Registry (tools) → Executor (orchestration) → Runner (chain integration) → UI (results). Clean separation between tool definition, execution, and display.  |
| III. Prompt Integrity              | **PASS** | No existing prompts modified. Agent system prompt is a new, dedicated module. Tool descriptions serve as prompts to the LLM.                                |
| IV. Type Safety                    | **PASS** | `ToolMetadata`, `ToolInvocation`, `AgentTurn` fully typed. Tool inputs/outputs validated against schemas.                                                   |
| V. Structured Logging              | **PASS** | All logging via `logInfo/logWarn/logError`. Tool execution logs include tool ID, duration, success/failure.                                                 |
| VI. Testable by Design             | **PASS** | Tool execution is: input → output (pure-ish). Agent loop testable with mock LLM + mock tool results. Registry testable independently.                       |
| VII. Simplicity & Minimal Overhead | **PASS** | Extends existing `ToolRegistry` and `BaseChainRunner` — no parallel infrastructure. Agent loop is a while loop with LLM calls, not a complex state machine. |
| VIII. Documentation Discipline     | **PASS** | Will update `docs/agent-mode-and-tools.md`. JSDoc on all new functions.                                                                                     |

**Gate result: PASS — all principles confirmed.**

## Project Structure

### Documentation (this feature)

```text
specs/004-ai-agent-tool-use/
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
├── tools/
│   ├── ToolRegistry.ts              # MODIFIED — add approval category classification, tool enable/disable
│   ├── builtinTools.ts              # MODIFIED — add approval category metadata to each tool
│   ├── toolExecution.ts             # MODIFIED — add approval gate, timeout handling, result formatting
│   ├── toolCallParser.ts            # EXISTING — reused for LLM tool call extraction
│   ├── citationUtils.ts             # EXISTING — reused for source attribution
│   ├── agentLoop.ts                 # NEW — multi-step agent execution loop with turn management
│   └── agentLoop.test.ts            # NEW — unit tests for agent loop
├── LLMProviders/
│   ├── chainRunner/
│   │   ├── BaseChainRunner.ts       # EXISTING — base class for chain runners
│   │   └── AutonomousAgentChainRunner.ts  # MODIFIED — integrate with agentLoop.ts
├── components/
│   └── chat-components/
│       └── ToolCallDisplay.tsx       # MODIFIED — streaming tool call visualization, approval UI
└── settings/
    └── model.ts                     # MODIFIED — add tool approval settings, max agent turns
```

**Structure Decision**: New `agentLoop.ts` centralizes the agent execution cycle, keeping it separate from chain runners (which handle LLM communication). Tool approval is added to `toolExecution.ts` as a pre-execution gate, keeping tool definition separate from execution policy.

## Complexity Tracking

> No constitution violations detected. Table left empty.
