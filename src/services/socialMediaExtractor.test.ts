import { SocialMediaExtractor } from "./socialMediaExtractor";
import { WebExtractor } from "./webExtractor";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ urlExtractionTimeoutMs: 1000 })),
}));

function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(payload)).buffer,
    headers: { get: () => "application/json" },
  } as Response;
}

function createHtmlResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    headers: { get: () => "text/html" },
  } as Response;
}

describe("SocialMediaExtractor", () => {
  it("extracts X/Twitter post content, author, and date", async () => {
    const fetchImpl = jest.fn(async () =>
      createJsonResponse({
        author_name: "Ada Lovelace",
        html: '<blockquote><p>Hello from X</p>&mdash; Ada Lovelace <a href="https://x.com/user/status/1">Apr 8, 2026</a></blockquote>',
      })
    );

    const extractor = new SocialMediaExtractor({ fetchImpl, now: () => 1700000000000 });
    const result = await extractor.extractSocialPost("https://x.com/user/status/1");

    expect(result).toMatchObject({
      author: "Ada Lovelace",
      publicationDate: "Apr 8, 2026",
      content: "Hello from X— Ada Lovelace Apr 8, 2026",
      status: "success",
    });
  });

  it("falls back to generic extraction for unsupported social URLs", async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.startsWith("https://publish.twitter.com/oembed")) {
        throw new Error("should not be called");
      }

      return createHtmlResponse(
        "<html><body><article><p>Generic page content</p></article></body></html>"
      );
    });

    const extractor = new WebExtractor({
      cache: {
        get: jest.fn(async () => undefined),
        set: jest.fn(async () => undefined),
        cleanup: jest.fn(async () => undefined),
        clear: jest.fn(async () => undefined),
      },
      fetchImpl,
      socialMediaExtractor: new SocialMediaExtractor({ fetchImpl }),
    } as any);

    const result = await extractor.extractUrlContent("https://instagram.com/p/abc123");

    expect(result.content).toContain("Generic page content");
    expect(result.status).toBe("success");
  });
});
