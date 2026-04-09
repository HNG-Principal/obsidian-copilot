import { hasSelfHostSearchKey, selfHostRerank, selfHostWebSearch } from "./selfHostServices";

const mockSearch = jest.fn();
const mockGetWebSearchProviderSettings = jest.fn(() => ({}));

// --- Mocks ---

const mockGetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

jest.mock("@/encryptionService", () => ({
  getDecryptedKey: (key: string) => Promise.resolve(key),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/services/webSearchProvider", () => ({
  createWebSearchProvider: () => ({ search: mockSearch }),
  getWebSearchProviderSettings: () => mockGetWebSearchProviderSettings(),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
  // Default settings: firecrawl provider
  mockGetSettings.mockReturnValue({
    webSearchProvider: "firecrawl",
    selfHostSearchProvider: "firecrawl",
    searxngUrl: "",
    firecrawlApiKey: "fc-test-key",
    perplexityApiKey: "",
    supadataApiKey: "",
    selfHostUrl: "http://localhost:8742",
    selfHostApiKey: "self-host-key",
    plusLicenseKey: "",
  });
});

// --- hasSelfHostSearchKey ---

describe("hasSelfHostSearchKey", () => {
  it("returns true when firecrawl provider has a key", () => {
    mockGetSettings.mockReturnValue({
      webSearchProvider: "firecrawl",
      selfHostSearchProvider: "firecrawl",
      searxngUrl: "",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    expect(hasSelfHostSearchKey()).toBe(true);
  });

  it("returns false when firecrawl provider has no key", () => {
    mockGetSettings.mockReturnValue({
      webSearchProvider: "firecrawl",
      selfHostSearchProvider: "firecrawl",
      searxngUrl: "",
      firecrawlApiKey: "",
      perplexityApiKey: "pplx-key",
    });
    expect(hasSelfHostSearchKey()).toBe(false);
  });

  it("returns true when perplexity provider has a key", () => {
    mockGetSettings.mockReturnValue({
      webSearchProvider: "perplexity",
      selfHostSearchProvider: "perplexity",
      searxngUrl: "",
      firecrawlApiKey: "",
      perplexityApiKey: "pplx-key",
    });
    expect(hasSelfHostSearchKey()).toBe(true);
  });

  it("returns false when perplexity provider has no key", () => {
    mockGetSettings.mockReturnValue({
      webSearchProvider: "perplexity",
      selfHostSearchProvider: "perplexity",
      searxngUrl: "",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    expect(hasSelfHostSearchKey()).toBe(false);
  });

  it("defaults to firecrawl for unknown provider", () => {
    mockGetSettings.mockReturnValue({
      webSearchProvider: "firecrawl",
      selfHostSearchProvider: "unknown",
      searxngUrl: "",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    expect(hasSelfHostSearchKey()).toBe(true);
  });

  it("returns true when searxng provider has a URL", () => {
    mockGetSettings.mockReturnValue({
      webSearchProvider: "searxng",
      selfHostSearchProvider: "firecrawl",
      searxngUrl: "https://search.example.com",
      firecrawlApiKey: "",
      perplexityApiKey: "",
    });
    expect(hasSelfHostSearchKey()).toBe(true);
  });
});

describe("selfHostWebSearch", () => {
  it("formats results returned by the provider layer", async () => {
    mockSearch.mockResolvedValue({
      provider: "firecrawl",
      results: [
        {
          title: "Result 1",
          url: "https://example.com/1",
          snippet: "Desc 1",
          source: "firecrawl",
          rank: 1,
        },
        {
          title: "Result 2",
          url: "https://example.com/2",
          snippet: "Desc 2",
          source: "firecrawl",
          rank: 2,
        },
      ],
    });

    const result = await selfHostWebSearch("test query");

    expect(result.citations).toEqual(["https://example.com/1", "https://example.com/2"]);
    expect(result.content).toContain("### Result 1");
    expect(result.content).toContain("### Result 2");
  });

  it("returns empty content when the provider has no results", async () => {
    mockSearch.mockResolvedValue({ provider: "searxng", results: [] });

    const result = await selfHostWebSearch("test query");

    expect(result).toEqual({ content: "", citations: [] });
  });

  it("propagates provider failures", async () => {
    mockSearch.mockRejectedValue(new Error("provider unavailable"));

    await expect(selfHostWebSearch("test query")).rejects.toThrow("provider unavailable");
  });
});

// --- Provider dispatch compatibility ---

describe("selfHostWebSearch — provider dispatch", () => {
  it("delegates through createWebSearchProvider settings projection", async () => {
    mockSearch.mockResolvedValue({ provider: "firecrawl", results: [] });

    await selfHostWebSearch("test");

    expect(mockGetWebSearchProviderSettings).toHaveBeenCalled();
    expect(mockSearch).toHaveBeenCalledWith("test", 5);
  });
});

describe("selfHostWebSearch — legacy fallback provider setting", () => {
  it("still treats firecrawl as available when the deprecated provider field is set", async () => {
    mockGetSettings.mockReturnValue({
      webSearchProvider: "firecrawl",
      selfHostSearchProvider: "unknown-provider",
      searxngUrl: "",
      firecrawlApiKey: "fc-key",
      perplexityApiKey: "",
    });
    expect(hasSelfHostSearchKey()).toBe(true);
  });
});

describe("selfHostRerank", () => {
  beforeEach(() => {
    mockGetSettings.mockReturnValue({
      selfHostSearchProvider: "firecrawl",
      firecrawlApiKey: "fc-test-key",
      perplexityApiKey: "",
      supadataApiKey: "",
      selfHostUrl: "http://localhost:8742",
      selfHostApiKey: "self-host-key",
      plusLicenseKey: "",
    });
  });

  it("uses the versioned self-host rerank endpoint when available", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { index: 1, score: 0.9 },
          { index: 0, score: 0.2 },
        ],
        model: "self-host-rerank",
      }),
    });

    const result = await selfHostRerank("find best result", ["doc a", "doc b"]);

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8742/v0/rerank", {
      method: "POST",
      headers: {
        Authorization: "Bearer self-host-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "find best result",
        documents: ["doc a", "doc b"],
        model: "rerank-2",
      }),
    });
    expect(result.response.data).toEqual([
      { index: 1, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.2 },
    ]);
  });

  it("falls back to the legacy rerank endpoint on 404", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not found",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: {
            object: "list",
            data: [{ index: 0, relevance_score: 0.7 }],
            model: "legacy-rerank",
            usage: { total_tokens: 12 },
          },
          elapsed_time_ms: 5,
        }),
      });

    const result = await selfHostRerank("query", ["doc a"]);

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8742/v0/rerank",
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8742/rerank",
      expect.any(Object)
    );
    expect(result.response.model).toBe("legacy-rerank");
  });
});
