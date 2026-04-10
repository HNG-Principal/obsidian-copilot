const mockReadIndexMetadata = jest.fn();
const mockWriteIndexMetadata = jest.fn();

jest.mock("@/search/indexMetadata", () => ({
  readIndexMetadata: (...args: unknown[]) => mockReadIndexMetadata(...args),
  writeIndexMetadata: (...args: unknown[]) => mockWriteIndexMetadata(...args),
}));

import { Notice } from "obsidian";
import { resetSettings, setSettings, getSettings, getModelKeyFromModel } from "./model";

describe("search index safety settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadIndexMetadata.mockResolvedValue(null);
    mockWriteIndexMetadata.mockResolvedValue(undefined);
    resetSettings();
  });

  it("marks the index stale when the embedding model changes", async () => {
    const embeddingModels = getSettings().activeEmbeddingModels.slice(0, 2);
    expect(embeddingModels).toHaveLength(2);
    const originalKey = getModelKeyFromModel(embeddingModels[0]);
    const updatedKey = getModelKeyFromModel(embeddingModels[1]);

    setSettings({
      activeEmbeddingModels: embeddingModels,
      embeddingModelKey: originalKey,
    });

    mockReadIndexMetadata.mockResolvedValue({
      version: 1,
      embeddingModel: embeddingModels[0].name,
      embeddingDimension: 3,
      lastFullIndexAt: Date.now(),
      documentHashes: { "note.md": "hash" },
      stale: false,
    });

    setSettings({
      activeEmbeddingModels: embeddingModels,
      embeddingModelKey: updatedKey,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockWriteIndexMetadata).toHaveBeenCalledWith(
      app,
      expect.any(Boolean),
      expect.objectContaining({ stale: true })
    );
    expect(Notice).toHaveBeenCalledWith(
      "Embedding model changed. Run a full re-index to rebuild Copilot search."
    );
  });
});
