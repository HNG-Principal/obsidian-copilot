import { Document } from "@langchain/core/documents";

const mockGetSettings = jest.fn();
const mockReadIndexMetadata = jest.fn();
const mergedRetrieverDocsMock = jest.fn();
const filterRetrieverDocsMock = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

jest.mock("@/search/indexMetadata", () => ({
  readIndexMetadata: (...args: unknown[]) => mockReadIndexMetadata(...args),
}));

jest.mock("./MergedSemanticRetriever", () => ({
  MergedSemanticRetriever: jest.fn().mockImplementation(() => ({
    getRelevantDocuments: mergedRetrieverDocsMock,
  })),
}));

jest.mock("./FilterRetriever", () => ({
  FilterRetriever: jest.fn().mockImplementation(() => ({
    getRelevantDocuments: filterRetrieverDocsMock,
  })),
}));

jest.mock("./engines/FullTextEngine", () => ({
  FullTextEngine: jest.fn().mockImplementation(() => ({
    clear: jest.fn(),
    getStats: jest.fn(() => ({ documentsIndexed: 0, memoryUsed: 0, memoryPercent: 0 })),
  })),
}));

jest.mock("./QueryExpander", () => ({
  QueryExpander: jest.fn().mockImplementation(() => ({
    expand: jest.fn(),
    clearCache: jest.fn(),
  })),
}));

jest.mock("./scanners/GrepScanner", () => ({
  GrepScanner: jest.fn().mockImplementation(() => ({
    batchCachedReadGrep: jest.fn(),
    grep: jest.fn(),
  })),
}));

jest.mock("./scoring/FolderBoostCalculator", () => ({
  FolderBoostCalculator: jest.fn().mockImplementation(() => ({
    applyBoosts: jest.fn((results) => results),
  })),
}));

jest.mock("./scoring/GraphBoostCalculator", () => ({
  GraphBoostCalculator: jest.fn().mockImplementation(() => ({
    applyBoost: jest.fn((results) => results),
  })),
}));

jest.mock("./utils/ScoreNormalizer", () => ({
  ScoreNormalizer: jest.fn().mockImplementation(() => ({
    normalize: jest.fn((results) => results),
  })),
}));

jest.mock("./chunks", () => ({
  ChunkManager: jest.fn(),
  getSharedChunkManager: jest.fn().mockReturnValue({
    getChunkText: jest.fn().mockResolvedValue(""),
  }),
}));

import { SearchCore } from "./SearchCore";

function makeSemanticDoc(
  path: string,
  semanticScore: number,
  lexicalScore: number,
  headingPath: string[] = []
): Document {
  return new Document({
    pageContent: `content for ${path}`,
    metadata: {
      path,
      chunkId: `${path}#0`,
      tags: ["#project"],
      mtime: 123,
      semanticScore,
      lexicalScore,
      score: Math.max(semanticScore, lexicalScore),
      rerank_score: Math.max(semanticScore, lexicalScore),
      headingPath,
      startLine: 1,
      endLine: 4,
      documentWordCount: 4,
      documentHeadings: headingPath,
    },
  });
}

describe("SearchCore.search", () => {
  let mockApp: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue({
      debug: false,
      enableLexicalBoosts: true,
      enableSemanticSearchV3: true,
      enableReranking: false,
      enableIndexSync: false,
      hybridSearchTextWeight: 0.3,
    });
    mockReadIndexMetadata.mockResolvedValue(null);
    mergedRetrieverDocsMock.mockResolvedValue([]);
    filterRetrieverDocsMock.mockResolvedValue([]);

    mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(() => ({ stat: { mtime: 123 } })),
      },
      metadataCache: {
        getFileCache: jest.fn(() => undefined),
        resolvedLinks: {},
        getBacklinksForFile: jest.fn(() => ({ data: {} })),
      },
    };
  });

  it("returns hybrid results with lexical and fusion breakdowns", async () => {
    mergedRetrieverDocsMock.mockResolvedValue([
      makeSemanticDoc("exact.md", 0.9, 0.95, ["Projects", "Exact"]),
      makeSemanticDoc("related.md", 0.8, 0.4, ["Projects", "Related"]),
      makeSemanticDoc("semantic-only.md", 0.7, 0, ["Projects", "Semantic"]),
    ]);

    const searchCore = new SearchCore(mockApp as any);
    const results = await searchCore.search({ queryText: "exact keyword", resultLimit: 3 });

    expect(results).toHaveLength(3);
    expect(results[0].documentPath).toBe("exact.md");
    expect(results[0].scoreBreakdown.lexicalScore).toBe(0.95);
    expect(results[0].scoreBreakdown.fusionScore).toBeGreaterThan(0);
    expect(results[0].chunk.headingPath).toEqual(["Projects", "Exact"]);
  });

  it("uses the filter retriever for time-ranged queries", async () => {
    filterRetrieverDocsMock.mockResolvedValue([
      new Document({
        pageContent: "dated content",
        metadata: {
          path: "dated.md",
          chunkId: "dated.md#0",
          tags: ["#dated"],
          mtime: 456,
          score: 0.6,
          rerank_score: 0.6,
          startLine: 1,
          endLine: 2,
        },
      }),
    ]);

    const searchCore = new SearchCore(mockApp as any);
    const results = await searchCore.search({
      queryText: "last week project",
      resultLimit: 5,
      timeRange: { start: 1, end: 2 },
    });

    expect(filterRetrieverDocsMock).toHaveBeenCalledWith("last week project");
    expect(results).toHaveLength(1);
    expect(results[0].documentPath).toBe("dated.md");
  });

  it("blocks search when the index is marked stale", async () => {
    mockReadIndexMetadata.mockResolvedValue({
      version: 1,
      embeddingModel: "test-embedding",
      embeddingDimension: 3,
      lastFullIndexAt: Date.now(),
      documentHashes: {},
      stale: true,
    });

    const searchCore = new SearchCore(mockApp as any);
    const results = await searchCore.search({ queryText: "project", resultLimit: 5 });

    expect(results).toEqual([]);
  });

  it("searches 1000 semantic results within the quickstart time budget", async () => {
    mergedRetrieverDocsMock.mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) =>
        makeSemanticDoc(`note-${index}.md`, 1 - index / 2000, 1 - index / 1500)
      )
    );

    const searchCore = new SearchCore(mockApp as any);
    const start = performance.now();
    const results = await searchCore.search({ queryText: "project status", resultLimit: 25 });
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(25);
    expect(elapsed).toBeLessThan(2000);
  });
});
