const mockGetSettings = jest.fn();
const mockSubscribeToSettingsChange = jest.fn();
const mockReadIndexMetadata = jest.fn();
const mockWriteIndexMetadata = jest.fn();
const mockGetChunks = jest.fn();
const mockGetEmbeddingsAPI = jest.fn();

let indexingProgressState: any;

jest.mock("@/aiParams", () => ({
  flushIndexingCount: jest.fn(),
  getIndexingProgressState: () => indexingProgressState,
  resetIndexingProgressState: jest.fn(() => {
    indexingProgressState = {
      isActive: false,
      isPaused: false,
      isCancelled: false,
      indexedCount: 0,
      totalFiles: 0,
      errors: [],
      completionStatus: "none",
    };
  }),
  setIndexingProgressState: jest.fn((update) => {
    indexingProgressState = { ...indexingProgressState, ...update };
  }),
  throttledUpdateIndexingCount: jest.fn((count) => {
    indexingProgressState = { ...indexingProgressState, indexedCount: count };
  }),
  updateIndexingProgressState: jest.fn((update) => {
    indexingProgressState = { ...indexingProgressState, ...update };
  }),
}));

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
  subscribeToSettingsChange: (...args: unknown[]) => mockSubscribeToSettingsChange(...args),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/search/indexMetadata", () => ({
  readIndexMetadata: (...args: unknown[]) => mockReadIndexMetadata(...args),
  writeIndexMetadata: (...args: unknown[]) => mockWriteIndexMetadata(...args),
}));

jest.mock("@/search/v3/chunks", () => ({
  ChunkManager: jest.fn(),
  getSharedChunkManager: jest.fn(() => ({
    getChunks: mockGetChunks,
  })),
}));

jest.mock("@/LLMProviders/embeddingManager", () => {
  const EmbeddingsManager = jest.fn();
  (EmbeddingsManager as any).getModelName = jest.fn(() => "test-embedding-model");
  return {
    __esModule: true,
    default: EmbeddingsManager,
  };
});

jest.mock("./searchUtils", () => {
  const actual = jest.requireActual("./searchUtils");
  return {
    ...actual,
    getMatchingPatterns: jest.fn(() => ({ inclusions: [], exclusions: [] })),
    shouldIndexFile: jest.fn(() => true),
    getVectorLength: jest.fn(async () => 3),
  };
});

import { IndexOperations } from "./indexOperations";
import { TFile } from "obsidian";

type MockFile = {
  name: string;
  path: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number };
};

function makeFile(path: string, mtime = 1000): MockFile {
  const file = new (TFile as any)(path) as MockFile;
  file.path = path;
  file.name = path.split("/").pop() || path;
  file.basename = file.name.replace(/\.[^/.]+$/, "");
  file.extension = "md";
  file.stat = { ctime: mtime - 100, mtime };
  return file;
}

function makeApp(files: MockFile[], contents: Record<string, string>): any {
  const fileMap = new Map(files.map((file) => [file.path, file]));
  return {
    vault: {
      getMarkdownFiles: jest.fn(() => files),
      cachedRead: jest.fn(async (file: MockFile) => contents[file.path] ?? ""),
      getAbstractFileByPath: jest.fn((path: string) => fileMap.get(path) ?? null),
    },
    metadataCache: {
      getFileCache: jest.fn(() => ({ frontmatter: {}, tags: [] })),
    },
  };
}

function makeIndexBackend() {
  return {
    requiresEmbeddings: jest.fn(() => true),
    checkAndHandleEmbeddingModelChange: jest.fn(async () => false),
    clearIndex: jest.fn(async () => {}),
    clearFilesMissingEmbeddings: jest.fn(),
    garbageCollect: jest.fn(async () => {}),
    getIndexedFiles: jest.fn(async () => []),
    getLatestFileMtime: jest.fn(async () => 0),
    getFilesMissingEmbeddings: jest.fn(() => []),
    markFileMissingEmbeddings: jest.fn(),
    removeByPath: jest.fn(async () => {}),
    upsert: jest.fn(async () => {}),
    upsertBatch: jest.fn(async () => {}),
    save: jest.fn(async () => {}),
    checkIndexIntegrity: jest.fn(async () => {}),
    markUnsavedChanges: jest.fn(),
  };
}

