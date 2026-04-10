import { buildExtractionPrompt, parseExtractionResponse } from "./MemoryExtractor";
import { Memory } from "@/memory/longTermMemoryTypes";
import { ChatMessage } from "@/types/message";

/** Helper to create a minimal ChatMessage for testing */
function msg(sender: string, message: string): ChatMessage {
  return {
    sender,
    message,
    isVisible: true,
    timestamp: null,
  };
}

/** Helper to create a minimal Memory for testing */
function mem(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    content: "Test memory",
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

describe("MemoryExtractor", () => {
  describe("buildExtractionPrompt", () => {
    it("should include conversation messages in user prompt", () => {
      const messages = [
        msg("user", "I live in Berlin"),
        msg("AI", "That's nice! Berlin is a great city."),
      ];

      const { systemPrompt, userPrompt } = buildExtractionPrompt(messages, []);
      expect(systemPrompt).toContain("memory extraction");
      expect(userPrompt).toContain("user: I live in Berlin");
      expect(userPrompt).toContain("AI: That's nice!");
    });

    it("should not include hidden messages", () => {
      const messages = [msg("user", "visible"), { ...msg("system", "hidden"), isVisible: false }];

      const { userPrompt } = buildExtractionPrompt(messages, []);
      expect(userPrompt).toContain("visible");
      expect(userPrompt).not.toContain("hidden");
    });

    it("should include existing memories as deduplication hints", () => {
      const existing = [
        mem({ id: "id-1", content: "User lives in Berlin", category: "fact" }),
        mem({ id: "id-2", content: "User prefers dark mode", category: "preference" }),
      ];

      const { userPrompt } = buildExtractionPrompt([msg("user", "test")], existing);
      expect(userPrompt).toContain("[id-1] (fact) User lives in Berlin");
      expect(userPrompt).toContain("[id-2] (preference) User prefers dark mode");
      expect(userPrompt).toContain("deduplication");
    });

    it("should handle empty messages and memories", () => {
      const { systemPrompt, userPrompt } = buildExtractionPrompt([], []);
      expect(systemPrompt.length).toBeGreaterThan(0);
      expect(userPrompt).toBeDefined();
    });

    it("should list valid categories in system prompt", () => {
      const { systemPrompt } = buildExtractionPrompt([], []);
      expect(systemPrompt).toContain("fact");
      expect(systemPrompt).toContain("preference");
      expect(systemPrompt).toContain("event");
      expect(systemPrompt).toContain("relationship");
      expect(systemPrompt).toContain("goal");
      expect(systemPrompt).toContain("skill");
      expect(systemPrompt).toContain("context");
    });

    it("should limit existing memories to 50 for prompt size", () => {
      const manyMemories = Array.from({ length: 100 }, (_, i) =>
        mem({ id: `mem-${i}`, content: `Memory ${i}` })
      );

      const { userPrompt } = buildExtractionPrompt([msg("user", "test")], manyMemories);
      // Should include the last 50, not the first 50
      expect(userPrompt).toContain("mem-99");
      expect(userPrompt).not.toContain("[mem-0]");
    });
  });

  describe("parseExtractionResponse", () => {
    it("should parse valid JSON array response", () => {
      const response = JSON.stringify([
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

      const results = parseExtractionResponse(response);
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe("User lives in Berlin");
      expect(results[0].category).toBe("fact");
      expect(results[1].category).toBe("preference");
    });

    it("should handle update entries", () => {
      const response = JSON.stringify([
        {
          content: "User moved to Munich",
          category: "fact",
          isUpdate: true,
          updatedMemoryId: "mem-1",
        },
      ]);

      const results = parseExtractionResponse(response);
      expect(results).toHaveLength(1);
      expect(results[0].isUpdate).toBe(true);
      expect(results[0].updatedMemoryId).toBe("mem-1");
    });

    it("should handle empty array", () => {
      const results = parseExtractionResponse("[]");
      expect(results).toEqual([]);
    });

    it("should handle empty string", () => {
      const results = parseExtractionResponse("");
      expect(results).toEqual([]);
    });

    it("should handle null-like input", () => {
      const results = parseExtractionResponse("   ");
      expect(results).toEqual([]);
    });

    it("should handle completely invalid JSON", () => {
      const results = parseExtractionResponse("This is not JSON at all");
      expect(results).toEqual([]);
    });

    it("should extract JSON from markdown code blocks", () => {
      const response =
        '```json\n[{"content": "test fact", "category": "fact", "isUpdate": false, "updatedMemoryId": null}]\n```';

      const results = parseExtractionResponse(response);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("test fact");
    });

    it("should default to 'fact' for invalid categories", () => {
      const response = JSON.stringify([
        {
          content: "Something",
          category: "unknown_category",
          isUpdate: false,
          updatedMemoryId: null,
        },
      ]);

      const results = parseExtractionResponse(response);
      expect(results[0].category).toBe("fact");
    });

    it("should skip entries with empty content", () => {
      const response = JSON.stringify([
        { content: "", category: "fact", isUpdate: false, updatedMemoryId: null },
        { content: "Valid content", category: "fact", isUpdate: false, updatedMemoryId: null },
      ]);

      const results = parseExtractionResponse(response);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("Valid content");
    });

    it("should skip non-object entries", () => {
      const response = JSON.stringify([
        "just a string",
        null,
        42,
        { content: "Valid", category: "fact", isUpdate: false, updatedMemoryId: null },
      ]);

      const results = parseExtractionResponse(response);
      expect(results).toHaveLength(1);
    });

    it("should handle missing optional fields gracefully", () => {
      const response = JSON.stringify([{ content: "Minimal entry" }]);

      const results = parseExtractionResponse(response);
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe("fact"); // default
      expect(results[0].isUpdate).toBe(false);
      expect(results[0].updatedMemoryId).toBeNull();
    });

    it("should nullify updatedMemoryId when isUpdate is false", () => {
      const response = JSON.stringify([
        { content: "test", category: "fact", isUpdate: false, updatedMemoryId: "some-id" },
      ]);

      const results = parseExtractionResponse(response);
      expect(results[0].updatedMemoryId).toBeNull();
    });
  });
});
