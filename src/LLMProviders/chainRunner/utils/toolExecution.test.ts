import { executeSequentialToolCall } from "./toolExecution";
import { createLangChainTool } from "@/tools/createLangChainTool";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { z } from "zod";

// Mock dependencies
jest.mock("@/plusUtils", () => ({
  checkIsPlusUser: jest.fn(),
  isSelfHostModeValid: jest.fn().mockReturnValue(false),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/tools/toolManager", () => ({
  ToolManager: {
    callTool: jest.fn(),
  },
}));

import { checkIsPlusUser } from "@/plusUtils";
import { ToolManager } from "@/tools/toolManager";

describe("toolExecution", () => {
  const mockCheckIsPlusUser = checkIsPlusUser as jest.MockedFunction<typeof checkIsPlusUser>;
  const mockCallTool = ToolManager.callTool as jest.MockedFunction<typeof ToolManager.callTool>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the registry before each test
    ToolRegistry.getInstance().clear();
  });

  describe("executeSequentialToolCall", () => {
    it("should execute tools without isPlusOnly flag", async () => {
      const testTool = createLangChainTool({
        name: "testTool",
        description: "Test tool",
        schema: z.object({ input: z.string() }),
        func: async ({ input }) => `Result: ${input}`,
      });

      // Register tool without isPlusOnly
      ToolRegistry.getInstance().register({
        tool: testTool,
        metadata: {
          id: "testTool",
          displayName: "Test Tool",
          description: "Test tool",
          category: "custom",
        },
      });

      mockCallTool.mockResolvedValueOnce("Tool executed successfully");

      const result = await executeSequentialToolCall(
        { name: "testTool", args: { input: "test" } },
        [testTool]
      );

      expect(result).toMatchObject({
        toolName: "testTool",
        result: "Tool executed successfully",
        success: true,
        status: "completed",
        approvedBy: "auto",
      });
      expect(mockCheckIsPlusUser).not.toHaveBeenCalled();
    });

    it("should block plus-only tools for non-plus users", async () => {
      const plusTool = createLangChainTool({
        name: "plusTool",
        description: "Plus-only tool",
        schema: z.object({}),
        func: async () => "Should not execute",
      });

      // Register tool with isPlusOnly metadata
      ToolRegistry.getInstance().register({
        tool: plusTool,
        metadata: {
          id: "plusTool",
          displayName: "Plus Tool",
          description: "Plus-only tool",
          category: "custom",
          isPlusOnly: true,
        },
      });

      mockCheckIsPlusUser.mockResolvedValueOnce(false);

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result).toMatchObject({
        toolName: "plusTool",
        result: "Error: plusTool requires a Copilot Plus subscription",
        success: false,
        status: "failed",
      });
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("should allow plus-only tools for plus users", async () => {
      const plusTool = createLangChainTool({
        name: "plusTool",
        description: "Plus-only tool",
        schema: z.object({}),
        func: async () => "Plus tool executed",
      });

      // Register tool with isPlusOnly metadata
      ToolRegistry.getInstance().register({
        tool: plusTool,
        metadata: {
          id: "plusTool",
          displayName: "Plus Tool",
          description: "Plus-only tool",
          category: "custom",
          isPlusOnly: true,
        },
      });

      mockCheckIsPlusUser.mockResolvedValueOnce(true);
      mockCallTool.mockResolvedValueOnce("Plus tool executed");

      const result = await executeSequentialToolCall({ name: "plusTool", args: {} }, [plusTool]);

      expect(result).toMatchObject({
        toolName: "plusTool",
        result: "Plus tool executed",
        success: true,
        status: "completed",
        approvedBy: "auto",
      });
      expect(mockCheckIsPlusUser).toHaveBeenCalled();
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should handle tool not found", async () => {
      const result = await executeSequentialToolCall({ name: "unknownTool", args: {} }, []);

      expect(result).toMatchObject({
        toolName: "unknownTool",
        result:
          "Error: Tool 'unknownTool' not found. Available tools: . Make sure you have the tool enabled in the Agent settings.",
        success: false,
        status: "failed",
      });
    });

    it("should handle invalid tool call", async () => {
      const result = await executeSequentialToolCall(null as any, []);

      expect(result).toMatchObject({
        toolName: "unknown",
        result: "Error: Invalid tool call - missing tool name",
        success: false,
        status: "failed",
      });
    });

    it("should execute writeFile normally for any file path", async () => {
      const writeFile = createLangChainTool({
        name: "writeFile",
        description: "Write to file",
        schema: z.object({ path: z.string(), content: z.string() }),
        func: async () => "written",
      });
      const obsidianBases = createLangChainTool({
        name: "obsidianBases",
        description: "Bases CLI",
        schema: z.object({ command: z.string() }),
        func: async () => "queried",
      });

      ToolRegistry.getInstance().register({
        tool: writeFile,
        metadata: { id: "writeFile", displayName: "Write", description: "", category: "file" },
      });

      mockCallTool.mockResolvedValueOnce("File written");

      const result = await executeSequentialToolCall(
        { name: "writeFile", args: { path: "Notes/todo.md", content: "# Todo" } },
        [writeFile, obsidianBases]
      );

      expect(result.success).toBe(true);
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("should reject approval-required tools when user rejects execution", async () => {
      const guardedTool = createLangChainTool({
        name: "guardedTool",
        description: "Approval tool",
        schema: z.object({ input: z.string() }),
        func: async () => "Should not execute",
      });

      ToolRegistry.getInstance().register({
        tool: guardedTool,
        metadata: {
          id: "guardedTool",
          displayName: "Guarded Tool",
          description: "Approval tool",
          category: "custom",
          approvalCategory: "confirm",
        },
      });

      const result = await executeSequentialToolCall(
        { name: "guardedTool", args: { input: "test" } },
        [guardedTool],
        undefined,
        {
          requireToolApproval: true,
          onApprovalRequest: async () => false,
        }
      );

      expect(result).toMatchObject({
        toolName: "guardedTool",
        success: false,
        status: "rejected",
      });
      expect(mockCallTool).not.toHaveBeenCalled();
    });
  });
});
