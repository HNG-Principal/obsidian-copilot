import { initializeBuiltinTools } from "@/tools/builtinTools";
import { ToolRegistry } from "@/tools/ToolRegistry";

/**
 * Return the set of registered @-tool aliases available in the chat UI.
 * Falls back to built-in registration when the registry has not been initialized yet.
 *
 * @returns Registered Copilot command aliases.
 */
export function getAvailableTools(): string[] {
  const registry = ToolRegistry.getInstance();

  if (registry.getAllTools().length === 0) {
    initializeBuiltinTools(app?.vault);
  }

  return Array.from(registry.getCopilotCommandMappings().keys()).sort();
}