describe("IndexOperations verification", () => {
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    jest.clearAllMocks();
    indexingProgressState = {
      isActive: false,
      isPaused: false,
      isCancelled: false,
      indexedCount: 0,
      totalFiles: 0,
      errors: [],
      completionStatus: "none",
    };
    mockGetSettings.mockReturnValue({
      enableSemanticSearchV3: true,
      embeddingRequestsPerMin: 100000,
      embeddingBatchSize: 10000,
      enableIndexSync: false,
      embeddingModelKey: "test|embedding",
      debug: false,
    });
    mockSubscribeToSettingsChange.mockReturnValue(jest.fn());
    mockReadIndexMetadata.mockResolvedValue(null);
    mockWriteIndexMetadata.mockResolvedValue(undefined);
    mockGetEmbeddingsAPI.mockResolvedValue({
      embedDocuments: jest.fn(async (documents: string[]) => documents.map(() => [0.1, 0.2, 0.3])),
    });
    mockGetChunks.mockImplementation(async (paths: string[]) =>
      paths.map((path, index) => ({
        id: `${path}#0`,
        notePath: path,
        title: path,
        content: `NOTE TITLE: [[${path}]]\n\nNOTE BLOCK CONTENT:\n\nChunk ${index}`,
        mtime: 1000 + index,
        heading: "Section",
        startLine: 1,
        endLine: 3,
      }))
    );
    global.setTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") {
        callback();
      }
      return 0;
    }) as unknown as typeof setTimeout;
  });

  afterAll(() => {
    global.setTimeout = originalSetTimeout;
  });

  it("detects changed, new, and deleted files", async () => {
    const files = [makeFile("same.md"), makeFile("changed.md"), makeFile("new.md")];
    const contents = {
      "same.md": "same",
      "changed.md": "changed now",
      "new.md": "brand new",
    };
    const app = makeApp(files, contents);
    const indexBackend = makeIndexBackend();
    mockReadIndexMetadata.mockResolvedValue({
      version: 1,
      embeddingModel: "test-embedding-model",
      embeddingDimension: 3,
      lastFullIndexAt: 1,
      documentHashes: {
        "same.md": "51037a4a37730f52c8732586d3aaa316",
        "changed.md": "old-hash",
        "deleted.md": "deleted-hash",
      },
      stale: false,
    });

    const operations = new IndexOperations(
      app,
      indexBackend as any,
      {
        getEmbeddingsAPI: mockGetEmbeddingsAPI,
      } as any
    );

    const changed = await operations.detectChanges();

    expect(changed).toEqual(["changed.md", "deleted.md", "new.md"]);
  });

  it("incrementally reindexes 50 changed files within the target budget", async () => {
    const files = Array.from({ length: 50 }, (_, index) =>
      makeFile(`changed-${index}.md`, 1000 + index)
    );
    const contents = Object.fromEntries(
      files.map((file, index) => [file.path, `updated ${index}`])
    );
    const app = makeApp(files, contents);
    const indexBackend = makeIndexBackend();
    mockReadIndexMetadata.mockResolvedValue({
      version: 1,
      embeddingModel: "test-embedding-model",
      embeddingDimension: 3,
      lastFullIndexAt: 1,
      documentHashes: Object.fromEntries(files.map((file) => [file.path, "old-hash"])),
      stale: false,
    });

    const operations = new IndexOperations(
      app,
      indexBackend as any,
      {
        getEmbeddingsAPI: mockGetEmbeddingsAPI,
      } as any
    );

    const start = performance.now();
    const processed = await operations.updateChanged();
    const elapsed = performance.now() - start;

    expect(processed).toBe(50);
    expect(indexBackend.upsert).toHaveBeenCalledTimes(50);
    expect(elapsed).toBeLessThan(30000);
  });

  it("removes deleted files from the index metadata store", async () => {
    const app = makeApp([], {});
    const indexBackend = makeIndexBackend();
    const metadata = {
      version: 1,
      embeddingModel: "test-embedding-model",
      embeddingDimension: 3,
      lastFullIndexAt: 1,
      documentHashes: {
        "deleted.md": "hash",
      },
      stale: false,
    };
    mockReadIndexMetadata.mockResolvedValue(metadata);

    const operations = new IndexOperations(
      app,
      indexBackend as any,
      {
        getEmbeddingsAPI: mockGetEmbeddingsAPI,
      } as any
    );

    await operations.removeDocument("deleted.md");

    expect(indexBackend.removeByPath).toHaveBeenCalledWith("deleted.md");
    expect(mockWriteIndexMetadata).toHaveBeenCalledWith(
      app,
      false,
      expect.objectContaining({ documentHashes: {} })
    );
  });

  it("indexes a newly added file within 10 seconds", async () => {
    const files = [makeFile("fresh.md")];
    const app = makeApp(files, { "fresh.md": "fresh content" });
    const indexBackend = makeIndexBackend();
    mockReadIndexMetadata.mockResolvedValue({
      version: 1,
      embeddingModel: "test-embedding-model",
      embeddingDimension: 3,
      lastFullIndexAt: 1,
      documentHashes: {},
      stale: false,
    });

    const operations = new IndexOperations(
      app,
      indexBackend as any,
      {
        getEmbeddingsAPI: mockGetEmbeddingsAPI,
      } as any
    );

    const start = performance.now();
    const processed = await operations.updateChanged();
    const elapsed = performance.now() - start;

    expect(processed).toBe(1);
    expect(elapsed).toBeLessThan(10000);
  });

  it("rebuilds a synthetic 10K-note vault within the performance budget", async () => {
    const files = Array.from({ length: 10000 }, (_, index) =>
      makeFile(`vault/note-${index}.md`, 1000 + index)
    );
    const contents = Object.fromEntries(
      files.map((file, index) => [file.path, `content ${index}`])
    );
    const app = makeApp(files, contents);
    const indexBackend = makeIndexBackend();

    const operations = new IndexOperations(
      app,
      indexBackend as any,
      {
        getEmbeddingsAPI: mockGetEmbeddingsAPI,
      } as any
    );

    const start = performance.now();
    const indexed = await operations.indexVaultToVectorStore(true, { userInitiated: true });
    const elapsed = performance.now() - start;

    expect(indexed).toBe(10000);
    expect(indexBackend.upsertBatch).toHaveBeenCalled();
    expect(elapsed).toBeLessThan(30 * 60 * 1000);
  });
});
