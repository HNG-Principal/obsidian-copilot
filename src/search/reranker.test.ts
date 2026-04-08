import { createReranker, isSelfHostRerankingAvailable } from "@/search/reranker";
import type { SearchResult } from "@/search/types";

const mockGetSettings = jest.fn();
const mockSelfHostRerank = jest.fn();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

jest.mock("@/LLMProviders/selfHostServices", () => ({
  selfHostRerank: (...args: unknown[]) => mockSelfHostRerank(...args),
}));

function makeResult(documentPath: string, score: number): SearchResult {
  return {
    chunk: {
      id: documentPath,
      documentPath,
      content: `content for ${documentPath}`,
      headingPath: [],
      startLine: 1,
      endLine: 1,
      metadata: {
        documentTags: [],
        documentModifiedAt: 0,
        documentWordCount: 3,
        sectionHeadings: [],
      },
    },
    score,
    documentPath,
    sectionPreview: `preview for ${documentPath}`,
    scoreBreakdown: {
      semanticScore: score,
      lexicalScore: 0,
      fusionScore: score,
    },
  };
}

describe("createReranker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockReturnValue({
      enableSelfHostMode: false,
      selfHostUrl: "",
      selfHostModeValidatedAt: null,
      selfHostValidationCount: 0,
    });
  });

  it("returns original order when no reranker backend is available", async () => {
    const reranker = createReranker();
    const results = [makeResult("alpha.md", 0.9), makeResult("beta.md", 0.7)];

    const reranked = await reranker.rerank("test query", results, 1);

    expect(reranked).toHaveLength(1);
    expect(reranked[0].documentPath).toBe("alpha.md");
  });

  it("reorders top results using model-provided scores", async () => {
    const reranker = createReranker(
      async () =>
        ({
          invoke: jest.fn().mockResolvedValue({
            content: '{"scores":[2,9]}',
          }),
        }) as any
    );
    const results = [makeResult("alpha.md", 0.9), makeResult("beta.md", 0.7)];

    const reranked = await reranker.rerank("test query", results, 2);

    expect(reranked.map((result) => result.documentPath)).toEqual(["beta.md", "alpha.md"]);
    expect(reranked[0].scoreBreakdown.rerankScore).toBe(9);
    expect(reranked[1].scoreBreakdown.rerankScore).toBe(2);
  });

  it("prefers self-host reranking when self-host mode is valid", async () => {
    mockGetSettings.mockReturnValue({
      enableSelfHostMode: true,
      selfHostUrl: "http://localhost:8742",
      selfHostModeValidatedAt: Date.now(),
      selfHostValidationCount: 1,
    });
    mockSelfHostRerank.mockResolvedValue({
      response: {
        object: "list",
        data: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.4 },
        ],
        model: "self-host-rerank",
        usage: { total_tokens: 0 },
      },
      elapsed_time_ms: 10,
    });

    const reranker = createReranker(async () => ({ invoke: jest.fn() }) as any);
    const results = [makeResult("alpha.md", 0.9), makeResult("beta.md", 0.7)];

    const reranked = await reranker.rerank("test query", results, 2);

    expect(mockSelfHostRerank).toHaveBeenCalledTimes(1);
    expect(reranked.map((result) => result.documentPath)).toEqual(["beta.md", "alpha.md"]);
    expect(reranked[0].scoreBreakdown.rerankScore).toBe(0.95);
  });
});

describe("isSelfHostRerankingAvailable", () => {
  it("returns false without valid self-host mode", () => {
    mockGetSettings.mockReturnValue({
      enableSelfHostMode: true,
      selfHostUrl: "http://localhost:8742",
      selfHostModeValidatedAt: null,
      selfHostValidationCount: 0,
    });

    expect(isSelfHostRerankingAvailable()).toBe(false);
  });

  it("returns true during the self-host grace period", () => {
    mockGetSettings.mockReturnValue({
      enableSelfHostMode: true,
      selfHostUrl: "http://localhost:8742",
      selfHostModeValidatedAt: Date.now(),
      selfHostValidationCount: 1,
    });

    expect(isSelfHostRerankingAvailable()).toBe(true);
  });
});
