import { Memory, MemoryRetrievalResult, LoadedEmbeddings } from "@/memory/longTermMemoryTypes";

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Retrieve the most relevant memories for a given query embedding.
 * Pure function: compute cosine similarity, filter, rank, and return top-N results.
 */
export function retrieveRelevantMemories(
  query: string,
  allMemories: Memory[],
  allEmbeddings: LoadedEmbeddings,
  queryEmbedding: number[],
  maxResults: number,
  scoreThreshold = 0.3
): MemoryRetrievalResult[] {
  if (allMemories.length === 0 || allEmbeddings.vectors.size === 0) return [];

  const scored: MemoryRetrievalResult[] = [];

  for (const memory of allMemories) {
    // Skip deleted or sensitive memories
    if (memory.deleted || memory.sensitive) continue;

    const vector = allEmbeddings.vectors.get(memory.id);
    if (!vector) continue;

    const similarity = cosineSimilarity(queryEmbedding, vector);
    if (similarity >= scoreThreshold) {
      scored.push({ memory, similarityScore: similarity, rank: 0 });
    }
  }

  // Sort descending by similarity
  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  // Assign ranks and return top-N
  return scored.slice(0, maxResults).map((r, i) => ({ ...r, rank: i + 1 }));
}
