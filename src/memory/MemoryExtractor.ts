/**
 * Pure function module for building memory extraction prompts and parsing LLM responses.
 * No side effects — all I/O is handled by the caller (LongTermMemoryManager).
 */

import { Memory, MemoryCategory, MemoryExtractionResult } from "@/memory/longTermMemoryTypes";
import { ChatMessage } from "@/types/message";

const VALID_CATEGORIES: MemoryCategory[] = [
  "fact",
  "preference",
  "event",
  "relationship",
  "goal",
  "skill",
  "context",
];

/**
 * Build the extraction prompt for the LLM to extract memorable facts from a conversation.
 *
 * @param messages - Recent conversation messages to extract from
 * @param existingMemories - Current stored memories for deduplication hints
 * @returns System and user prompts for the LLM call
 */
export function buildExtractionPrompt(
  messages: ChatMessage[],
  existingMemories: Memory[]
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a memory extraction assistant. Your task is to extract important facts, preferences, events, relationships, goals, skills, and context from conversations.

Rules:
- Extract only genuinely memorable, long-term relevant information
- Do NOT extract trivial, temporary, or conversational filler
- Each extracted memory should be a concise, self-contained statement
- If a fact updates an existing memory, mark it as an update with the memory ID
- Categorize each memory as one of: fact, preference, event, relationship, goal, skill, context

Respond ONLY with a JSON array. Each element must have:
- "content": string — the extracted fact as a concise statement
- "category": string — one of: fact, preference, event, relationship, goal, skill, context
- "isUpdate": boolean — true if this updates an existing memory
- "updatedMemoryId": string | null — ID of the memory being updated, or null

If there is nothing worth extracting, respond with an empty array: []`;

  const conversationText = messages
    .filter((m) => m.isVisible !== false)
    .map((m) => `${m.sender}: ${m.message}`)
    .join("\n");

  let existingMemoriesHint = "";
  if (existingMemories.length > 0) {
    const memoryList = existingMemories
      .slice(-50) // Only include recent memories to keep prompt size manageable
      .map((m) => `[${m.id}] (${m.category}) ${m.content}`)
      .join("\n");
    existingMemoriesHint = `\n\nExisting memories (for deduplication — mark isUpdate=true if a new fact updates one of these):\n${memoryList}`;
  }

  const userPrompt = `Extract memorable facts from this conversation:

${conversationText}${existingMemoriesHint}`;

  return { systemPrompt, userPrompt };
}

/**
 * Parse the LLM's extraction response into structured MemoryExtractionResult entries.
 * Handles valid JSON arrays, malformed output, and empty responses gracefully.
 *
 * @param llmResponse - Raw LLM response text (expected: JSON array)
 * @returns Array of parsed extraction results (empty array on parse failure)
 */
export function parseExtractionResponse(llmResponse: string): MemoryExtractionResult[] {
  if (!llmResponse || llmResponse.trim().length === 0) {
    return [];
  }

  // Extract JSON array from response (LLM may wrap it in markdown code blocks)
  const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  let parsed: unknown[];
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const results: MemoryExtractionResult[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;

    const record = item as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!content) continue;

    const rawCategory = typeof record.category === "string" ? record.category.toLowerCase() : "";
    const category: MemoryCategory = VALID_CATEGORIES.includes(rawCategory as MemoryCategory)
      ? (rawCategory as MemoryCategory)
      : "fact";

    const isUpdate = record.isUpdate === true;
    const updatedMemoryId =
      isUpdate && typeof record.updatedMemoryId === "string" ? record.updatedMemoryId : null;

    results.push({ content, category, isUpdate, updatedMemoryId });
  }

  return results;
}
