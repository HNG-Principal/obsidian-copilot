jest.mock("@/chainFactory", () => ({
  ChainType: {
    LLM_CHAIN: "llm_chain",
    COPILOT_PLUS_CHAIN: "copilot_plus",
    PROJECT_CHAIN: "project_chain",
  },
}));

import { ChainType } from "@/chainFactory";
import { ContextProcessor } from "@/contextProcessor";
import { TFile, Vault } from "obsidian";

const createMockFile = (path: string): TFile => new (TFile as any)(path);

describe("ContextProcessor - conversion errors", () => {
  let contextProcessor: ContextProcessor;
  let vault: Vault;

  beforeEach(() => {
    contextProcessor = ContextProcessor.getInstance();
    vault = {
      adapter: {
        stat: jest.fn().mockResolvedValue({ ctime: 0, mtime: 0 }),
      },
    } as unknown as Vault;
  });

  it("rethrows direct attachment conversion errors so chat can display them", async () => {
    const attachment = createMockFile("Locked.pdf");
    const fileParserManager = {
      supportsExtension: jest.fn(() => true),
      parseFileWithMetadata: jest.fn().mockRejectedValue({
        code: "password_protected",
        message: "The file is encrypted.",
        sourceFilename: "Locked.pdf",
      }),
    };

    await expect(
      contextProcessor.processContextNotes(
        new Set(),
        fileParserManager as any,
        vault,
        [attachment],
        false,
        null,
        ChainType.COPILOT_PLUS_CHAIN
      )
    ).rejects.toMatchObject({
      code: "password_protected",
      sourceFilename: "Locked.pdf",
    });
  });
});
