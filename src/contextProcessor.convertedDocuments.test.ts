jest.mock("@/chainFactory", () => ({
  ChainType: {
    LLM_CHAIN: "llm_chain",
    COPILOT_PLUS_CHAIN: "copilot_plus",
    PROJECT_CHAIN: "project_chain",
  },
}));

jest.mock("@/utils/convertedDocOutput", () => ({
  saveConvertedDocOutput: jest.fn(),
}));

import { ChainType } from "@/chainFactory";
import { ContextProcessor } from "@/contextProcessor";
import type { FileParserManager, ParsedFileResult } from "@/tools/FileParserManager";
import { saveConvertedDocOutput } from "@/utils/convertedDocOutput";
import { TFile, Vault } from "obsidian";

function makeTFile(path: string, options: Record<string, unknown> = {}): TFile {
  const parts = path.split("/");
  const filename = parts[parts.length - 1];
  const basename = filename.replace(/\.[^.]+$/, "");
  const extension = filename.split(".").pop() ?? "";

  return {
    path,
    name: filename,
    basename,
    extension,
    ...options,
  } as unknown as TFile;
}

describe("ContextProcessor - Converted Documents", () => {
  let contextProcessor: ContextProcessor;
  let vault: Vault;
  let fileParserManager: Pick<FileParserManager, "supportsExtension" | "parseFileWithMetadata">;

  const parsedFile: ParsedFileResult = {
    content: "# Converted report",
    metadata: {
      sourceFilename: "report.pdf",
      sourceFormat: "pdf" as const,
      conversionDate: "2025-01-02T03:04:05.000Z",
      pageCount: 2,
      wordCount: 3,
      ocrUsed: false,
    },
  };

  beforeEach(() => {
    contextProcessor = ContextProcessor.getInstance();
    vault = {
      adapter: {
        stat: jest.fn().mockResolvedValue({ ctime: 0, mtime: 0 }),
      },
    } as unknown as Vault;

    fileParserManager = {
      supportsExtension: jest.fn(() => true),
      parseFileWithMetadata: jest.fn(async () => parsedFile),
    };

    jest.mocked(saveConvertedDocOutput).mockReset();
  });

  it("saves converted output with metadata when the attachment opts in", async () => {
    const pdfFile = makeTFile("docs/report.pdf", { saveConvertedOutput: true });

    const result = await contextProcessor.processContextNotes(
      new Set(),
      fileParserManager as FileParserManager,
      vault,
      [pdfFile],
      false,
      null,
      ChainType.COPILOT_PLUS_CHAIN
    );

    expect(result).toContain(
      '<converted-document source="report.pdf" type="pdf" pages="2" words="3">'
    );
    expect(result).toContain("# Converted report");
    expect(saveConvertedDocOutput).toHaveBeenCalledWith(
      pdfFile,
      parsedFile.content,
      vault,
      undefined,
      parsedFile.metadata
    );
  });

  it("does not save converted output when the attachment did not opt in", async () => {
    const pdfFile = makeTFile("docs/report.pdf");

    await contextProcessor.processContextNotes(
      new Set(),
      fileParserManager as FileParserManager,
      vault,
      [pdfFile],
      false,
      null,
      ChainType.COPILOT_PLUS_CHAIN
    );

    expect(saveConvertedDocOutput).not.toHaveBeenCalled();
  });
});
