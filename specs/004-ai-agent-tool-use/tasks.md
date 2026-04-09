# Tasks: AI Agent with Tool Use

**Input**: Design documents from `/specs/004-ai-agent-tool-use/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not explicitly requested in the specification. Test tasks are omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Extend existing tool infrastructure with approval categories, data model types, and foundational agent types

- [x] T001 Add `ToolInvocation`, `ToolExecutionError`, `AgentTurn`, `AgentSession`, `AgentSessionStatus`, `ToolInvocationStatus` types to src/tools/types.ts (new file, all types from data-model.md)
- [x] T002 [P] Add `approvalCategory` field (`'auto' | 'confirm'`) to `ToolMetadata` interface in src/tools/ToolRegistry.ts
- [x] T003 [P] Add `setEnabled(id, enabled)` method to `ToolRegistry` class in src/tools/ToolRegistry.ts
- [x] T004 [P] Add `getToolDescriptions()` method to `ToolRegistry` class in src/tools/ToolRegistry.ts — returns LLM-consumable string of all enabled tools with name + description + parameter schema

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Annotate all built-in tools with approval categories and add tool result formatting — MUST be complete before user story work

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Add `approvalCategory: 'auto'` to all read-only built-in tools (`localSearch`, `webSearch`, `readNote`, `getCurrentTime`, `getTimeInfoByEpoch`, `getTimeRangeMs`, `convertTimeBetweenTimezones`, `youtubeTranscription`, `getFileTree`, `getTagList`, `obsidianDailyNote`, `obsidianRandomRead`, `obsidianProperties`, `obsidianTasks`, `obsidianLinks`, `obsidianTemplates`, `obsidianBases`) in src/tools/builtinTools.ts
- [x] T006 [P] Add `approvalCategory: 'confirm'` to all mutating built-in tools (`writeFile`, `editFile`, `saveToWiki`, `updateMemory`) in src/tools/builtinTools.ts
- [x] T007 [P] Add `formatToolResult(toolId, result, status)` function to src/tools/ToolResultFormatter.ts — wraps tool results in `<tool-result tool="..." status="success|error">` XML tags, with truncation logic for large results (configurable maxLength per tool, default 8000 chars)
- [x] T008 [P] Add `checkApprovalRequired(tool, requireToolApproval)` pure function to src/LLMProviders/chainRunner/utils/toolExecution.ts — returns boolean based on tool metadata `approvalCategory` and global setting
- [x] T009 Add pre-execution approval gate to `executeSequentialToolCall()` in src/LLMProviders/chainRunner/utils/toolExecution.ts — if `checkApprovalRequired` returns true, invoke `onApprovalRequest` callback; if rejected, return error result with `rejected` status

**Checkpoint**: Foundation ready — tool metadata annotated, result formatting and approval gate in place

---

## Phase 3: User Story 1 — Automatic Tool Routing (Priority: P1) 🎯 MVP

**Goal**: The LLM automatically selects and invokes tools based on user intent, without explicit @-mentions. The agent loop orchestrates multi-turn LLM↔tool interaction with streaming turn updates.

**Independent Test**: Send queries like "What were my key takeaways from Q1 meetings?" (vault), "What's the latest news on X?" (web), and "What is the capital of France?" (no tool). Verify the agent selects the correct tool or no tool in each case.

### Implementation for User Story 1

- [x] T010 [US1] Create `AgentLoopParams` interface and `runAgentLoop(params): Promise<AgentSession>` function in src/tools/agentLoop.ts — implements the core while-loop: send user message + system prompt + tool definitions to LLM → parse tool calls → execute tools (via `executeSequentialToolCall`) → format results (via `formatToolResult`) → append to conversation → re-send to LLM → repeat until final text response (no tool calls) or `maxTurns` reached
- [x] T011 [US1] Add turn tracking to `runAgentLoop()` in src/tools/agentLoop.ts — record each `AgentTurn` with `turnNumber`, `llmResponse`, `toolInvocations[]`, `isFinalTurn`, `timestamp`; expose via `AgentSession.turns`
- [x] T012 [US1] Add cancellation support to `runAgentLoop()` in src/tools/agentLoop.ts — accept `AbortController`, check signal before each LLM call and tool execution; set `AgentSession.status = 'cancelled'` on abort
- [x] T013 [US1] Add error recovery to `runAgentLoop()` in src/tools/agentLoop.ts — wrap each tool execution in try/catch, on failure set `ToolInvocation.status = 'failed'` with `ToolExecutionError`, feed structured error result back to LLM as observation so it can retry or continue with partial results
- [x] T014 [US1] Create agent system prompt module in src/system-prompts/agentSystemPrompt.ts — export `AGENT_INSTRUCTIONS` string with guidance on when to use tools vs answer directly, how to reason about multi-step tasks, turn limit awareness; export `composeAgentPrompt(baseSystemPrompt, agentInstructions, toolDescriptions): string` composer function
- [x] T015 [US1] Integrate `runAgentLoop()` into `AutonomousAgentChainRunner` in src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts — replace or wrap existing `runReActLoop()` to use the new `runAgentLoop()`, passing the existing `updateCurrentAiMessage` as the `onTurnUpdate` callback, `abortController` for cancellation, and `getAvailableTools()` for tool list
- [x] T016 [US1] Add `maxAgentTurns` (number, default 10, range 1–25) and `requireToolApproval` (boolean, default true) settings to `CopilotSettings` interface and `DEFAULT_SETTINGS` in src/settings/model.ts — add validation in `sanitizeCopilotSettings()`
- [x] T017 [US1] Wire `maxAgentTurns` setting into `AutonomousAgentChainRunner` in src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts — pass `settings.maxAgentTurns` (or fallback to `settings.autonomousAgentMaxIterations`) as `maxTurns` to `runAgentLoop()`

**Checkpoint**: Agent automatically routes queries to tools, executes them, and synthesizes responses. Single-tool and no-tool paths functional.

---

## Phase 4: User Story 2 — Explicit Tool Selection via @ Palette (Priority: P2)

**Goal**: Users type "@" to open a tool palette, select a specific tool, and the agent invokes that tool with the user's query.

**Independent Test**: Type "@" in chat input. Verify all registered tools appear. Select @websearch, type a query, verify web search results are returned.

### Implementation for User Story 2

- [x] T018 [US2] Extend `ToolRegistry.getCopilotCommandMappings()` in src/tools/ToolRegistry.ts to include all tools that have `copilotCommands` mapped — ensure every enabled tool with an @-command appears in the palette data source
- [x] T019 [US2] Ensure the existing @-mention palette component renders tool entries from `getCopilotCommandMappings()` with `displayName` and `description` — in the relevant mention/autocomplete component under src/components/ or src/mentions/ (locate existing @-palette component and verify it uses ToolRegistry as data source)
- [x] T020 [US2] When a user selects a tool via @-palette and sends a message, ensure the selected tool ID is passed through to the chain runner so it can be force-invoked — verify in src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts that explicit @-tool selections bypass automatic routing and directly invoke the specified tool

**Checkpoint**: Users can explicitly select tools via @-palette. Selected tool is invoked with the query.

---

## Phase 5: User Story 3 — Multi-Tool Chaining (Priority: P3)

**Goal**: The agent chains multiple tools in sequence within a single conversation turn to answer complex cross-source queries.

**Independent Test**: Ask "Compare what my notes say about habit formation with the latest research". Verify vault search AND web search are both called, and the response references content from both.

### Implementation for User Story 3

- [x] T021 [US3] Ensure `runAgentLoop()` in src/tools/agentLoop.ts handles multiple tool calls per LLM response — parse all tool calls from a single LLM response, execute them sequentially (or in parallel if independent), append all results, and re-invoke LLM
- [x] T022 [US3] Add partial failure handling in src/tools/agentLoop.ts — when one tool in a multi-tool turn fails, continue executing remaining tools, feed all results (including error results) back to LLM, and let it synthesize with available information
- [x] T023 [US3] Verify multi-tool chaining works end-to-end in `AutonomousAgentChainRunner` in src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts — ensure the conversation context accumulates tool results across turns and the LLM can reference results from earlier turns when formulating the final response

**Checkpoint**: Agent chains 2+ tools and synthesizes responses from multiple sources. Partial failures degrade gracefully.

---

## Phase 6: User Story 4 — Tool Execution Transparency (Priority: P4)

**Goal**: Real-time status indicators show which tools are running, and completed responses include tool usage attribution.

**Independent Test**: Trigger a multi-tool query. Verify progress indicators appear during execution. Verify the final response includes tool usage attribution.

### Implementation for User Story 4

- [x] T024 [US4] Extend the `onTurnUpdate` callback in src/tools/agentLoop.ts to emit granular status events — emit `ToolInvocation` status transitions (pending → running → completed/failed) as they happen, not just at turn completion, so the UI can show real-time progress
- [x] T025 [US4] Update tool call visualization in src/components/chat-components/ (ToolCallDisplay or toolCallRootManager.tsx) — render status transitions: spinner during `running`, checkmark icon on `completed`, X icon on `failed`; show tool name and elapsed time for calls >2s
- [x] T026 [P] [US4] Add collapsible result preview to tool call cards in src/components/chat-components/ (ToolCallDisplay or toolCallRootManager.tsx) — show first 200 chars of result expanded, rest collapsed behind a "Show more" toggle
- [x] T027 [P] [US4] Add inline approve/reject buttons for `confirm`-category tools in tool call cards in src/components/chat-components/ (ToolCallDisplay or toolCallRootManager.tsx) — when a tool invocation is in `pending` status with `approvalCategory: 'confirm'`, render "Approve" and "Reject" buttons; clicking resolves the approval promise in `toolExecution.ts`
- [x] T028 [US4] Add tool usage attribution to final agent response in src/tools/agentLoop.ts — after the agent produces a final text response, append a "Sources" section listing which tools were used (tool display name + emoji) and summarize each tool's contribution

**Checkpoint**: Users see real-time tool execution progress and can identify which tools contributed to the response.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T029 [P] Add `enabledTools` setting (string array, default all tool IDs) to `CopilotSettings` in src/settings/model.ts — allow users to selectively disable specific tools from agent mode
- [x] T030 [P] Update docs/agent-mode-and-tools.md with documentation for the new agent tool use features — tool routing, @-palette, multi-tool chaining, approval flow, settings
- [x] T031 Run quickstart.md verification checklist — verify all scenarios from specs/004-ai-agent-tool-use/quickstart.md pass end-to-end
- [x] T032 [P] Code review: ensure all new functions in agentLoop.ts, agentSystemPrompt.ts, toolExecution.ts have JSDoc comments per project conventions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T001, T002 for types and `approvalCategory` field) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 completion — core agent loop
- **US2 (Phase 4)**: Depends on Phase 2 completion — can run in parallel with US1 (independent @-palette work)
- **US3 (Phase 5)**: Depends on US1 completion (Phase 3) — extends `runAgentLoop()` for multi-tool
- **US4 (Phase 6)**: Depends on US1 completion (Phase 3) — extends UI and formatting
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Phase 2 — no dependencies on other stories
- **User Story 2 (P2)**: Can start after Phase 2 — independent of US1 (uses existing @-mention infrastructure)
- **User Story 3 (P3)**: Depends on US1 — extends the agent loop with multi-tool handling
- **User Story 4 (P4)**: Depends on US1 — extends the agent loop with real-time status and attribution

### Within Each User Story

- Types and interfaces before implementation
- Core logic before integration
- Backend before UI
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1**: T002, T003, T004 can all run in parallel (different methods on `ToolRegistry`)
- **Phase 2**: T006, T007, T008 can all run in parallel (different files)
- **Phase 3 (US1)**: T014 (system prompt) can run in parallel with T010–T013 (agent loop)
- **Phase 4 (US2)**: Entire phase can run in parallel with Phase 3 (US1)
- **Phase 6 (US4)**: T026, T027 can run in parallel (different UI components)
- **Phase 7**: T029, T030, T032 can all run in parallel

---

## Parallel Example: User Story 1

```
# These can run in parallel (different files):
T014: src/system-prompts/agentSystemPrompt.ts  (no dependency on agentLoop.ts)
T016: src/settings/model.ts                     (no dependency on agentLoop.ts)

