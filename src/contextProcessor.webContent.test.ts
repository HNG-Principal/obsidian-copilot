jest.mock("@/aiParams", () => ({
  getSelectedTextContexts: jest.fn(),
}));

jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(),
}));

jest.mock("@/tools/FileParserManager", () => ({
  FileParserManager: class {},
}));

import { buildWebContentContextBlock } from "./contextProcessor";

describe("buildWebContentContextBlock", () => {
  it("wraps extracted content in a web-content block", () => {
    const block = buildWebContentContextBlock({
      url: "https://example.com/article",
      title: "Example Article",
      author: "Ada Lovelace",
      content: "Main content",
      status: "success",
      extractedAt: 1700000000000,
      byteLength: 42,
    });

    expect(block).toContain("<web-content");
    expect(block).toContain('url="https://example.com/article"');
    expect(block).toContain('title="Example Article"');
    expect(block).toContain("Main content");
  });

  it("adds a truncation notice when the content exceeds the context cap", () => {
    const block = buildWebContentContextBlock(
      {
        url: "https://example.com/article",
        content: "Long content ".repeat(400),
        status: "success",
        extractedAt: 1700000000000,
        byteLength: 4000,
      },
      300
    );

    expect(block).toContain('status="partial"');
    expect(block).toContain("[Content truncated to fit the context window.]");
  });
});
