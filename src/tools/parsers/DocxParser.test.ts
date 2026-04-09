const mockConvertToHtml = jest.fn();

jest.mock("mammoth", () => ({
  __esModule: true,
  default: {
    convertToHtml: mockConvertToHtml,
  },
}));

import { DocxParser } from "./DocxParser";

describe("DocxParser", () => {
  const parser = new DocxParser();
  const fileBuffer = new ArrayBuffer(8);
  const options = {};

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-01-02T03:04:05.000Z"));
    mockConvertToHtml.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("preserves heading hierarchy in the generated markdown", async () => {
    mockConvertToHtml.mockResolvedValue({
      value: "<h1>Document Title</h1><h2>Section Heading</h2><h3>Nested Heading</h3>",
      messages: [],
    });

    const result = await parser.parse(fileBuffer, "outline.docx", options);

    expect(result).toEqual({
      status: "success",
      content: "# Document Title\n\n## Section Heading\n\n### Nested Heading",
      metadata: {
        title: "Document Title",
        sourceFilename: "outline.docx",
        sourceFormat: "docx",
        wordCount: 9,
        conversionDate: "2025-01-02T03:04:05.000Z",
        ocrUsed: false,
      },
      errors: [],
    });
  });

  it("preserves list formatting and bold or italic emphasis", async () => {
    mockConvertToHtml.mockResolvedValue({
      value: `
        <ul>
          <li>First bullet</li>
          <li>Second bullet</li>
        </ul>
        <ol>
          <li>First numbered</li>
          <li><strong>Bold item</strong> and <em>italic text</em></li>
        </ol>
        <p><strong>Bold text</strong> and <em>italic text</em></p>
      `,
      messages: [],
    });

    const result = await parser.parse(fileBuffer, "formatting.docx", options);

    expect(result.status).toBe("success");
    expect(result.content).toBe(
      [
        "-   First bullet",
        "-   Second bullet",
        "",
        "1.  First numbered",
        "2.  **Bold item** and *italic text*",
        "",
        "**Bold text** and *italic text*",
      ].join("\n")
    );
    expect(result.metadata).toMatchObject({
      title: "formatting",
      sourceFilename: "formatting.docx",
      sourceFormat: "docx",
      wordCount: 20,
      conversionDate: "2025-01-02T03:04:05.000Z",
      ocrUsed: false,
    });
    expect(result.errors).toEqual([]);
  });

  it("returns a failure when the document has no extractable content", async () => {
    mockConvertToHtml.mockResolvedValue({
      value: "   ",
      messages: [],
    });

    const result = await parser.parse(fileBuffer, "empty.docx", options);

    expect(result).toEqual({
      status: "failure",
      content: "",
      metadata: {
        title: "empty",
        sourceFilename: "empty.docx",
        sourceFormat: "docx",
        wordCount: 0,
        conversionDate: "2025-01-02T03:04:05.000Z",
        ocrUsed: false,
      },
      errors: [
        {
          code: "parse_error",
          message: "No extractable content was found in empty.docx.",
        },
      ],
    });
  });
});