# These must be sequential:
T010 → T011 → T012 → T013  (all in agentLoop.ts, building incrementally)

# Then integration:
T015 (depends on T010-T013 and T014)
T017 (depends on T015 and T016)
```

## Parallel Example: User Story 4

```
# These can run in parallel (different aspects of UI):
T026: Collapsible result preview (UI component)
T027: Approve/reject buttons (UI component)

# These must be sequential:
T024 → T025 (status events before UI renders them)
T028 (attribution after agent loop is extended)
```

---

## Implementation Strategy

### MVP Scope (Recommended First Delivery)

Phases 1 + 2 + 3 (User Story 1): Agent automatically routes queries to tools and synthesizes responses. This is the core value proposition — "it just works" without user intervention.

### Incremental Delivery

1. **MVP**: Phases 1–3 (Setup + Foundation + Automatic Tool Routing)
2. **+Palette**: Phase 4 (Explicit @-tool selection)
3. **+Chaining**: Phase 5 (Multi-tool sequential queries)
4. **+Transparency**: Phase 6 (Real-time status + attribution)
5. **+Polish**: Phase 7 (Docs, settings, cleanup)

### Key Architectural Decisions (from research.md)

- **Agent loop**: Simple while-loop, not FSM or LangChain AgentExecutor
- **Approval**: Category-based (`auto`/`confirm`), not per-tool settings
- **Results**: XML-wrapped (consistent with existing `<embedded-note>` pattern)
- **Errors**: Fed back to LLM as observations; LLM decides retry or proceed
- **System prompt**: New dedicated module, does NOT modify existing prompts
