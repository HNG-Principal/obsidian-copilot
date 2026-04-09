const mockSearch = jest.fn();
const mockGetStandaloneQuestion = jest.fn();

jest.mock("@/chainUtils", () => ({
  getStandaloneQuestion: (...args: unknown[]) => mockGetStandaloneQuestion(...args),
}));

jest.mock("@/services/webSearchProvider", () => ({
  createWebSearchProvider: () => ({ search: mockSearch }),
}));

jest.mock("@/LLMProviders/chainRunner/utils/citationUtils", () => ({
  getWebSearchCitationInstructions: () => "Use footnote citations.",
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/miyo/miyoUtils", () => ({
  shouldUseMiyo: jest.fn(() => false),
}));

jest.mock("@/search/RetrieverFactory", () => ({
  RetrieverFactory: {
    isMiyoActive: jest.fn(() => false),
    getRetrieverType: jest.fn(() => "lexical"),
    createLexicalRetriever: jest.fn(),
    createRetriever: jest.fn(),
    createMiyoRetriever: jest.fn(),
  },
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ maxSourceChunks: 10 })),
}));

jest.mock("@/LLMProviders/chainRunner/utils/toolExecution", () => ({
  deduplicateSources: jest.fn((sources: unknown[]) => sources),
}));

jest.mock("@/search/v3/TieredLexicalRetriever", () => ({
  TieredLexicalRetriever: class {},
}));

jest.mock("@/search/v3/FilterRetriever", () => ({
  FilterRetriever: class {},
}));

jest.mock("@/search/v3/mergeResults", () => ({
  mergeFilterAndSearchResults: jest.fn(() => ({ filterResults: [], searchResults: [] })),
}));

import { webSearchTool } from "./SearchTools";

describe("webSearchTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStandaloneQuestion.mockResolvedValue("standalone query");
  });

  it("returns provider results with citations and instructions", async () => {
    mockSearch.mockResolvedValue({
      query: "standalone query",
      provider: "firecrawl",
      summary: "Summary text",
      results: [
        {
          title: "Result 1",
          url: "https://example.com/1",
          snippet: "Snippet 1",
          source: "firecrawl",
          rank: 1,
        },
      ],
    });

    const response = await (webSearchTool as any).invoke({ query: "test", chatHistory: [] });
    const parsed = JSON.parse(response);

    expect(parsed[0]).toMatchObject({
      type: "web_search",
      provider: "firecrawl",
      query: "standalone query",
      summary: "Summary text",
      citations: ["https://example.com/1"],
      instruction: "Use footnote citations.",
    });
  });

  it("returns empty results cleanly when the provider has no matches", async () => {
    mockSearch.mockResolvedValue({
      query: "standalone query",
      provider: "searxng",
      results: [],
    });

    const response = await (webSearchTool as any).invoke({ query: "test", chatHistory: [] });
    const parsed = JSON.parse(response);

    expect(parsed[0].results).toEqual([]);
    expect(parsed[0].citations).toEqual([]);
  });

  it("returns a structured error payload when the provider throws", async () => {
    mockSearch.mockRejectedValue(new Error("provider unavailable"));

    const response = await (webSearchTool as any).invoke({ query: "test", chatHistory: [] });
    const parsed = JSON.parse(response);

    expect(parsed).toEqual({ error: "Web search failed: Error: provider unavailable" });
  });
});
