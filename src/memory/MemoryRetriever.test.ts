import { cosineSimilarity, retrieveRelevantMemories } from "./MemoryRetriever";
import { Memory, LoadedEmbeddings } from "@/memory/longTermMemoryTypes";

/** Helper to create a test memory */
function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "m-1",
    content: "test memory",
    category: "fact",
    projectTag: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastAccessedAt: Date.now(),
    accessCount: 0,
    sensitive: false,
    deleted: false,
    source: { type: "auto", conversationSnippet: "test" },
    ...overrides,
  };
}

/** Helper to create embeddings with a vectors Map */
function makeEmbeddings(entries: [string, number[]][]): LoadedEmbeddings {
  return {
    model: "test",
    dimension: 3,
    vectors: new Map(entries),
  };
}

describe("cosineSimilarity", () => {
  it("should return 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("should return 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("should return -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
  });

  it("should handle non-unit vectors", () => {
    expect(cosineSimilarity([2, 0], [4, 0])).toBeCloseTo(1);
  });

  it("should return 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("should return 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("should return 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("retrieveRelevantMemories", () => {
  const emptyEmbeddings = makeEmbeddings([]);

  it("should return empty array for empty store", () => {
    const result = retrieveRelevantMemories("query", [], emptyEmbeddings, [1, 0, 0], 5);
    expect(result).toEqual([]);
  });

  it("should return empty array when no embeddings exist", () => {
    const memories = [makeMemory({ id: "m-1" })];
    const result = retrieveRelevantMemories("query", memories, emptyEmbeddings, [1, 0, 0], 5);
    expect(result).toEqual([]);
  });

  it("should rank by similarity score descending", () => {
    const memories = [
      makeMemory({ id: "m-1", content: "low match" }),
      makeMemory({ id: "m-2", content: "high match" }),
      makeMemory({ id: "m-3", content: "medium match" }),
    ];
    const embeddings = makeEmbeddings([
      ["m-1", [0.6, 0.8, 0]],
      ["m-2", [0.99, 0.1, 0]],
      ["m-3", [0.8, 0.6, 0]],
    ]);

    const result = retrieveRelevantMemories("query", memories, embeddings, [1, 0, 0], 5);
    expect(result.length).toBe(3);
    expect(result[0].memory.id).toBe("m-2");
    expect(result[1].memory.id).toBe("m-3");
    expect(result[2].memory.id).toBe("m-1");
  });

  it("should assign 1-based ranks", () => {
    const memories = [makeMemory({ id: "m-1" }), makeMemory({ id: "m-2" })];
    const embeddings = makeEmbeddings([
      ["m-1", [1, 0, 0]],
      ["m-2", [0.9, 0.1, 0]],
    ]);

    const result = retrieveRelevantMemories("query", memories, embeddings, [1, 0, 0], 5);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });

  it("should respect maxResults limit", () => {
    const memories = [
      makeMemory({ id: "m-1" }),
      makeMemory({ id: "m-2" }),
      makeMemory({ id: "m-3" }),
    ];
    const embeddings = makeEmbeddings([
      ["m-1", [1, 0, 0]],
      ["m-2", [0.9, 0.1, 0]],
      ["m-3", [0.8, 0.2, 0]],
    ]);

    const result = retrieveRelevantMemories("query", memories, embeddings, [1, 0, 0], 2);
    expect(result).toHaveLength(2);
  });

  it("should filter out deleted memories", () => {
    const memories = [makeMemory({ id: "m-1", deleted: true }), makeMemory({ id: "m-2" })];
    const embeddings = makeEmbeddings([
      ["m-1", [1, 0, 0]],
      ["m-2", [0.9, 0.1, 0]],
    ]);

    const result = retrieveRelevantMemories("query", memories, embeddings, [1, 0, 0], 5);
    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe("m-2");
  });

  it("should filter out sensitive memories", () => {
    const memories = [makeMemory({ id: "m-1", sensitive: true }), makeMemory({ id: "m-2" })];
    const embeddings = makeEmbeddings([
      ["m-1", [1, 0, 0]],
      ["m-2", [0.9, 0.1, 0]],
    ]);

    const result = retrieveRelevantMemories("query", memories, embeddings, [1, 0, 0], 5);
    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe("m-2");
  });

  it("should apply score threshold", () => {
    const memories = [
      makeMemory({ id: "m-1", content: "very close" }),
      makeMemory({ id: "m-2", content: "orthogonal" }),
    ];
    const embeddings = makeEmbeddings([
      ["m-1", [1, 0, 0]],
      ["m-2", [0, 1, 0]], // orthogonal = similarity 0
    ]);

    const result = retrieveRelevantMemories("query", memories, embeddings, [1, 0, 0], 5, 0.3);
    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe("m-1");
  });

  it("should skip memories without embeddings", () => {
    const memories = [makeMemory({ id: "m-1" }), makeMemory({ id: "m-2" })];
    const embeddings = makeEmbeddings([["m-1", [1, 0, 0]]]); // only m-1

    const result = retrieveRelevantMemories("query", memories, embeddings, [1, 0, 0], 5);
    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe("m-1");
  });

  it("should include similarity score in results", () => {
    const memories = [makeMemory({ id: "m-1" })];
    const embeddings = makeEmbeddings([["m-1", [1, 0, 0]]]);

    const result = retrieveRelevantMemories("query", memories, embeddings, [1, 0, 0], 5);
    expect(result[0].similarityScore).toBeCloseTo(1);
  });
});
