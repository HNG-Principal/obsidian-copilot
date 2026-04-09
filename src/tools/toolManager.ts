import { initializeBuiltinTools } from "@/tools/builtinTools";
import { logWarn } from "@/logger";
import { ToolRegistry } from "@/tools/ToolRegistry";

export const getToolDescription = (tool: string): string => {
  const registry = ToolRegistry.getInstance();

  if (registry.getAllTools().length === 0) {
    initializeBuiltinTools(app?.vault);
  }

  const mapping = registry.getCopilotCommandMappings().get(tool.toLowerCase());

  if (mapping) {
    return mapping.metadata.description;
  }

  return "";
};

export class ToolManager {
  /**
   * Call a tool with the given arguments.
   * Throws on error so caller can handle with proper context (args, tool name).
   */
  static async callTool(tool: any, args: any): Promise<any> {
    if (!tool) {
      throw new Error("Tool is undefined");
    }

    const result = await tool.call(args);

    if (result === undefined || result === null) {
      logWarn(`[ToolCall] Tool "${tool.name}" returned null/undefined`);
      return null;
    }

    return result;
  }
}
