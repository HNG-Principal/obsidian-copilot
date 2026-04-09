import { logError, logInfo, logWarn } from "@/logger";
import { checkIsPlusUser, isSelfHostModeValid } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { ToolManager } from "@/tools/toolManager";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { ToolMetadata } from "@/tools/ToolRegistry";
import { formatToolResult } from "@/tools/ToolResultFormatter";
import { ToolInvocationStatus } from "@/tools/types";
import { err2String } from "@/utils";

/**
 * Represents a tool call with name and arguments.
 * Used by native tool calling flow.
 */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolName: string;
  result: string;
  success: boolean;
  status?: ToolInvocationStatus;
  durationMs?: number;
  approvedBy?: "auto" | "user";
  /**
   * Optional display-friendly version of the tool result for UI rendering.
   * When absent, fallback to `result` for display purposes.
   */
  displayResult?: string;
}

export interface ToolExecutionOptions {
  requireToolApproval?: boolean;
  onApprovalRequest?: (request: { toolCall: ToolCall; metadata: ToolMetadata }) => Promise<boolean>;
}

/**
 * Determine whether a tool execution should request explicit approval.
 *
 * @param tool - Tool metadata.
 * @param requireToolApproval - Global approval setting.
 * @returns True when execution should be user-approved.
 */
export function checkApprovalRequired(tool: ToolMetadata, requireToolApproval: boolean): boolean {
  return requireToolApproval && tool.approvalCategory === "confirm";
}

/**
 * Executes a single tool call with timeout and error handling
 */
