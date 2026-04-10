import { WebExtractor } from "./webExtractor";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ urlExtractionTimeoutMs: 1000 })),
}));

function createResponse(body: string, overrides: Partial<Response> = {}): Response {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === "content-type") {
          return overrides.headers?.get("content-type") ?? "text/html";
        }
        return null;
      },
    },
  } as Response;
}

describe("WebExtractor", () => {
  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    cleanup: jest.fn(),
    clear: jest.fn(),
  };
  const fetchImpl = jest.fn();
  const now = jest.fn(() => 1700000000000);
  const convertPdf = jest.fn(async () => "PDF markdown content");

  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(undefined);
  });

  it("extracts readable markdown from a normal page", async () => {
    fetchImpl.mockResolvedValue(
      createResponse(`
        <html>
          <head>
            <title>Readable page</title>
            <meta name="author" content="Ada Lovelace" />
          </head>
          <body>
            <article>
              <h1>Readable page</h1>
              <p>This is the main content of the page.</p>
            </article>
          </body>
        </html>
      `)
    );

    const extractor = new WebExtractor({ cache, fetchImpl, now, convertPdf });
    const result = await extractor.extractUrlContent("https://example.com/article");

    expect(result.status).toBe("success");
    expect(result.title).toBe("Readable page");
    expect(result.author).toBe("Ada Lovelace");
    expect(result.content).toContain("This is the main content of the page.");
    expect(cache.set).toHaveBeenCalled();
  });

  it("returns blocked status for forbidden pages", async () => {
    fetchImpl.mockResolvedValue(createResponse("Forbidden", { ok: false, status: 403 }));

    const extractor = new WebExtractor({ cache, fetchImpl, now, convertPdf });
    const result = await extractor.extractUrlContent("https://example.com/private");

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "blocked",
      message: "URL fetch failed with status 403",
    });
  });

  it("truncates oversized pages and marks them partial", async () => {
    const content = "Long content ".repeat(1000);
    fetchImpl.mockResolvedValue(
      createResponse(`<html><body><article><p>${content}</p></article></body></html>`)
    );

    const extractor = new WebExtractor({ cache, fetchImpl, now, convertPdf });
    const result = await extractor.extractUrlContent("https://example.com/long", {
      maxContentBytes: 400,
    });

    expect(result.status).toBe("partial");
    expect(result.content).toContain("[Content truncated to fit the context window.]");
  });

  it("returns cached content without refetching", async () => {
    cache.get.mockResolvedValue({
      urlHash: "abc",
      url: "https://example.com/cached",
      title: "Cached page",
      content: "Cached content",
      extractedAt: 1700000000000,
      expiresAt: 1700003600000,
      byteLength: 20,
    });

    const extractor = new WebExtractor({ cache, fetchImpl, now, convertPdf });
    const result = await extractor.extractUrlContent("https://example.com/cached");

    expect(result).toMatchObject({
      url: "https://example.com/cached",
      title: "Cached page",
      content: "Cached content",
      status: "success",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
