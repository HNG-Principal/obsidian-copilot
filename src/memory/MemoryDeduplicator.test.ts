import {
  findDuplicateCandidates,
  buildMergePrompt,
  mergeMemories,
  deduplicateMemories,
} from "@/memory/MemoryDeduplicator";
import { Memory, LoadedEmbeddings, MemoryExtractionResult } from "@/memory/longTermMemoryTypes";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    content: "User prefers dark mode",
    category: "preference",
    source: "conversation",
    createdAt: 1000,
    updatedAt: 1000,
    lastAccessedAt: 1000,
    accessCount: 1,
    sensitive: false,
    tags: [],
    conversationContext: "User said they like dark mode",
    ...overrides,
  };
}

function makeEmbeddings(entries: Record<string, number[]>): LoadedEmbeddings {
  return {
    model: "test-model",
    dimension: 3,
    vectors: new Map(Object.entries(entries)),
  };
}

function makeMockChatModel(response: string): BaseChatModel {
  return {
    invoke: jest.fn().mockResolvedValue({ content: response }),
  } as unknown as BaseChatModel;
}

describe("MemoryDeduplicator", () => {
  describe("findDuplicateCandidates", () => {
    it("should return candidates above the similarity threshold", () => {
      const memories = [
        makeMemory({ id: "m1" }),
        makeMemory({ id: "m2", content: "User likes vim" }),
      ];
      // m1 vector is very similar to the new vector; m2 is not
      const embeddings = makeEmbeddings({
        m1: [0.9, 0.1, 0.0],
        m2: [0.0, 0.1, 0.9],
      });
      const newVec = [0.95, 0.05, 0.0];

      const candidates = findDuplicateCandidates(embeddings, newVec, memories, 0.85);

      expect(candidates.length).toBe(1);
      expect(candidates[0].existingMemory.id).toBe("m1");
      expect(candidates[0].similarity).toBeGreaterThan(0.85);
    });

    it("should return empty array when no candidates exceed threshold", () => {
      const memories = [makeMemory({ id: "m1" })];
      const embeddings = makeEmbeddings({
        m1: [0.0, 0.0, 1.0],
      });
      const newVec = [1.0, 0.0, 0.0];

      const candidates = findDuplicateCandidates(embeddings, newVec, memories, 0.85);

      expect(candidates).toEqual([]);
    });

    it("should sort candidates by similarity descending", () => {
      const memories = [
        makeMemory({ id: "m1" }),
        makeMemory({ id: "m2" }),
        makeMemory({ id: "m3" }),
      ];
      const embeddings = makeEmbeddings({
        m1: [0.8, 0.2, 0.0],
        m2: [0.95, 0.05, 0.0],
        m3: [0.85, 0.15, 0.0],
      });
      const newVec = [1.0, 0.0, 0.0];

      const candidates = findDuplicateCandidates(embeddings, newVec, memories, 0.7);

      expect(candidates.length).toBe(3);
      expect(candidates[0].existingMemory.id).toBe("m2");
    });

    it("should skip memories without embeddings", () => {
      const memories = [makeMemory({ id: "m1" }), makeMemory({ id: "m2" })];
      const embeddings = makeEmbeddings({
        m1: [0.9, 0.1, 0.0],
        // m2 has no embedding
      });
      const newVec = [0.95, 0.05, 0.0];

      const candidates = findDuplicateCandidates(embeddings, newVec, memories, 0.85);

      expect(candidates.length).toBe(1);
      expect(candidates[0].existingMemory.id).toBe("m1");
    });

    it("should handle empty store", () => {
      const embeddings = makeEmbeddings({});
      const candidates = findDuplicateCandidates(embeddings, [1, 0, 0], [], 0.85);
      expect(candidates).toEqual([]);
    });
  });

  describe("buildMergePrompt", () => {
    it("should include both memory contents", () => {
      const prompt = buildMergePrompt("likes dark mode", "prefers dark theme");

      expect(prompt).toContain("likes dark mode");
      expect(prompt).toContain("prefers dark theme");
      expect(prompt).toContain("Merged memory:");
    });
  });

  describe("mergeMemories", () => {
    it("should return LLM merged content trimmed", async () => {
      const chatModel = makeMockChatModel("  User prefers dark mode and theme  ");

      const result = await mergeMemories("likes dark mode", "prefers dark theme", chatModel);

      expect(result).toBe("User prefers dark mode and theme");
    });

    it("should handle array content from LLM response", async () => {
      const chatModel = {
        invoke: jest.fn().mockResolvedValue({
          content: [{ text: "Merged result" }],
        }),
      } as unknown as BaseChatModel;

      const result = await mergeMemories("a", "b", chatModel);

      expect(result).toBe("Merged result");
    });
  });

  describe("deduplicateMemories", () => {
    it("should classify as toInsert when no duplicates found", async () => {
      const extracted: MemoryExtractionResult[] = [
        { content: "brand new fact", category: "fact", isUpdate: false, sensitive: false },
      ];
      const extractedEmbeddings = [[0.0, 0.0, 1.0]];
      const existingMemories = [makeMemory({ id: "m1" })];
      const existingEmb = makeEmbeddings({ m1: [1.0, 0.0, 0.0] });
      const chatModel = makeMockChatModel("merged");

      const result = await deduplicateMemories(
        extracted,
        extractedEmbeddings,
        existingMemories,
        existingEmb,
        0.85,
        chatModel
      );

      expect(result.toInsert).toHaveLength(1);
      expect(result.toInsert[0].content).toBe("brand new fact");
      expect(result.toUpdate).toHaveLength(0);
      expect(chatModel.invoke).not.toHaveBeenCalled();
    });

    it("should classify as toUpdate and merge when duplicate found", async () => {
      const extracted: MemoryExtractionResult[] = [
        {
          content: "prefers dark theme",
          category: "preference",
          isUpdate: false,
          sensitive: false,
        },
      ];
      const extractedEmbeddings = [[0.95, 0.05, 0.0]];
      const existingMemories = [makeMemory({ id: "m1", content: "likes dark mode" })];
      const existingEmb = makeEmbeddings({ m1: [0.9, 0.1, 0.0] });
      const chatModel = makeMockChatModel("User prefers dark mode/theme");

      const result = await deduplicateMemories(
        extracted,
        extractedEmbeddings,
        existingMemories,
        existingEmb,
        0.85,
        chatModel
      );

      expect(result.toInsert).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toUpdate[0].existingId).toBe("m1");
      expect(result.toUpdate[0].mergedContent).toBe("User prefers dark mode/theme");
    });

    it("should handle mixed insert and update", async () => {
      const extracted: MemoryExtractionResult[] = [
        { content: "similar to existing", category: "fact", isUpdate: false, sensitive: false },
        { content: "completely new", category: "context", isUpdate: false, sensitive: false },
      ];
      const extractedEmbeddings = [
        [0.95, 0.05, 0.0],
        [0.0, 0.0, 1.0],
      ];
      const existingMemories = [makeMemory({ id: "m1" })];
      const existingEmb = makeEmbeddings({ m1: [0.9, 0.1, 0.0] });
      const chatModel = makeMockChatModel("merged content");

      const result = await deduplicateMemories(
        extracted,
        extractedEmbeddings,
        existingMemories,
        existingEmb,
        0.85,
        chatModel
      );

      expect(result.toInsert).toHaveLength(1);
      expect(result.toInsert[0].content).toBe("completely new");
      expect(result.toUpdate).toHaveLength(1);
      expect(result.toUpdate[0].existingId).toBe("m1");
    });

    it("should handle empty extraction list", async () => {
      const chatModel = makeMockChatModel("");

      const result = await deduplicateMemories(
        [],
        [],
        [makeMemory()],
        makeEmbeddings({ "mem-1": [1, 0, 0] }),
        0.85,
        chatModel
      );

      expect(result.toInsert).toHaveLength(0);
      expect(result.toUpdate).toHaveLength(0);
    });
  });
});
