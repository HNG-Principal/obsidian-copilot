# Interface Contracts: AI Agent & Tool Use

**Feature**: `004-ai-agent-tool-use` | **Date**: 2026-04-08

---

## Core Interfaces

### IAgentLoop

```typescript
interface IAgentLoop {
  /**
   * Run the agent loop: LLM → tools → LLM → ... → final answer.
   * @param params - Agent loop parameters
   * @returns Agent session with all turns and final response
   */
  run(params: AgentLoopParams): Promise<AgentSession>;

  /**
   * Cancel a running agent session.
   */
  cancel(sessionId: string): void;
}

interface AgentLoopParams {
  /** User message to process */
  userMessage: string;
  /** Conversation history (for context) */
  conversationHistory: ChatMessage[];
  /** System prompt (base + agent instructions) */
  systemPrompt: string;
  /** Available tools (from ToolRegistry) */
  tools: Tool[];
  /** Maximum turns before stopping */
  maxTurns: number;
  /** Callback for streaming turn updates to UI */
  onTurnUpdate: (turn: AgentTurn) => void;
  /** Callback for tool approval requests */
  onApprovalRequest: (invocation: ToolInvocation) => Promise<boolean>;
  /** LLM invoke function */
  invokeLLM: (messages: ChatMessage[], tools: Tool[]) => Promise<LLMResponse>;
}
```

### IToolExecutor (extends existing toolExecution.ts)

```typescript
interface IToolExecutor {
  /**
   * Execute a single tool with approval gate, timeout, and error handling.
   * @param invocation - Tool invocation with parameters
   * @param tool - Tool definition from registry
   * @param onApproval - Callback for approval-required tools
   * @returns Updated invocation with result or error
   */
  execute(
    invocation: ToolInvocation,
    tool: Tool,
    onApproval?: (inv: ToolInvocation) => Promise<boolean>
  ): Promise<ToolInvocation>;
}
```

### IToolRegistry (extends existing ToolRegistry)

```typescript
interface IToolRegistry {
  /** Register a tool. */
  register(tool: Tool): void;

  /** Get all enabled tools with their metadata. */
  getEnabledTools(): Tool[];

  /** Get a tool by ID. Returns undefined if not found. */
  getTool(id: string): Tool | undefined;

  /** Enable or disable a tool. */
  setEnabled(id: string, enabled: boolean): void;

  /** Get tool descriptions formatted for LLM system prompt. */
  getToolDescriptions(): string;
}
```

---

## Pure Function Type Contracts

### Format Tool Result

```typescript
/**
 * Wrap a tool result in XML tags for LLM consumption.
 * Pure function: tool output → formatted string.
 */
type FormatToolResult = (toolId: string, result: string, status: "success" | "error") => string;

// Output format:
// <tool-result tool="local_search" status="success">
//   [result content]
// </tool-result>
```

### Compose Agent System Prompt

```typescript
/**
 * Compose the full agent system prompt from components.
 * Pure function: no side effects.
 */
type ComposeAgentPrompt = (
  baseSystemPrompt: string,
  agentInstructions: string,
  toolDescriptions: string
) => string;
```

### Check Approval Required

```typescript
/**
 * Determine if a tool invocation requires user approval.
 * Pure function: tool metadata → boolean.
 */
type CheckApprovalRequired = (tool: Tool, requireToolApproval: boolean) => boolean;
```

---

## Settings Contract

New settings in `CopilotSettings`:

| Setting               | Type       | Default   | Range | Description                            |
| --------------------- | ---------- | --------- | ----- | -------------------------------------- |
| `maxAgentTurns`       | `number`   | `10`      | 1–25  | Maximum agent loop iterations          |
| `requireToolApproval` | `boolean`  | `true`    | —     | Require approval for destructive tools |
| `enabledTools`        | `string[]` | all tools | —     | List of enabled tool IDs               |

Existing settings reused:

- `enableAgentMode` — enable/disable agent mode toggle

---

## Event Hooks

| Hook                | Trigger                             | Handler                                   |
| ------------------- | ----------------------------------- | ----------------------------------------- |
| Agent loop started  | User sends message in agent mode    | `runAgentLoop()`                          |
| Tool call detected  | LLM response includes tool calls    | `toolCallParser.parse()` → tool execution |
| Approval requested  | Destructive tool call pending       | UI approval callback                      |
| Tool completed      | Tool execution finished             | `onTurnUpdate()` callback to UI           |
| Agent loop complete | Final answer produced or turn limit | `AgentSession` returned                   |
| Agent cancelled     | User clicks cancel                  | `cancel()` sets session status            |
