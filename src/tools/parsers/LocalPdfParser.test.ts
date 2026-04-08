import type { LocalPdfParserDependencies } from "./LocalPdfParser";
import { LocalPdfParser } from "./LocalPdfParser";

const FIXED_CONVERSION_DATE = new Date("2024-04-05T06:07:08.000Z");

type PdfParseMock = NonNullable<LocalPdfParserDependencies["pdfParse"]>;
type PdfParseOptions = Parameters<PdfParseMock>[1];
type PdfPageData = Parameters<PdfParseOptions["pagerender"]>[0];

interface TestTextItem {
  text: string;
  x: number;
  y: number;
  width?: number;
}

interface TestPage {
  items: TestTextItem[];
}

interface TestPdfDocument {
  pages: TestPage[];
  numpages?: number;
  info?: {
    Title?: string;
  } | null;
}

/**
 * Create a stable binary payload to simulate a non-empty PDF file.
 *
 * @returns ArrayBuffer accepted by the parser under test.
 */
function createPdfBuffer(): ArrayBuffer {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
}

/**
 * Convert lightweight test text items into the shape expected by pdf.js.
 *
 * @param items - Positioned text fragments for a synthetic page.
 * @returns Page object compatible with LocalPdfParser's pagerender callback.
 */
function createPageData(items: TestTextItem[]): PdfPageData {
  return {
    getTextContent: jest.fn(async () => ({
      items: items.map((item) => ({
        str: item.text,
        transform: [1, 0, 0, 1, item.x, item.y],
        width: item.width,
      })),
    })),
  };
}

/**
 * Build a deterministic pdf-parse mock that drives the parser through its
 * pagerender callback using synthetic page layout data.
 *
 * @param document - Structured document definition for the test case.
 * @returns Mock pdf-parse implementation.
 */
function createPdfParseMock(document: TestPdfDocument): jest.MockedFunction<PdfParseMock> {
  return jest.fn(async (_buffer, options) => {
    const renderedPages: string[] = [];

    for (const page of document.pages) {
      renderedPages.push(await options.pagerender(createPageData(page.items)));
    }

    return {
      numpages: document.numpages ?? document.pages.length,
      numrender: document.pages.length,
      info: document.info ?? null,
      text: renderedPages.join(""),
    };
  });
}

describe("LocalPdfParser", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_CONVERSION_DATE);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("extracts text content in reading order", async () => {
    const pdfParse = createPdfParseMock({
      pages: [
        {
          items: [
            { text: "Hello", x: 10, y: 700, width: 20 },
            { text: "world", x: 40, y: 700, width: 20 },
            { text: "Second", x: 10, y: 680, width: 24 },
            { text: "line", x: 40, y: 680, width: 14 },
          ],
        },
      ],
    });
    const parser = new LocalPdfParser({ pdfParse });

    const result = await parser.parse(createPdfBuffer(), "meeting-notes.pdf", {});

    expect(result).toEqual({
      status: "success",
      content: "Hello world\n\nSecond line",
      metadata: {
        title: "meeting-notes",
        sourceFilename: "meeting-notes.pdf",
        sourceFormat: "pdf",
        pageCount: 1,
        wordCount: 4,
        conversionDate: FIXED_CONVERSION_DATE.toISOString(),
        ocrUsed: false,
      },
      errors: [],
    });
  });

  it("converts aligned rows into a markdown table", async () => {
    const pdfParse = createPdfParseMock({
      pages: [
        {
          items: [
            { text: "Name", x: 10, y: 700, width: 28 },
            { text: "Role", x: 80, y: 700, width: 24 },
            { text: "Score", x: 150, y: 700, width: 30 },
            { text: "Ada", x: 10, y: 680, width: 18 },
            { text: "Engineer", x: 80, y: 680, width: 40 },
            { text: "42", x: 150, y: 680, width: 12 },
            { text: "Grace", x: 10, y: 660, width: 26 },
            { text: "Scientist", x: 80, y: 660, width: 42 },
            { text: "99", x: 150, y: 660, width: 12 },
          ],
        },
      ],
    });
    const parser = new LocalPdfParser({ pdfParse });

    const result = await parser.parse(createPdfBuffer(), "scorecard.pdf", {});

    expect(result.status).toBe("success");
    expect(result.content).toBe(
      "| Name | Role | Score |\n| --- | --- | --- |\n| Ada | Engineer | 42 |\n| Grace | Scientist | 99 |"
    );
    expect(result.errors).toEqual([]);
  });

  it("returns a failure for empty PDF buffers without calling pdf-parse", async () => {
    const pdfParse = createPdfParseMock({
      pages: [],
    });
    const parser = new LocalPdfParser({ pdfParse });

    const result = await parser.parse(new ArrayBuffer(0), "empty.pdf", {});

    expect(pdfParse).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "failure",
      content: "",
      metadata: {
        title: "empty",
        sourceFilename: "empty.pdf",
        sourceFormat: "pdf",
        pageCount: 0,
        wordCount: 0,
        conversionDate: FIXED_CONVERSION_DATE.toISOString(),
        ocrUsed: false,
      },
      errors: [
        {
          code: "parse_error",
          message: "The PDF file is empty.",
        },
      ],
    });
  });

  it("returns page-level parse errors for scanned PDFs with no extractable text", async () => {
    const pdfParse = createPdfParseMock({
      pages: [{ items: [] }, { items: [] }],
    });
    const parser = new LocalPdfParser({ pdfParse });

    const result = await parser.parse(createPdfBuffer(), "scanned-document.pdf", {});

    expect(result).toEqual({
      status: "failure",
      content: "",
      metadata: {
        title: "scanned-document",
        sourceFilename: "scanned-document.pdf",
        sourceFormat: "pdf",
        pageCount: 2,
        wordCount: 0,
        conversionDate: FIXED_CONVERSION_DATE.toISOString(),
        ocrUsed: false,
      },
      errors: [
        {
          code: "parse_error",
          message: "No extractable text was found on the page.",
          page: 1,
        },
        {
          code: "parse_error",
          message: "No extractable text was found on the page.",
          page: 2,
        },
      ],
    });
  });

  it("reports accurate metadata from the parsed document", async () => {
    const pdfParse = createPdfParseMock({
      pages: [
        {
          items: [{ text: "Alpha beta gamma", x: 10, y: 700, width: 80 }],
        },
      ],
      numpages: 4,
      info: {
        Title: "  Quarterly Report  ",
      },
    });
    const parser = new LocalPdfParser({ pdfParse });

    const result = await parser.parse(createPdfBuffer(), "project-summary.pdf", {
      maxPages: 1,
    });

    expect(pdfParse).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ max: 1 }));
    expect(result.status).toBe("success");
    expect(result.content).toBe("Alpha beta gamma");
    expect(result.metadata).toEqual({
      title: "Quarterly Report",
      sourceFilename: "project-summary.pdf",
      sourceFormat: "pdf",
      pageCount: 4,
      wordCount: 3,
      conversionDate: FIXED_CONVERSION_DATE.toISOString(),
      ocrUsed: false,
    });
    expect(result.errors).toEqual([]);
  });
});
