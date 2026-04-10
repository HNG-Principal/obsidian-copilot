jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(),
}));

import { MemoryStore } from "./MemoryStore";
import { Memory } from "@/memory/longTermMemoryTypes";
import { logWarn } from "@/logger";
import { ensureFolderExists } from "@/utils";

// In-memory file system mock
let fileSystem: Record<string, string>;

const mockAdapter = {
  exists: jest.fn(async (path: string) => path in fileSystem),
  read: jest.fn(async (path: string) => {
    if (!(path in fileSystem)) throw new Error(`File not found: ${path}`);
    return fileSystem[path];
  }),
  write: jest.fn(async (path: string, content: string) => {
    fileSystem[path] = content;
  }),
  mkdir: jest.fn(),
};

// Mock global app
(global as any).app = {
  vault: {
    adapter: mockAdapter,
    getAbstractFileByPath: jest.fn(),
  },
};

/** Helper to create a test Memory object */
function createTestMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "test-id-1",
    content: "Test memory content",
    category: "fact",
    projectTag: null,
    createdAt: 1712678400000,
    updatedAt: 1712678400000,
    lastAccessedAt: 1712678400000,
    accessCount: 0,
    sensitive: false,
    deleted: false,
    source: { type: "auto", conversationSnippet: "test snippet" },
    ...overrides,
  };
}

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    jest.clearAllMocks();
    fileSystem = {};
    store = new MemoryStore("copilot/memory");
  });

  describe("ensureDirectory", () => {
    it("should call ensureFolderExists with the base path", async () => {
      await store.ensureDirectory();
      expect(ensureFolderExists).toHaveBeenCalledWith("copilot/memory");
    });
  });

  describe("exists", () => {
    it("should return false when files don't exist", async () => {
      expect(await store.exists()).toBe(false);
    });

    it("should return true when both files exist", async () => {
      fileSystem["copilot/memory/memories.jsonl"] = "";
      fileSystem["copilot/memory/embeddings.jsonl"] = "";
      expect(await store.exists()).toBe(true);
    });

    it("should return false when only one file exists", async () => {
      fileSystem["copilot/memory/memories.jsonl"] = "";
      expect(await store.exists()).toBe(false);
    });
  });

  describe("loadMemories", () => {
    it("should return empty array when file doesn't exist", async () => {
      const result = await store.loadMemories();
      expect(result).toEqual([]);
    });

    it("should parse valid JSONL lines", async () => {
      const memory1 = createTestMemory({ id: "id-1", content: "Fact one" });
      const memory2 = createTestMemory({ id: "id-2", content: "Fact two" });
      fileSystem["copilot/memory/memories.jsonl"] =
        JSON.stringify(memory1) + "\n" + JSON.stringify(memory2) + "\n";

      const result = await store.loadMemories();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("id-1");
      expect(result[1].id).toBe("id-2");
    });

    it("should filter out deleted tombstones", async () => {
      const active = createTestMemory({ id: "active", deleted: false });
      const deleted = createTestMemory({ id: "deleted", deleted: true });
      fileSystem["copilot/memory/memories.jsonl"] =
        JSON.stringify(active) + "\n" + JSON.stringify(deleted) + "\n";

      const result = await store.loadMemories();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("active");
    });

    it("should skip malformed JSON lines gracefully", async () => {
      const valid = createTestMemory({ id: "valid" });
      fileSystem["copilot/memory/memories.jsonl"] =
        JSON.stringify(valid) + "\n" + "not valid json\n" + "{broken: true\n";

      const result = await store.loadMemories();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("valid");
      expect(logWarn).toHaveBeenCalledTimes(2);
    });

    it("should handle empty file", async () => {
      fileSystem["copilot/memory/memories.jsonl"] = "";
      const result = await store.loadMemories();
      expect(result).toEqual([]);
    });
  });

  describe("loadEmbeddings", () => {
    it("should return empty when file doesn't exist", async () => {
      const result = await store.loadEmbeddings();
      expect(result.model).toBe("");
      expect(result.dimension).toBe(0);
      expect(result.vectors.size).toBe(0);
    });

    it("should parse header and embedding records", async () => {
      const header =
        '{"_type":"header","version":1,"model":"text-embedding-3-small","dimension":3,"createdAt":1712678400000}';
      const embedding = '{"memoryId":"id-1","vector":[0.1,0.2,0.3],"createdAt":1712678400000}';
      fileSystem["copilot/memory/embeddings.jsonl"] = header + "\n" + embedding + "\n";

      const result = await store.loadEmbeddings();
      expect(result.model).toBe("text-embedding-3-small");
      expect(result.dimension).toBe(3);
      expect(result.vectors.size).toBe(1);
      expect(result.vectors.get("id-1")).toEqual([0.1, 0.2, 0.3]);
    });

    it("should handle model mismatch detection (returns loaded model)", async () => {
      const header =
        '{"_type":"header","version":1,"model":"old-model","dimension":3,"createdAt":1712678400000}';
      fileSystem["copilot/memory/embeddings.jsonl"] = header + "\n";

      const result = await store.loadEmbeddings();
      expect(result.model).toBe("old-model");
    });

    it("should skip malformed lines in embeddings", async () => {
      const header =
        '{"_type":"header","version":1,"model":"m","dimension":3,"createdAt":1712678400000}';
      const valid = '{"memoryId":"id-1","vector":[0.1,0.2,0.3],"createdAt":1712678400000}';
      fileSystem["copilot/memory/embeddings.jsonl"] = header + "\n" + "bad line\n" + valid + "\n";

      const result = await store.loadEmbeddings();
      expect(result.vectors.size).toBe(1);
      expect(logWarn).toHaveBeenCalledTimes(1);
    });
  });

  describe("appendMemory", () => {
    it("should create files on first append", async () => {
      const memory = createTestMemory({ id: "new-1" });
      await store.appendMemory(memory, [0.1, 0.2, 0.3], "text-embedding-3-small");

      expect(ensureFolderExists).toHaveBeenCalled();
      expect(fileSystem["copilot/memory/memories.jsonl"]).toContain('"id":"new-1"');
      expect(fileSystem["copilot/memory/embeddings.jsonl"]).toContain('"_type":"header"');
      expect(fileSystem["copilot/memory/embeddings.jsonl"]).toContain('"memoryId":"new-1"');
    });

    it("should append to existing files", async () => {
      const memory1 = createTestMemory({ id: "m-1" });
      fileSystem["copilot/memory/memories.jsonl"] = JSON.stringify(memory1) + "\n";
      fileSystem["copilot/memory/embeddings.jsonl"] =
        '{"_type":"header","version":1,"model":"m","dimension":3,"createdAt":1}\n' +
        '{"memoryId":"m-1","vector":[0.1,0.2,0.3],"createdAt":1}\n';

      const memory2 = createTestMemory({ id: "m-2" });
      await store.appendMemory(memory2, [0.4, 0.5, 0.6], "m");

      const memoriesContent = fileSystem["copilot/memory/memories.jsonl"];
      expect(memoriesContent).toContain('"id":"m-1"');
      expect(memoriesContent).toContain('"id":"m-2"');

      const embeddingsContent = fileSystem["copilot/memory/embeddings.jsonl"];
      expect(embeddingsContent).toContain('"memoryId":"m-1"');
      expect(embeddingsContent).toContain('"memoryId":"m-2"');
    });

    it("should round-trip: append then load", async () => {
      const memory = createTestMemory({ id: "roundtrip", content: "Hello world" });
      await store.appendMemory(memory, [1.0, 2.0], "test-model");

      const memories = await store.loadMemories();
      expect(memories).toHaveLength(1);
      expect(memories[0].id).toBe("roundtrip");
      expect(memories[0].content).toBe("Hello world");

      const embeddings = await store.loadEmbeddings();
      expect(embeddings.model).toBe("test-model");
      expect(embeddings.vectors.get("roundtrip")).toEqual([1.0, 2.0]);
    });
  });

  describe("save (compaction / bulk rewrite)", () => {
    it("should rewrite both files completely", async () => {
      // Pre-populate with stale data
      fileSystem["copilot/memory/memories.jsonl"] = '{"id":"old","deleted":true}\n';
      fileSystem["copilot/memory/embeddings.jsonl"] =
        '{"_type":"header","version":1,"model":"old","dimension":1,"createdAt":1}\n';

      const memories = [createTestMemory({ id: "kept-1" }), createTestMemory({ id: "kept-2" })];
      const embeddings = new Map<string, number[]>([
        ["kept-1", [0.1]],
        ["kept-2", [0.2]],
      ]);

      await store.save(memories, embeddings, "new-model");

      // Verify memories file only has the new data
      const loadedMemories = await store.loadMemories();
      expect(loadedMemories).toHaveLength(2);
      expect(loadedMemories.find((m) => m.id === "old")).toBeUndefined();

      // Verify embeddings file has new header and data
      const loadedEmbeddings = await store.loadEmbeddings();
      expect(loadedEmbeddings.model).toBe("new-model");
      expect(loadedEmbeddings.vectors.size).toBe(2);
    });

    it("should handle empty save (clear store)", async () => {
      fileSystem["copilot/memory/memories.jsonl"] = '{"id":"old"}\n';

      await store.save([], new Map(), "model");

      const memories = await store.loadMemories();
      expect(memories).toHaveLength(0);
    });
  });
});
