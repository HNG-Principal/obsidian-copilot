# Data Model: AI Agent & Tool Use

**Feature**: `004-ai-agent-tool-use` | **Date**: 2026-04-08

---

## Entities

### Tool

Represents a registered tool available to the agent.

| Field              | Type                  | Description                                   |
| ------------------ | --------------------- | --------------------------------------------- |
| `id`               | `string`              | Unique tool identifier (e.g., `local_search`) |
| `displayName`      | `string`              | Human-readable name for UI                    |
| `description`      | `string`              | Description used in LLM tool descriptions     |
| `category`         | `ToolCategory`        | Functional category                           |
| `approvalCategory` | `'auto' \| 'confirm'` | Whether tool requires user approval           |
| `parameters`       | `ToolParameterSchema` | JSON Schema for tool input parameters         |
| `timeoutMs`        | `number`              | Maximum execution time                        |
| `enabled`          | `boolean`             | Whether tool is currently enabled             |

### ToolCategory (union type)

```typescript
type ToolCategory = "search" | "note" | "file" | "web" | "time" | "system";
```

### ToolInvocation

Represents a single tool call within an agent turn.

| Field         | Type                              | Description                 |
| ------------- | --------------------------------- | --------------------------- |
| `id`          | `string`                          | Unique invocation ID        |
| `toolId`      | `string`                          | Tool being called           |
| `parameters`  | `Record<string, unknown>`         | Input parameters from LLM   |
| `status`      | `ToolInvocationStatus`            | Execution status            |
| `result`      | `string \| undefined`             | Tool output (on completion) |
| `error`       | `ToolExecutionError \| undefined` | Error details (on failure)  |
| `startedAt`   | `number`                          | Execution start timestamp   |
| `completedAt` | `number \| undefined`             | Execution end timestamp     |
| `approvedBy`  | `'auto' \| 'user' \| undefined`   | How approval was granted    |

### ToolInvocationStatus (union type)

```typescript
type ToolInvocationStatus =
  | "pending" // Awaiting approval
  | "approved" // Approved, waiting to execute
  | "running" // Currently executing
  | "completed" // Successfully completed
  | "failed" // Execution failed
  | "rejected" // User rejected approval
  | "timeout"; // Execution timed out
```

### ToolExecutionError

| Field       | Type      | Description                    |
| ----------- | --------- | ------------------------------ |
| `code`      | `string`  | Error code                     |
| `message`   | `string`  | Human-readable error message   |
| `retryable` | `boolean` | Whether the error is transient |

### AgentTurn

Represents one iteration of the agent loop (LLM call → tool executions → results).

| Field             | Type               | Description                                      |
| ----------------- | ------------------ | ------------------------------------------------ |
| `turnNumber`      | `number`           | 1-indexed turn number                            |
| `llmResponse`     | `string`           | Raw LLM response (may include tool calls)        |
| `toolInvocations` | `ToolInvocation[]` | Tools called in this turn                        |
| `isFinalTurn`     | `boolean`          | Whether this turn produced a final text response |
| `timestamp`       | `number`           | Turn start timestamp                             |

### AgentSession

The full context of one agent conversation cycle.

| Field         | Type                  | Description               |
| ------------- | --------------------- | ------------------------- |
| `sessionId`   | `string`              | Unique session identifier |
| `turns`       | `AgentTurn[]`         | Ordered list of turns     |
| `status`      | `AgentSessionStatus`  | Current session status    |
| `maxTurns`    | `number`              | Maximum allowed turns     |
| `startedAt`   | `number`              | Session start timestamp   |
| `completedAt` | `number \| undefined` | Session end timestamp     |

### AgentSessionStatus (union type)

```typescript
type AgentSessionStatus =
  | "active" // Agent loop running
  | "completed" // Final answer produced
  | "turn_limit" // Max turns reached
  | "cancelled" // User cancelled
  | "error"; // Unrecoverable error
```

---

## Relationships

```
AgentSession 1──* AgentTurn (session → turns)
AgentTurn    1──* ToolInvocation (turn → tools called)
ToolInvocation *──1 Tool (invocation references a registered tool)
ToolInvocation 1──0..1 ToolExecutionError (failed invocations)
```

---

## Validation Rules

1. **Turn limit**: `turns.length ≤ maxTurns` (configurable, hard cap 25)
2. **Tool exists**: `toolInvocation.toolId` must be registered in `ToolRegistry`
3. **Tool enabled**: Only enabled tools can be invoked
4. **Parameter validation**: Tool parameters validated against `ToolParameterSchema`
5. **Approval required**: Tools with `approvalCategory: 'confirm'` must have `approvedBy` set before execution
6. **Timeout**: Tool execution duration ≤ `tool.timeoutMs`

---

## State Transitions

### Agent Session Lifecycle

```
active → completed (final answer produced)
active → turn_limit (max turns reached, return partial answer)
active → cancelled (user cancels mid-execution)
active → error (unrecoverable error in agent loop)
```

### Tool Invocation Lifecycle

```
pending → approved (auto or user) → running → completed
pending → approved (auto or user) → running → failed
pending → approved (auto or user) → running → timeout
pending → rejected (user rejected)
```

---

## Access Patterns

| Operation              | Frequency                        | Method                           |
| ---------------------- | -------------------------------- | -------------------------------- |
| Register tool          | Plugin init (once)               | `ToolRegistry.register()`        |
| Execute agent loop     | Per user query in agent mode     | `runAgentLoop()`                 |
| Get tool metadata      | Per LLM call (tool descriptions) | `ToolRegistry.getEnabledTools()` |
| Execute single tool    | Per tool call in agent turn      | `toolExecution.executeTool()`    |
| Request approval       | Per confirm-category tool call   | UI approval callback             |
| Get agent turn history | Per chat display update          | `AgentSession.turns`             |
