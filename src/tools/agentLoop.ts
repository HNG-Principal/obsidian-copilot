import { ResponseMetadata, StreamingResult } from "@/types/message";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { StructuredTool } from "@langchain/core/tools";
import {
  createToolResultMessage,
  generateToolCallId,
} from "@/LLMProviders/chainRunner/utils/nativeToolCalling";
import {
  executeSequentialToolCall,
  getToolDisplayName,
  getToolEmoji,
} from "@/LLMProviders/chainRunner/utils/toolExecution";
import {
  findDuplicateQuery,
  stripLeakedRoleLines,
} from "@/LLMProviders/chainRunner/utils/queryDeduplication";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { formatToolResult } from "@/tools/ToolResultFormatter";
import { AgentSession, AgentTurn, ToolInvocation } from "@/tools/types";

type Source = { title: string; path: string; score: number; explanation?: any };

interface InvokeLLMResult {
  content: string;
  aiMessage: AIMessage;
  streamingResult: StreamingResult;
}

interface ProcessToolResultContext {
  originalPrompt: string;
}

interface ProcessToolResultOutput {
  llmResult: string;
  displayResult?: string;
  sources?: Source[];
}

export interface AgentLoopParams {
  userMessage: string;
  messages: BaseMessage[];
  tools: StructuredTool[];
  maxTurns: number;
  abortController: AbortController;
  invokeLLM: (messages: BaseMessage[]) => Promise<InvokeLLMResult>;
  onTurnUpdate?: (session: AgentSession, turn?: AgentTurn) => void;
  onApprovalRequest?: (invocation: ToolInvocation) => Promise<boolean>;
  requireToolApproval?: boolean;
  processToolResult?: (
    toolName: string,
    result: string,
    success: boolean,
    context: ProcessToolResultContext
  ) => ProcessToolResultOutput;
}

const MAX_AGENT_TURNS = 25;

/**
 * Run the autonomous agent loop: LLM -> tools -> LLM until a final answer is produced.
 *
 * @param params - Loop parameters and callbacks.
 * @returns The completed agent session, including turns and final response.
 */
