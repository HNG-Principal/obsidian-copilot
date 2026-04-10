# Quickstart: AI Agent & Tool Use

**Feature**: `004-ai-agent-tool-use` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: Extend Tool Metadata

Modify `src/tools/ToolRegistry.ts`:

- Add `approvalCategory` field to `ToolMetadata`
- Add `setEnabled(id, enabled)` method
- Add `getToolDescriptions()` for LLM prompt generation

Modify `src/tools/builtinTools.ts`:

- Add `approvalCategory: 'auto'` to read-only tools (search, read, time, file tree)
- Add `approvalCategory: 'confirm'` to mutating tools (edit file, write file)

### Step 2: Tool Execution with Approval Gate

Modify `src/tools/toolExecution.ts`:

- Add pre-execution approval check for `confirm` category tools
- Add per-tool timeout wrapping (use `Promise.race` with timeout)
- Return structured `ToolInvocation` result with status and timing
- Wrap tool errors in `ToolExecutionError` (not throw)

### Step 3: Tool Result Formatting

Add tool result formatting helpers:

- `formatToolResult(toolId, result, status)` → XML-wrapped string
- Truncation logic for large results (configurable max length per tool)
- Consistent with existing XML context tags pattern

### Step 4: Agent Loop

Create `src/tools/agentLoop.ts`:

- `runAgentLoop(params): Promise<AgentSession>`
- While loop: send to LLM → parse tool calls → execute → append results → repeat
- Track `AgentTurn[]` for each iteration
- Terminate conditions: no tool calls (final answer), turn limit reached, cancelled
- Pass `onTurnUpdate` callback for streaming UI updates

### Step 5: Agent System Prompt

Create `src/system-prompts/agentSystemPrompt.ts`:

- Agent-specific instructions (when to use tools, how to reason about results)
- `composeAgentPrompt(base, agentInstructions, toolDescriptions)` composer
- Tool descriptions auto-generated from registry metadata

### Step 6: Wire Chain Runner

Modify `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`:

- Integrate with `runAgentLoop()` from `agentLoop.ts`
- Pass approval callback that triggers UI approval dialog
- Stream turn updates to chat UI

### Step 7: Streaming Tool Call UI

Modify `src/components/chat-components/ToolCallDisplay.tsx`:

- Status states: pending → running → completed/failed
- Spinner during execution, checkmark/X on completion
- Collapsible result preview (first 200 chars)
- Inline approve/reject buttons for `confirm` category tools

### Step 8: Settings

Modify `src/settings/model.ts`:

- Add `maxAgentTurns`, `requireToolApproval`, `enabledTools`
- Settings UI for tool toggle and agent configuration

---

## Prerequisites

- Existing `ToolRegistry` with all builtin tools registered
- Existing `AutonomousAgentChainRunner` operational
- Existing `toolCallParser.ts` functional

---

## Verification Checklist

- [ ] Agent answers simple question without tool use
- [ ] Agent uses search tool to find vault information
- [ ] Agent uses read note tool to retrieve specific note
- [ ] Agent chains multiple tools in sequence (search → read → answer)
- [ ] Destructive tool (edit file) shows approval dialog
- [ ] User can approve or reject tool execution
- [ ] Rejected tool sends error to LLM, agent continues
- [ ] Agent respects max turn limit
- [ ] Agent cancellation stops execution
- [ ] Tool timeout triggers graceful error handling
- [ ] Tool call cards show status transitions in UI
- [ ] Collapsible results expand/collapse correctly
- [ ] Agent system prompt includes all enabled tool descriptions
- [ ] All new functions have passing unit tests

---

## Key Files Reference

| File                                                         | Purpose                                         |
| ------------------------------------------------------------ | ----------------------------------------------- |
| `src/tools/agentLoop.ts`                                     | Agent execution loop (new)                      |
| `src/tools/ToolRegistry.ts`                                  | Tool registry with approval metadata (modified) |
| `src/tools/builtinTools.ts`                                  | Built-in tool definitions (modified)            |
| `src/tools/toolExecution.ts`                                 | Tool execution with approval gate (modified)    |
| `src/system-prompts/agentSystemPrompt.ts`                    | Agent system prompt (new)                       |
| `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts` | Chain runner integration (modified)             |
| `src/components/chat-components/ToolCallDisplay.tsx`         | Streaming tool call UI (modified)               |
| `src/settings/model.ts`                                      | Agent settings (modified)                       |
