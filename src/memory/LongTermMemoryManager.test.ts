jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(),
}));

import { LongTermMemoryManager } from "./LongTermMemoryManager";
import { MemoryStore } from "./MemoryStore";
import { Memory } from "@/memory/longTermMemoryTypes";
import { ChatMessage } from "@/types/message";
import { logError, logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";

// Mock file system for MemoryStore
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

(global as any).app = {
  vault: {
    adapter: mockAdapter,
    getAbstractFileByPath: jest.fn(),
  },
};

/** Create a mock Embeddings instance */
function createMockEmbeddings(): jest.Mocked<Embeddings> {
  const mock = {
    embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedDocuments: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    caller: {},
    model: "test-embedding-model",
  } as any;
  return mock;
}

/** Create a mock ChatModel that returns a valid extraction response */
function createMockChatModel(responseContent: string): jest.Mocked<BaseChatModel> {
  return {
    invoke: jest.fn().mockResolvedValue(new AIMessage(responseContent)),
  } as any;
}

/** Helper to create test messages */
function msg(sender: string, message: string): ChatMessage {
  return { sender, message, isVisible: true, timestamp: null };
}

describe("LongTermMemoryManager", () => {
  let manager: LongTermMemoryManager;
  let store: MemoryStore;
  let mockEmbeddings: jest.Mocked<Embeddings>;
  let mockSettings: any;

  beforeEach(() => {
    jest.clearAllMocks();
    fileSystem = {};

    mockSettings = {
      enableLongTermMemory: true,
      maxLongTermMemories: 5000,
      maxMemoriesRetrieved: 10,
      memoryDeduplicationThreshold: 0.85,
      memoryFolderName: "copilot/memory",
    };
    (getSettings as jest.Mock).mockReturnValue(mockSettings);

    mockEmbeddings = createMockEmbeddings();
    store = new MemoryStore("copilot/memory");
    manager = new LongTermMemoryManager(
      store,
      async () => mockEmbeddings,
      () => "test-embedding-model"
    );
  });

  describe("extractAndStore", () => {
    it("should extract memories and store them", async () => {
      const llmResponse = JSON.stringify([
        {
          content: "User lives in Berlin",
          category: "fact",
          isUpdate: false,
          updatedMemoryId: null,
        },
      ]);
      const chatModel = createMockChatModel(llmResponse);

      await manager.extractAndStore(
        [msg("user", "I live in Berlin"), msg("AI", "Cool!")],
        chatModel
      );

      // Should have invoked the LLM
      expect(chatModel.invoke).toHaveBeenCalledTimes(1);
      // Should have embedded the extracted fact
      expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith("User lives in Berlin");
      // Should have written to the store
      expect(fileSystem["copilot/memory/memories.jsonl"]).toBeDefined();
      expect(fileSystem["copilot/memory/memories.jsonl"]).toContain("User lives in Berlin");
    });

    it("should skip extraction when feature is disabled", async () => {
      mockSettings.enableLongTermMemory = false;
      const chatModel = createMockChatModel("[]");

      await manager.extractAndStore([msg("user", "test")], chatModel);

      expect(chatModel.invoke).not.toHaveBeenCalled();
    });

    it("should skip extraction for empty messages", async () => {
      const chatModel = createMockChatModel("[]");

      await manager.extractAndStore([], chatModel);

      expect(chatModel.invoke).not.toHaveBeenCalled();
    });

    it("should handle LLM returning no memories", async () => {
      const chatModel = createMockChatModel("[]");

      await manager.extractAndStore([msg("user", "hello")], chatModel);

      expect(chatModel.invoke).toHaveBeenCalled();
      expect(logInfo).toHaveBeenCalledWith("[LTM] No memories extracted from conversation");
      // No files should be written
      expect(fileSystem["copilot/memory/memories.jsonl"]).toBeUndefined();
    });

    it("should filter sensitive content before extraction", async () => {
      const chatModel = createMockChatModel("[]");

      await manager.extractAndStore(
        [msg("user", 'My api_key = "sk-1234567890abcdef1234567890"')],
        chatModel
      );

      // LLM should receive filtered text
      const invokeArgs = chatModel.invoke.mock.calls[0][0];
      const userPromptContent = invokeArgs[1].content;
      expect(userPromptContent).toContain("[REDACTED]");
      expect(userPromptContent).not.toContain("sk-1234567890abcdef1234567890");
    });

    it("should handle multiple extracted memories", async () => {
      const llmResponse = JSON.stringify([
        {
          content: "User lives in Berlin",
          category: "fact",
          isUpdate: false,
          updatedMemoryId: null,
        },
        {
          content: "User prefers TypeScript",
          category: "preference",
          isUpdate: false,
          updatedMemoryId: null,
        },
      ]);
      const chatModel = createMockChatModel(llmResponse);

      await manager.extractAndStore([msg("user", "test")], chatModel);

      expect(mockEmbeddings.embedQuery).toHaveBeenCalledTimes(2);
      const memories = await store.loadMemories();
      expect(memories).toHaveLength(2);
    });

    it("should log errors without throwing (fire-and-forget)", async () => {
      const chatModel = createMockChatModel("");
      chatModel.invoke = jest.fn().mockRejectedValue(new Error("LLM error"));

      // Should NOT throw
      await manager.extractAndStore([msg("user", "test")], chatModel);

      expect(logError).toHaveBeenCalledWith("[LTM] Error in extractAndStore:", expect.any(Error));
    });

    it("should handle update to existing memory", async () => {
      // Pre-populate store with an existing memory
      const existingMemory: Memory = {
        id: "existing-1",
        content: "User lives in Berlin",
        category: "fact",
        projectTag: null,
        createdAt: 1000,
        updatedAt: 1000,
        lastAccessedAt: 1000,
        accessCount: 0,
        sensitive: false,
        deleted: false,
        source: { type: "auto", conversationSnippet: "test" },
      };
      fileSystem["copilot/memory/memories.jsonl"] = JSON.stringify(existingMemory) + "\n";
      fileSystem["copilot/memory/embeddings.jsonl"] =
        '{"_type":"header","version":1,"model":"test-embedding-model","dimension":3,"createdAt":1}\n' +
        '{"memoryId":"existing-1","vector":[0.1,0.2,0.3],"createdAt":1}\n';

      const llmResponse = JSON.stringify([
        {
          content: "User moved to Munich",
          category: "fact",
          isUpdate: true,
          updatedMemoryId: "existing-1",
        },
      ]);
      const chatModel = createMockChatModel(llmResponse);
      // The dedup flow calls chatModel a second time for merge — return merged text
      let callCount = 0;
      chatModel.invoke = jest.fn().mockImplementation(() => {
        callCount++;
        // First call: extraction response; subsequent calls: merge result
        const content = callCount === 1 ? llmResponse : "User moved to Munich";
        return Promise.resolve({ content });
      });

      await manager.extractAndStore([msg("user", "I moved to Munich")], chatModel);

      // Should have rewritten the store via save()
      const memories = await store.loadMemories();
      expect(memories).toHaveLength(1);
      expect(memories[0].content).toBe("User moved to Munich");
    });
  });
});
