import { cosineSimilarity } from "@/memory/MemoryRetriever";
import { Memory, MemoryExtractionResult, LoadedEmbeddings } from "@/memory/longTermMemoryTypes";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";

interface DuplicateCandidate {
  existingMemory: Memory;
  similarity: number;
}

interface DeduplicationResult {
  toInsert: MemoryExtractionResult[];
  toUpdate: Array<{ existingId: string; mergedContent: string }>;
}

/**
 * Find existing memories that are similar enough to be considered duplicates.
 * Returns candidates above the similarity threshold, sorted by similarity descending.
 */
export function findDuplicateCandidates(
  existingEmbeddings: LoadedEmbeddings,
  newEmbedding: number[],
  existingMemories: Memory[],
  threshold: number
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (const memory of existingMemories) {
    const existingVec = existingEmbeddings.vectors.get(memory.id);
    if (!existingVec) continue;

    const similarity = cosineSimilarity(existingVec, newEmbedding);
    if (similarity >= threshold) {
      candidates.push({ existingMemory: memory, similarity });
    }
  }

  return candidates.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Build a prompt for the LLM to merge two similar memories into one.
 */
export function buildMergePrompt(existingContent: string, newContent: string): string {
  return [
    "You are merging two similar memories into one concise, accurate memory.",
    "Combine the information from both, keeping all unique details.",
    "Return ONLY the merged memory text, nothing else.",
    "",
    `Existing memory: ${existingContent}`,
    `New memory: ${newContent}`,
    "",
    "Merged memory:",
  ].join("\n");
}

/**
 * Use LLM to merge an existing memory with a new extracted memory.
 * Returns the merged content string.
 */
export async function mergeMemories(
  existingContent: string,
  newContent: string,
  chatModel: BaseChatModel
): Promise<string> {
  const prompt = buildMergePrompt(existingContent, newContent);
  const response = await chatModel.invoke([new HumanMessage(prompt)]);
  const content =
    typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((c) => (typeof c === "string" ? c : "text" in c ? c.text : ""))
            .join("")
        : String(response.content);
  return content.trim();
}

/**
 * Orchestrate deduplication for a batch of extracted memories.
 * For each extracted memory:
 *   1. Find duplicate candidates via cosine similarity
 *   2. If top candidate exceeds threshold, use LLM to merge
 *   3. Otherwise, mark as new insertion
 *
 * Returns { toInsert, toUpdate } arrays.
 */
export async function deduplicateMemories(
  extractedMemories: MemoryExtractionResult[],
  extractedEmbeddings: number[][],
  existingMemories: Memory[],
  existingEmbeddings: LoadedEmbeddings,
  threshold: number,
  chatModel: BaseChatModel
): Promise<DeduplicationResult> {
  const toInsert: MemoryExtractionResult[] = [];
  const toUpdate: Array<{ existingId: string; mergedContent: string }> = [];

  for (let i = 0; i < extractedMemories.length; i++) {
    const extracted = extractedMemories[i];
    const embedding = extractedEmbeddings[i];

    const candidates = findDuplicateCandidates(
      existingEmbeddings,
      embedding,
      existingMemories,
      threshold
    );

    if (candidates.length > 0) {
      const topCandidate = candidates[0];
      const mergedContent = await mergeMemories(
        topCandidate.existingMemory.content,
        extracted.content,
        chatModel
      );
      toUpdate.push({
        existingId: topCandidate.existingMemory.id,
        mergedContent,
      });
    } else {
      toInsert.push(extracted);
    }
  }

  return { toInsert, toUpdate };
}