export async function executeSequentialToolCall(
  toolCall: ToolCall,
  availableTools: any[],
  originalUserMessage?: string,
  options?: ToolExecutionOptions
): Promise<ToolExecutionResult> {
  const DEFAULT_TOOL_TIMEOUT = 120000; // 120 seconds timeout per tool
  const startedAt = Date.now();

  try {
    // Validate tool call
    if (!toolCall || !toolCall.name) {
      return {
        toolName: toolCall?.name || "unknown",
        result: "Error: Invalid tool call - missing tool name",
        success: false,
        status: "failed",
        durationMs: Date.now() - startedAt,
      };
    }

    // Find the tool in the existing tool registry
    const tool = availableTools.find((t) => t.name === toolCall.name);

    if (!tool) {
      const availableToolNames = availableTools.map((t) => t.name).join(", ");
      return {
        toolName: toolCall.name,
        result: `Error: Tool '${toolCall.name}' not found. Available tools: ${availableToolNames}. Make sure you have the tool enabled in the Agent settings.`,
        success: false,
        status: "failed",
        durationMs: Date.now() - startedAt,
      };
    }

    // Get tool metadata from registry
    const registry = ToolRegistry.getInstance();
    const metadata = registry.getToolMetadata(toolCall.name);

    // Check if tool requires Plus subscription
    if (metadata?.isPlusOnly) {
      const isPlusUser = await checkIsPlusUser();
      if (!isPlusUser && !isSelfHostModeValid()) {
        return {
          toolName: toolCall.name,
          result: `Error: ${getToolDisplayName(toolCall.name)} requires a Copilot Plus subscription`,
          success: false,
          status: "failed",
          durationMs: Date.now() - startedAt,
        };
      }
    }

    const requireToolApproval = options?.requireToolApproval ?? getSettings().requireToolApproval;
    const approvalRequired = metadata
      ? checkApprovalRequired(metadata, requireToolApproval)
      : false;
    let approvedBy: "auto" | "user" | undefined = approvalRequired ? undefined : "auto";

    if (approvalRequired && metadata && options?.onApprovalRequest) {
      const approved = await options.onApprovalRequest({
        toolCall,
        metadata,
      });

      if (!approved) {
        const rejectionResult = formatToolResult(
          toolCall.name,
          JSON.stringify({
            error: true,
            status: "rejected",
            message: `User rejected ${getToolDisplayName(toolCall.name)}.`,
          }),
          "error"
        );

        return {
          toolName: toolCall.name,
          result: rejectionResult,
          success: false,
          status: "rejected",
          durationMs: Date.now() - startedAt,
        };
      }

      approvedBy = "user";
    }

    // Prepare tool arguments
    const toolArgs = { ...toolCall.args };

    // If tool requires user message content and it's provided, inject it
    if (metadata?.requiresUserMessageContent && originalUserMessage) {
      toolArgs._userMessageContent = originalUserMessage;
    }

    // Determine timeout for this tool
    let timeout = DEFAULT_TOOL_TIMEOUT;
    if (typeof metadata?.timeoutMs === "number") {
      timeout = metadata.timeoutMs;
    }

    let result;
    if (!timeout || timeout === Infinity) {
      // No timeout for this tool
      result = await ToolManager.callTool(tool, toolArgs);
    } else {
      // Use timeout
      result = await Promise.race([
        ToolManager.callTool(tool, toolArgs),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool execution timed out after ${timeout}ms`)),
            timeout
          )
        ),
      ]);
    }

    // Validate result
    if (result === null || result === undefined) {
      logWarn(`Tool ${toolCall.name} returned null/undefined result`);
      // Return empty JSON object instead of plain string for better compatibility
      return {
        toolName: toolCall.name,
        result: JSON.stringify({
          message: "Tool executed but returned no result",
          status: "empty",
        }),
        success: true,
        status: "completed",
        durationMs: Date.now() - startedAt,
        approvedBy,
      };
    }

    return {
      toolName: toolCall.name,
      result: typeof result === "string" ? result : JSON.stringify(result),
      success: true,
      status: "completed",
      durationMs: Date.now() - startedAt,
      approvedBy,
    };
  } catch (error) {
    // Log actionable error with args for debugging schema mismatches
    const errorMsg = err2String(error);
    const isSchemaError = errorMsg.includes("schema");
    if (isSchemaError) {
      logError(
        `[ToolCall] Schema validation failed for "${toolCall.name}". Args: ${JSON.stringify(toolCall.args, null, 2)}`
      );
    } else {
      logError(`[ToolCall] Error executing "${toolCall.name}": ${errorMsg}`);
    }
    const durationMs = Date.now() - startedAt;
    const status = errorMsg.includes("timed out") ? "timeout" : "failed";
    return {
      toolName: toolCall.name,
      result: formatToolResult(toolCall.name, `Error: ${errorMsg}`, "error"),
      success: false,
      status,
      durationMs,
    };
  }
}

/**
 * Get display name for tool (user-friendly version)
 */
export function getToolDisplayName(toolName: string): string {
  // Special handling for localSearch to show the actual search type being used
  if (toolName === "localSearch") {
    const settings = getSettings();
    return settings.enableSemanticSearchV3
      ? "vault search (semantic)"
      : "vault search (index-free)";
  }

  const displayNameMap: Record<string, string> = {
    webSearch: "web search",
    getFileTree: "file tree",
    getCurrentTime: "current time",
    getTimeRangeMs: "time range",
    getTimeInfoByEpoch: "time info",
    convertTimeBetweenTimezones: "timezone converter",
    startPomodoro: "pomodoro timer",
    pomodoroTool: "pomodoro timer",
    youtubeTranscription: "YouTube transcription",
    indexVault: "vault indexing",
    indexTool: "index",
    writeFile: "file editor",
    editFile: "file editor",
    obsidianDailyNote: "daily note (CLI)",
    obsidianRandomRead: "random note (CLI)",
    obsidianProperties: "properties (CLI)",
    obsidianTasks: "tasks (CLI)",
    obsidianLinks: "links (CLI)",
    obsidianTemplates: "templates (CLI)",
    obsidianBases: "bases (CLI)",
  };

  return displayNameMap[toolName] || toolName;
}

/**
 * Get emoji for tool display
 */
export function getToolEmoji(toolName: string): string {
  const emojiMap: Record<string, string> = {
    localSearch: "🔍",
    webSearch: "🌐",
    getFileTree: "📁",
    getCurrentTime: "🕒",
    getTimeRangeMs: "📅",
    getTimeInfoByEpoch: "🕰️",
    convertTimeBetweenTimezones: "🌍",
    youtubeTranscription: "📺",
    indexVault: "📚",
    indexTool: "📚",
    writeFile: "✏️",
    editFile: "🔄",
    readNote: "🔍",
    obsidianDailyNote: "📅",
    obsidianRandomRead: "🎲",
    obsidianProperties: "🏷️",
    obsidianTasks: "✅",
    obsidianLinks: "🔗",
    obsidianTemplates: "📄",
    obsidianBases: "🗄️",
  };

  return emojiMap[toolName] || "🔧";
}

/**
 * Get user confirmation message for tool call
 */
export function getToolConfirmtionMessage(toolName: string, toolArgs?: any): string | null {
  if (toolName == "writeFile" || toolName == "editFile") {
    return "Accept / reject in the Preview";
  }

  // Display salient terms for lexical search
  if (toolName === "localSearch" && toolArgs?.salientTerms) {
    const settings = getSettings();
    // Only show salient terms for lexical search (index-free)
    if (!settings.enableSemanticSearchV3) {
      const terms = Array.isArray(toolArgs.salientTerms) ? toolArgs.salientTerms : [];
      if (terms.length > 0) {
        return `Terms: ${terms.slice(0, 3).join(", ")}${terms.length > 3 ? "..." : ""}`;
      }
    }
  }

  return null;
}

/**
 * Log tool call details for debugging
 */
export function logToolCall(toolCall: ToolCall, iteration: number): void {
  const displayName = getToolDisplayName(toolCall.name);
  const emoji = getToolEmoji(toolCall.name);

  // Create clean parameter display
  const paramDisplay =
    Object.keys(toolCall.args).length > 0
      ? JSON.stringify(toolCall.args, null, 2)
      : "(no parameters)";

  logInfo(`${emoji} [Iteration ${iteration}] ${displayName.toUpperCase()}`);
  logInfo(`Parameters:`, paramDisplay);
  logInfo("---");
}

/**
 * Log tool execution result
 */
export function logToolResult(toolName: string, result: ToolExecutionResult): void {
  // For localSearch we already emit a structured table elsewhere; avoid redundant logs entirely
  if (toolName === "localSearch") {
    return;
  }

  const displayName = getToolDisplayName(toolName);
  const emoji = getToolEmoji(toolName);
  const status = result.success ? "✅ SUCCESS" : "❌ FAILED";

  logInfo(`${emoji} ${displayName.toUpperCase()} RESULT: ${status}`);

  // Default: log abbreviated result for readability (cap at 300 chars)
  const maxLogLength = 300;
  const text = String(result.result ?? "");
  if (text.length > maxLogLength) {
    logInfo(
      `Result: ${text.substring(0, maxLogLength)}... (truncated, ${text.length} chars total)`
    );
  } else if (text.length > 0) {
    logInfo(`Result:`, text);
  }
}

/**
 * Deduplicate sources by path, keeping highest score
 * If path is not available, falls back to title
 */
export function deduplicateSources(
  sources: { title: string; path: string; score: number; explanation?: any }[]
): { title: string; path: string; score: number; explanation?: any }[] {
  const uniqueSources = new Map<
    string,
    { title: string; path: string; score: number; explanation?: any }
  >();

  for (const source of sources) {
    // Use path as the unique key, falling back to title if path is not available
    const key = source.path || source.title;
    const existing = uniqueSources.get(key);
    if (!existing || source.score > existing.score) {
      uniqueSources.set(key, source);
    }
  }

  return Array.from(uniqueSources.values()).sort((a, b) => b.score - a.score);
}
