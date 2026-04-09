import { Buffer } from "buffer";

import {
  OcrFallbackParser,
  type OcrPageExtractor,
  type OcrPageInput,
  type VisionOcrCallback,
} from "@/tools/parsers/OcrFallbackParser";

const FIXED_CONVERSION_DATE = new Date("2024-04-05T06:07:08.000Z");

/**
 * Encode string content into an ArrayBuffer for deterministic OCR test fixtures.
 *
 * @param value - Fixture content to encode.
 * @returns ArrayBuffer containing exactly the encoded bytes.
 */
function createArrayBuffer(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength
  ) as ArrayBuffer;
}

/**
 * Build a synthetic OCR page payload for parser tests.
 *
 * @param value - Source bytes to embed in the page payload.
 * @param mimeType - MIME type associated with the synthetic page image.
 * @param pageNumber - Optional one-based page number override.
 * @returns OCR page input consumed by the parser.
 */
function createPage(value: string, mimeType: string, pageNumber?: number): OcrPageInput {
  return {
    buffer: createArrayBuffer(value),
    mimeType,
    pageNumber,
  };
}

describe("OcrFallbackParser", () => {
  let parser: OcrFallbackParser;
  let visionOcr: jest.MockedFunction<VisionOcrCallback>;
  let pageExtractor: jest.MockedFunction<OcrPageExtractor>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_CONVERSION_DATE);
    visionOcr = jest.fn();
    pageExtractor = jest.fn();
    parser = new OcrFallbackParser({ visionOcr, pageExtractor });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("passes extracted pages to the injected vision callback in page order", async () => {
    const fileBuffer = createArrayBuffer("source document");
    const options = { enableOcr: true, maxPages: 2 };

    pageExtractor.mockResolvedValue([
      createPage("second-page-bytes", "image/png", 2),
      createPage("first-page-bytes", "image/jpeg", 1),
    ]);
    visionOcr.mockResolvedValueOnce("# First page").mockResolvedValueOnce("Second page text");

    const result = await parser.parse(fileBuffer, "imports/report.pdf", options);

    expect(pageExtractor).toHaveBeenCalledWith({
      fileBuffer,
      filename: "imports/report.pdf",
      options,
    });
    expect(visionOcr).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filename: "imports/report.pdf",
        pageNumber: 1,
        totalPages: 2,
        mimeType: "image/jpeg",
        prompt: expect.stringContaining("Document: imports/report.pdf\nPage: 1 of 2"),
        imageDataUrl: `data:image/jpeg;base64,${Buffer.from("first-page-bytes").toString("base64")}`,
      })
    );
    expect(visionOcr).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filename: "imports/report.pdf",
        pageNumber: 2,
        totalPages: 2,
        mimeType: "image/png",
        prompt: expect.stringContaining("Document: imports/report.pdf\nPage: 2 of 2"),
        imageDataUrl: `data:image/png;base64,${Buffer.from("second-page-bytes").toString("base64")}`,
      })
    );
    expect(result.status).toBe("success");
    expect(result.content).toBe("## Page 1\n\n# First page\n\n## Page 2\n\nSecond page text");
  });

  it("returns structured markdown content and metadata for a successful OCR page", async () => {
    visionOcr.mockResolvedValue("```markdown\n# Receipt\n\nTotal due: $10\n```");

    const result = await parser.parsePages(
      [createPage("receipt-image", "image/png")],
      "Receipt.png"
    );

    expect(result).toEqual({
      status: "success",
      content: "# Receipt\n\nTotal due: $10",
      metadata: {
        title: "Receipt",
        sourceFilename: "Receipt.png",
        sourceFormat: "image",
        pageCount: 1,
        wordCount: 5,
        conversionDate: FIXED_CONVERSION_DATE.toISOString(),
        ocrUsed: true,
      },
      errors: [],
    });
  });

  it("returns a failure result when the vision callback rejects", async () => {
    visionOcr.mockRejectedValue(new Error("Vision provider unavailable"));

    const result = await parser.parsePages([createPage("broken-image", "image/png")], "broken.png");

    expect(result).toEqual({
      status: "failure",
      content: "",
      metadata: {
        title: "broken",
        sourceFilename: "broken.png",
        sourceFormat: "image",
        pageCount: 1,
        wordCount: 0,
        conversionDate: FIXED_CONVERSION_DATE.toISOString(),
        ocrUsed: true,
      },
      errors: [
        {
          code: "ocr_failed",
          message: "Vision provider unavailable",
          page: 1,
        },
      ],
    });
  });
});