export async function runAgentLoop(params: AgentLoopParams): Promise<AgentSession> {
  const session: AgentSession = {
    sessionId: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    turns: [],
    status: "active",
    maxTurns: Math.min(Math.max(params.maxTurns, 1), MAX_AGENT_TURNS),
    startedAt: Date.now(),
  };
  const collectedSources: Source[] = [];
  const previousSearchQueries: string[] = [];
  let responseMetadata: ResponseMetadata | undefined;

  for (let turnIndex = 0; turnIndex < session.maxTurns; turnIndex++) {
    if (params.abortController.signal.aborted) {
      session.status = "cancelled";
      session.completedAt = Date.now();
      emitTurnUpdate(params, session);
      return finalizeSession(
        session,
        "The response was interrupted.",
        collectedSources,
        responseMetadata
      );
    }

    const llmResponse = await params.invokeLLM(params.messages);
    responseMetadata = {
      wasTruncated: llmResponse.streamingResult.wasTruncated,
      tokenUsage: llmResponse.streamingResult.tokenUsage ?? undefined,
    };

    const cleanedContent = stripLeakedRoleLines(llmResponse.content);
    const toolCalls = llmResponse.aiMessage.tool_calls || [];

    const turn: AgentTurn = {
      turnNumber: turnIndex + 1,
      llmResponse: cleanedContent,
      toolInvocations: toolCalls.map((toolCall) => ({
        id: toolCall.id || generateToolCallId(),
        toolId: toolCall.name,
        parameters: (toolCall.args as Record<string, unknown>) || {},
        status: "approved",
        approvedBy: "auto",
        startedAt: Date.now(),
      })),
      isFinalTurn: toolCalls.length === 0,
      timestamp: Date.now(),
    };
    session.turns.push(turn);

    if (toolCalls.length === 0) {
      params.messages.push(llmResponse.aiMessage);
      return finalizeSession(
        session,
        cleanedContent ||
          "The model did not produce a response. Please try again or switch models.",
        collectedSources,
        responseMetadata
      );
    }

    params.messages.push(
      new AIMessage({
        content: cleanedContent,
        tool_calls: llmResponse.aiMessage.tool_calls,
      })
    );
    emitTurnUpdate(params, session, turn);

    for (let index = 0; index < toolCalls.length; index++) {
      if (params.abortController.signal.aborted) {
        session.status = "cancelled";
        session.completedAt = Date.now();
        return finalizeSession(
          session,
          "The response was interrupted.",
          collectedSources,
          responseMetadata
        );
      }

      const toolCall = toolCalls[index];
      const invocation = turn.toolInvocations[index];
      const metadata = ToolRegistry.getInstance().getToolMetadata(toolCall.name);
      const query = typeof toolCall.args?.query === "string" ? toolCall.args.query : null;

      if (toolCall.name === "localSearch" && query) {
        const duplicate = findDuplicateQuery(query, previousSearchQueries);
        if (duplicate) {
          invocation.status = "failed";
          invocation.error = {
            code: "duplicate_query",
            message: `A similar search was already executed: ${duplicate}`,
            retryable: false,
          };
          invocation.completedAt = Date.now();
          params.messages.push(
            createToolResultMessage(
              invocation.id,
              toolCall.name,
              formatToolResult(
                toolCall.name,
                `A similar search was already executed: ${duplicate}`,
                "error"
              )
            )
          );
          emitTurnUpdate(params, session, turn);
          continue;
        }
      }

      const approvalRequired =
        Boolean(metadata) &&
        Boolean(params.requireToolApproval) &&
        metadata?.approvalCategory === "confirm";

      if (approvalRequired && params.onApprovalRequest) {
        invocation.status = "pending";
        invocation.approvedBy = undefined;
        emitTurnUpdate(params, session, turn);

        const approved = await params.onApprovalRequest(invocation);
        if (!approved) {
          invocation.status = "rejected";
          invocation.error = {
            code: "approval_rejected",
            message: `User rejected ${metadata?.displayName || toolCall.name}`,
            retryable: false,
          };
          invocation.completedAt = Date.now();
          params.messages.push(
            createToolResultMessage(
              invocation.id,
              toolCall.name,
              formatToolResult(toolCall.name, invocation.error.message, "error")
            )
          );
          emitTurnUpdate(params, session, turn);
          continue;
        }

        invocation.status = "approved";
        invocation.approvedBy = "user";
        emitTurnUpdate(params, session, turn);
      }

      invocation.status = "running";
      invocation.startedAt = Date.now();
      emitTurnUpdate(params, session, turn);

      const execution = await executeSequentialToolCall(
        {
          name: toolCall.name,
          args: (toolCall.args as Record<string, unknown>) || {},
        },
        params.tools,
        params.userMessage,
        approvalRequired && params.onApprovalRequest
          ? {
              requireToolApproval: false,
            }
          : {
              requireToolApproval: params.requireToolApproval,
            }
      );

      invocation.status = execution.status ?? (execution.success ? "completed" : "failed");
      invocation.completedAt = Date.now();
      invocation.approvedBy = invocation.approvedBy ?? execution.approvedBy;

      let llmResult = execution.result;
      if (params.processToolResult) {
        const processed = params.processToolResult(
          toolCall.name,
          execution.result,
          execution.success,
          { originalPrompt: params.userMessage }
        );
        llmResult = processed.llmResult;
        invocation.result = processed.displayResult ?? execution.result;
        if (processed.sources?.length) {
          collectedSources.push(...processed.sources);
        }
      } else {
        llmResult = execution.success
          ? formatToolResult(toolCall.name, execution.result, "success")
          : execution.result;
        invocation.result = execution.result;
      }

      if (!execution.success) {
        invocation.error = {
          code: execution.status === "timeout" ? "timeout" : "tool_execution_failed",
          message: execution.result,
          retryable: execution.status === "timeout",
        };
      }

      if (toolCall.name === "localSearch" && query && execution.success) {
        previousSearchQueries.push(query);
      }

      params.messages.push(createToolResultMessage(invocation.id, toolCall.name, llmResult));
      emitTurnUpdate(params, session, turn);
    }
  }

  session.status = "turn_limit";
  session.completedAt = Date.now();
  return finalizeSession(
    session,
    "I've reached the maximum number of tool calls. Here's what I found so far based on the available results.",
    collectedSources,
    responseMetadata
  );
}

/**
 * Create a tool attribution block for the final response.
 *
 * @param session - Agent session containing tool invocations.
 * @returns Markdown attribution block, or an empty string when no tools ran.
 */
export function buildToolAttribution(session: AgentSession): string {
  const registry = ToolRegistry.getInstance();
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const turn of session.turns) {
    for (const invocation of turn.toolInvocations) {
      if (seen.has(invocation.toolId)) {
        continue;
      }

      seen.add(invocation.toolId);
      const metadata = registry.getToolMetadata(invocation.toolId);
      lines.push(
        `- ${getToolEmoji(invocation.toolId)} ${metadata?.displayName || getToolDisplayName(invocation.toolId)}: ${metadata?.description || invocation.toolId}`
      );
    }
  }

  return lines.length > 0 ? `Sources:\n${lines.join("\n")}` : "";
}

function finalizeSession(
  session: AgentSession,
  finalResponse: string,
  sources: Source[],
  responseMetadata?: ResponseMetadata
): AgentSession {
  if (session.status === "active") {
    session.status = "completed";
  }

  const attribution = buildToolAttribution(session);
  session.finalResponse = attribution ? `${finalResponse}\n\n${attribution}` : finalResponse;
  session.sources = sources;
  session.responseMetadata = responseMetadata;
  session.completedAt = Date.now();
  return session;
}

function emitTurnUpdate(params: AgentLoopParams, session: AgentSession, turn?: AgentTurn): void {
  params.onTurnUpdate?.(
    {
      ...session,
      turns: session.turns.map((item) => ({
        ...item,
        toolInvocations: item.toolInvocations.map((invocation) => ({ ...invocation })),
      })),
    },
    turn
      ? {
          ...turn,
          toolInvocations: turn.toolInvocations.map((invocation) => ({ ...invocation })),
        }
      : undefined
  );
}
