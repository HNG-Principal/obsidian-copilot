const mockInvoke = jest.fn();
const mockGetChatModel = jest.fn();
const mockFindModelByName = jest.fn();
const mockGetInstance = jest.fn();

jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: {
    getInstance: mockGetInstance,
  },
}));

import { ModelCapability } from "@/constants";
import * as settingsModel from "@/settings/model";
import { FileParserManager } from "@/tools/FileParserManager";
import { TFile, Vault } from "obsidian";

/**
 * Create a lightweight TFile mock for parser-manager tests.
 *
 * @param path - Vault-relative path for the synthetic file.
 * @param size - Byte size used by file-size validation.
 * @returns Mocked TFile shape accepted by FileParserManager.
 */
function createMockFile(path: string, size: number = 1024): TFile {
  const filename = path.split("/").pop() ?? path;

  return {
    path,
    name: filename,
    basename: filename.replace(/\.[^.]+$/, ""),
    extension: filename.split(".").pop() ?? "",
    stat: {
      size,
    },
  } as unknown as TFile;
}

describe("FileParserManager image OCR wiring", () => {
  let vault: Vault;

  beforeEach(() => {
    mockInvoke.mockReset();
    mockGetChatModel.mockReset();
    mockFindModelByName.mockReset();
    mockGetInstance.mockReset();

    mockGetChatModel.mockReturnValue({
      modelName: "vision-test-model",
      invoke: mockInvoke,
    });
    mockFindModelByName.mockReturnValue({
      capabilities: [ModelCapability.VISION],
    });
    mockGetInstance.mockReturnValue({
      getChatModel: mockGetChatModel,
      findModelByName: mockFindModelByName,
    });

    jest.spyOn(settingsModel, "getSettings").mockReturnValue({
      maxFileSizeMB: 50,
    } as ReturnType<typeof settingsModel.getSettings>);

    vault = {
      on: jest.fn(),
      off: jest.fn(),
      adapter: {
        getFullPath: jest.fn().mockImplementation((path: string) => `/vault/${path}`),
      },
      readBinary: jest.fn().mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer),
    } as unknown as Vault;

    (global as any).app = { vault };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("registers image extensions for local attachment conversion", () => {
    const manager = new FileParserManager({} as any, vault, false);

    expect(manager.supportsExtension("png")).toBe(true);
    expect(manager.supportsExtension("jpg")).toBe(true);
    expect(manager.getSupportedFormats()).toContain("image");
  });

  it("routes image attachments through the active vision-capable chat model", async () => {
    mockInvoke.mockResolvedValue({
      content: "Recognized text from screenshot",
    });
    const manager = new FileParserManager({} as any, vault, false);

    const result = await manager.parseFileWithMetadata(
      createMockFile("attachments/scan.png"),
      vault
    );

    expect(result.content).toBe("Recognized text from screenshot");
    expect(result.metadata.sourceFormat).toBe("image");
    expect(result.metadata.ocrUsed).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith([
      {
        role: "user",
        content: [
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining("Document: scan.png"),
          }),
          expect.objectContaining({
            type: "image_url",
            image_url: {
              url: expect.stringMatching(/^data:image\/png;base64,/),
            },
          }),
        ],
      },
    ]);
  });

  it("fails with an OCR error when the current model does not support vision", async () => {
    mockFindModelByName.mockReturnValue({
      capabilities: [],
    });
    const manager = new FileParserManager({} as any, vault, false);

    await expect(
      manager.parseFileWithMetadata(createMockFile("attachments/scan.png"), vault)
    ).rejects.toMatchObject({
      code: "ocr_failed",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
