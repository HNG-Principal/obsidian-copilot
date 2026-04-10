# Research Decisions: AI Agent & Tool Use

**Feature**: `004-ai-agent-tool-use` | **Date**: 2026-04-08

---

## 1. Agent Loop Architecture

**Decision**: Simple while-loop agent with turn tracking, rather than a finite state machine or complex planning architecture.

**Rationale**: The agent loop is fundamentally: `while (LLM wants to call tools) { execute tools → feed results back → ask LLM again }`. The existing `AutonomousAgentChainRunner` already implements a version of this. A while-loop is easier to debug, test, and reason about than an FSM. Turn limits prevent runaway loops.

**Alternatives Considered**:

- **LangChain AgentExecutor**: Rejected — adds abstraction layer over existing tool infrastructure. We already have `BaseChainRunner` + `ToolRegistry`.
- **Finite State Machine**: Rejected — over-engineering for the current scope. States would be: idle → planning → executing → observing → done. This maps naturally to a loop, not an FSM.
- **ReAct with explicit reasoning**: Considered — could improve agent quality but requires prompt changes. Defer to v2.

**Implementation Approach**:

- `agentLoop.ts` exports `runAgentLoop(params)` which:
  1. Sends user message + system prompt + tool definitions to LLM
  2. If LLM response includes tool calls, execute them (with approval gate)
  3. Append tool results to conversation, re-send to LLM
  4. Repeat until LLM produces a final text response (no tool calls) or turn limit reached
- Turn tracking: `AgentTurn[]` array records each iteration for debugging/display
- Max turns: configurable (default 10), hard cap at 25

---

## 2. Tool Approval Strategy

**Decision**: Category-based automatic approval with explicit user confirmation for destructive operations only.

**Rationale**: Requiring approval for every tool call would make the agent unusable. Categorizing tools into "safe" (read-only: search, read note, get time) and "destructive" (write file, edit file, delete) allows safe tools to auto-execute while protecting against unintended writes.

**Alternatives Considered**:

- **Approve every call**: Rejected — too disruptive for agent flow.
- **Never require approval**: Rejected — writing/editing files without user consent is unsafe.
- **Per-tool approval settings**: Considered — more granular but complex UX. Category-based is sufficient for v1.

**Implementation Approach**:

- `ToolMetadata` extended with `approvalCategory: 'auto' | 'confirm'`
- Read-only tools: `auto` (search, read, time, file tree, YouTube transcript)
- Mutating tools: `confirm` (edit file, write file)
- In `toolExecution.ts`: pre-execution check, if `confirm` → show approval UI → wait for user response
- Approval UI: show tool name, parameters, and a brief description of what will happen
- Settings toggle: `requireToolApproval` (default true) — advanced users can disable

---

## 3. Streaming Tool Call Visualization

**Decision**: Render tool calls inline in the chat stream as collapsible cards showing tool name, parameters, status (pending/running/completed/failed), and result preview.

**Rationale**: Users need visibility into what the agent is doing. Streaming visualization builds trust and allows early intervention (cancel). The existing `ToolCallDisplay.tsx` provides a foundation.

**Alternatives Considered**:

- **Log-only (no UI)**: Rejected — users can't see what's happening.
- **Separate tool panel**: Rejected — context-switching away from chat is disruptive.
- **Full result in chat**: Rejected — tool results can be very long. Collapsible cards balance visibility with space.

**Implementation Approach**:

- Extend `ToolCallDisplay.tsx` with status states: `pending → running → completed | failed`
- Show spinner during execution, checkmark/X on completion
- Collapsible result preview: first 200 chars expanded, rest collapsed
- For approval-required tools: inline approve/reject buttons in the card
- Streaming: render tool call card as soon as LLM emits tool call tokens, update status in real-time

---

## 4. Error Recovery Strategy

**Decision**: Per-tool error handling with retry for transient errors, skip for permanent errors, and graceful agent loop continuation.

**Rationale**: Tool failures shouldn't crash the agent loop. A failed search shouldn't prevent the agent from answering with what it already knows. The LLM is capable of reasoning about tool failures if given structured error information.

**Alternatives Considered**:

- **Stop agent on any error**: Rejected — too fragile. Many errors are recoverable.
- **Automatic retry all errors**: Rejected — some errors (invalid file path, missing note) are permanent.
- **Let LLM decide retry**: Considered — the LLM could decide to retry with different parameters. Implemented as: error result is fed back to the LLM, which can choose to retry or proceed.

**Implementation Approach**:

- `toolExecution.ts`: wrap each tool in try/catch, return structured error result
- Error result format: `{ error: true, errorType: string, message: string }`
- Feed error results back to LLM as "observation" messages
- LLM can retry (count toward turn limit) or synthesize answer using available information
- Timeout: per-tool configurable timeout (existing `ToolMetadata.timeoutMs`), default 30s

---

## 5. Tool Result Formatting

**Decision**: Structured XML-wrapped tool results with clear boundaries, consistent with the existing context pipeline's XML tag convention.

**Rationale**: The codebase already uses XML tags for context wrapping (`<embedded-pdf>`, `<embedded-note>`, etc.). Tool results should use the same pattern for consistency. XML tags make it easy for the LLM to distinguish tool results from conversation content.

**Alternatives Considered**:

- **JSON tool results**: Rejected — less readable for LLMs, inconsistent with existing XML convention.
- **Plain text results**: Rejected — no clear result boundaries for the LLM.
- **Markdown-formatted results**: Considered — but XML wrapper around markdown provides clearer boundaries.

**Implementation Approach**:

- Each tool result wrapped in `<tool-result tool="toolName" status="success|error">`
- Content inside is markdown (for search results, note content, etc.) or structured data
- Reuse existing citation utils for source attribution within tool results
- Truncate large results to prevent context overflow (configurable per-tool max result length)

---

## 6. Agent System Prompt Strategy

**Decision**: Dedicated agent system prompt module that composes the base system prompt with agent-specific instructions and tool descriptions.

**Rationale**: The agent needs additional instructions about tool use, when to search vs answer directly, and how to handle multi-step tasks. This is a new prompt, not a modification of existing prompts (Constitution III compliance).

**Alternatives Considered**:

- **Modify existing system prompt**: Rejected — violates Constitution III.
- **No agent-specific prompt (rely on tool descriptions only)**: Rejected — insufficient guidance for multi-step reasoning.
- **Few-shot examples in prompt**: Considered — deferred to v2 to avoid context window waste.

**Implementation Approach**:

- `src/system-prompts/agentSystemPrompt.ts` — agent-specific instructions
- Composed at runtime: `baseSystemPrompt + agentInstructions + toolDescriptions`
- Tool descriptions auto-generated from `ToolRegistry` metadata (tool name + description + parameter schemas)
- Agent instructions: when to use tools, how to format final answers, turn limit awareness
