import { createWebSearchProvider } from "./webSearchProvider";

function createResponse(payload: unknown, overrides: Partial<Response> = {}): Response {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    json: async () => payload,
  } as Response;
}

describe("createWebSearchProvider", () => {
  const decryptKey = jest.fn(async (value: string) => value);
  const now = jest.fn(() => 1234567890);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("parses Firecrawl v2 results", async () => {
    const fetchImpl = jest.fn(async () =>
      createResponse({
        data: {
          web: [
            { title: "Result 1", description: "Desc 1", url: "https://example.com/1" },
            { title: "Result 2", description: "Desc 2", url: "https://example.com/2" },
          ],
        },
      })
    );

    const provider = createWebSearchProvider(
      {
        webSearchProvider: "firecrawl",
        searxngUrl: "",
        firecrawlApiKey: "fc-key",
        perplexityApiKey: "",
      },
      { fetchImpl: fetchImpl as any, decryptKey, now }
    );

    const result = await provider.search("test query", 5);

    expect(result.provider).toBe("firecrawl");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      title: "Result 1",
      snippet: "Desc 1",
      url: "https://example.com/1",
      rank: 1,
    });
  });

  it("parses Perplexity summary and citations", async () => {
    const fetchImpl = jest.fn(async () =>
      createResponse({
        choices: [{ message: { content: "Summary text" } }],
        citations: ["https://source-1.com", "https://source-2.com"],
      })
    );

    const provider = createWebSearchProvider(
      {
        webSearchProvider: "perplexity",
        searxngUrl: "",
        firecrawlApiKey: "",
        perplexityApiKey: "pplx-key",
      },
      { fetchImpl: fetchImpl as any, decryptKey, now }
    );

    const result = await provider.search("latest updates", 5);

    expect(result.provider).toBe("perplexity");
    expect(result.summary).toBe("Summary text");
    expect(result.results.map((entry) => entry.url)).toEqual([
      "https://source-1.com",
      "https://source-2.com",
    ]);
  });

  it("parses SearXNG results", async () => {
    const fetchImpl = jest.fn(async () =>
      createResponse({
        results: [
          {
            title: "SearXNG Result",
            url: "https://search.example.com/result",
            content: "Snippet",
            engine: "duckduckgo",
          },
        ],
      })
    );

    const provider = createWebSearchProvider(
      {
        webSearchProvider: "searxng",
        searxngUrl: "https://search.example.com",
        firecrawlApiKey: "",
        perplexityApiKey: "",
      },
      { fetchImpl: fetchImpl as any, decryptKey, now }
    );

    const result = await provider.search("oss plugins", 5);

    expect(result.provider).toBe("searxng");
    expect(result.results[0]).toMatchObject({
      title: "SearXNG Result",
      source: "duckduckgo",
      snippet: "Snippet",
    });
  });

  it("throws provider-specific HTTP errors", async () => {
    const fetchImpl = jest.fn(async () =>
      createResponse({ message: "Unauthorized" }, { ok: false, status: 401 })
    );

    const provider = createWebSearchProvider(
      {
        webSearchProvider: "firecrawl",
        searxngUrl: "",
        firecrawlApiKey: "fc-key",
        perplexityApiKey: "",
      },
      { fetchImpl: fetchImpl as any, decryptKey, now }
    );

    await expect(provider.search("test", 5)).rejects.toThrow("Firecrawl search failed (401)");
  });
});
