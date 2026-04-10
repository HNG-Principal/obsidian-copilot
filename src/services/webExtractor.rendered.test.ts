import { WebExtractor } from "./webExtractor";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ urlExtractionTimeoutMs: 1000 })),
}));

function createResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    headers: { get: () => "text/html" },
  } as Response;
}

describe("WebExtractor rendered fallback", () => {
  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    cleanup: jest.fn(),
    clear: jest.fn(),
  };
  const fetchImpl = jest.fn();
  const renderPage = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
  });

  it("uses rendered HTML when the raw extract is too thin", async () => {
    fetchImpl.mockResolvedValue(
      createResponse(
        '<html><body><div id="root"></div><script>window.__NEXT_DATA__={}</script></body></html>'
      )
    );
    renderPage.mockResolvedValue(
      "<html><body><article><h1>Rendered title</h1><p>Rendered content loaded by JS.</p></article></body></html>"
    );

    const extractor = new WebExtractor({
      cache,
      fetchImpl,
      renderedPageProvider: { renderPage },
    } as any);
    const result = await extractor.extractUrlContent("https://example.com/spa");

    expect(renderPage).toHaveBeenCalledWith("https://example.com/spa", 1000);
    expect(result.status).toBe("success");
    expect(result.content).toContain("Rendered content loaded by JS.");
  });

  it("falls back to partial raw extraction when rendered fallback fails", async () => {
    fetchImpl.mockResolvedValue(
      createResponse(
        '<html><body><div id="root">Loading content</div><p>Thin content</p></body></html>'
      )
    );
    renderPage.mockRejectedValue(new Error("Rendered fallback timed out"));

    const extractor = new WebExtractor({
      cache,
      fetchImpl,
      renderedPageProvider: { renderPage },
    } as any);
    const result = await extractor.extractUrlContent("https://example.com/spa");

    expect(result.status).toBe("partial");
    expect(result.error?.message).toContain("Rendered fallback timed out");
    expect(result.content).toContain("Thin content");
  });
});
