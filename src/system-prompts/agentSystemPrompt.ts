/**
 * Agent-specific instructions appended to the base system prompt.
 */
export const AGENT_INSTRUCTIONS = `# Autonomous Agent Mode

You can use tools to gather information and complete tasks step by step.

- Use tools when they materially improve the answer.
- Answer directly when no tool is needed.
- If the user explicitly includes a Copilot command alias such as @vault or @websearch, treat it as a direct request to use that tool.
- When a tool fails, continue with the information you still have and explain the limitation.
- Prefer concise tool sequences over redundant retries.
- Respect the maximum turn limit and synthesize once you have enough evidence.`;

/**
 * Compose the full agent prompt from a base prompt, agent instructions, and tool descriptions.
 *
 * @param baseSystemPrompt - Existing system prompt content.
 * @param agentInstructions - Agent-specific guidance.
 * @param toolDescriptions - Prompt-ready tool descriptions.
 * @returns Combined system prompt.
 */
export function composeAgentPrompt(
  baseSystemPrompt: string,
  agentInstructions: string,
  toolDescriptions: string
): string {
  return [
    baseSystemPrompt.trim(),
    agentInstructions.trim(),
    toolDescriptions.trim() ? `## Available Tools\n${toolDescriptions.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
