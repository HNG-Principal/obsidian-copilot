import { Buffer } from "buffer";
import {
  type ConversionError,
  type ConversionMetadata,
  type ConversionOptions,
  type ConversionResult,
  type FileParser,
  type SupportedFormat,
} from "./conversionTypes";

const OCR_PROMPT = [
  "You are performing OCR on a single document page.",
  "Extract only text that is visibly present in the image.",
  "Return clean markdown that preserves headings, paragraphs, lists, tables, and captions whenever they are visible.",
  "Format tables as markdown tables when possible.",
  "Do not add commentary, summaries, confidence notes, or code fences.",
  "If a region is unreadable, leave it out instead of inventing content.",
].join(" ");

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/webp",
] as const;

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  pdf: "application/pdf",
};

/**
 * Structured OCR page input consumed by the parser.
 */
export interface OcrPageInput {
  buffer: ArrayBuffer;
  mimeType: string;
  pageNumber?: number;
}

/**
 * Provider-agnostic OCR request payload passed to the injected vision callback.
 */
export interface VisionOcrRequest {
  prompt: string;
  filename: string;
  pageNumber: number;
  totalPages: number;
  mimeType: string;
  imageDataUrl: string;
}

/**
 * Injected vision-capable OCR callback used to process a single page image.
 */
export type VisionOcrCallback = (request: VisionOcrRequest) => Promise<string>;

/**
 * Input supplied to a page extractor when the parser needs page images.
 */
export interface OcrPageExtractionRequest {
  fileBuffer: ArrayBuffer;
  filename: string;
  options: ConversionOptions;
}

/**
 * Strategy used to derive OCR-ready page images from an input document.
 */
export type OcrPageExtractor = (request: OcrPageExtractionRequest) => Promise<OcrPageInput[]>;

/**
 * Constructor dependencies for the OCR fallback parser.
 */
export interface OcrFallbackParserDependencies {
  visionOcr: VisionOcrCallback;
  pageExtractor?: OcrPageExtractor;
}

/**
 * Normalize a filename extension for lookup operations.
 *
 * @param filename - Source filename that may contain an extension.
 * @returns Lower-cased extension without a leading period.
 */
function getNormalizedExtension(filename: string): string {
  const lastSegment = filename.split("/").pop() ?? filename;
  const extension = lastSegment.includes(".") ? (lastSegment.split(".").pop() ?? "") : "";
  return extension.replace(/^\./, "").toLowerCase();
}

/**
 * Infer the source format from a filename extension.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns Best-effort supported format classification.
 */
function getSourceFormat(filename: string): SupportedFormat {
  return getNormalizedExtension(filename) === "pdf" ? "pdf" : "image";
}

/**
 * Infer a MIME type from the provided filename.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns Matching MIME type when known, otherwise null.
 */
function inferMimeTypeFromFilename(filename: string): string | null {
  const extension = getNormalizedExtension(filename);
  return EXTENSION_TO_MIME_TYPE[extension] ?? null;
}

/**
 * Derive a display title from the original filename.
 *
 * @param filename - Original filename supplied by the caller.
 * @returns Human-friendly title without directories or file extension.
 */
function deriveTitleFromFilename(filename: string): string {
  const lastSegment = filename.split("/").pop() ?? filename;
  return lastSegment.replace(/\.[^/.]+$/, "");
}

/**
 * Count words in normalized markdown content.
 *
 * @param markdown - Markdown content returned by OCR.
 * @returns Total word count.
 */
function countWords(markdown: string): number {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return 0;
  }

  return trimmed.split(/\s+/).length;
}

/**
 * Remove accidental markdown code fences around model output.
 *
 * @param markdown - Raw markdown returned by the OCR callback.
 * @returns Sanitized markdown content ready for assembly.
 */
function normalizeMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }

  const fencedMatch = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return (fencedMatch?.[1] ?? trimmed).trim();
}

/**
 * Create the page-specific OCR prompt sent to the injected vision callback.
 *
 * @param filename - Source filename for user-facing context.
 * @param pageNumber - One-based page number currently being processed.
 * @param totalPages - Total number of pages in the OCR request.
 * @returns OCR prompt instructing the model to emit markdown only.
 */
function buildOcrPrompt(filename: string, pageNumber: number, totalPages: number): string {
  return `${OCR_PROMPT}\n\nDocument: ${filename}\nPage: ${pageNumber} of ${totalPages}`;
}

/**
 * Convert an image buffer into a provider-neutral data URL.
 *
 * @param page - Page image payload being sent to the vision callback.
 * @returns Base64 data URL for multimodal model input.
 */
function toImageDataUrl(page: OcrPageInput): string {
  return `data:${page.mimeType};base64,${Buffer.from(page.buffer).toString("base64")}`;
}

/**
 * Build shared conversion metadata for OCR results.
 *
 * @param filename - Original source filename.
 * @param sourceFormat - Source format associated with the OCR request.
 * @param pageCount - Total number of OCR pages processed.
 * @param content - Combined markdown content.
 * @returns Structured metadata for the conversion result.
 */
function createMetadata(
  filename: string,
  sourceFormat: SupportedFormat,
  pageCount: number,
  content: string
): ConversionMetadata {
  return {
    title: deriveTitleFromFilename(filename),
    sourceFilename: filename,
    sourceFormat,
    pageCount,
    wordCount: countWords(content),
    conversionDate: new Date().toISOString(),
    ocrUsed: true,
  };
}

/**
 * Create the default page extraction strategy for raw image files.
 *
 * @param request - OCR parsing request.
 * @returns Single-page OCR input derived from the original image file.
 */
async function defaultPageExtractor(request: OcrPageExtractionRequest): Promise<OcrPageInput[]> {
  const mimeType = inferMimeTypeFromFilename(request.filename);
  if (!mimeType || !IMAGE_MIME_TYPES.includes(mimeType as (typeof IMAGE_MIME_TYPES)[number])) {
    return [];
  }

  if (request.fileBuffer.byteLength === 0) {
    return [];
  }

  return [
    {
      buffer: request.fileBuffer,
      mimeType,
      pageNumber: 1,
    },
  ];
}

/**
 * OCR fallback parser that converts image pages to markdown using an injected
 * vision-capable LLM callback.
 */
export class OcrFallbackParser implements FileParser {
  public readonly formatId = "image" as const;
  public readonly displayName = "Vision OCR Fallback";
  public readonly supportedMimeTypes = [...IMAGE_MIME_TYPES];

  private readonly visionOcr: VisionOcrCallback;
  private readonly pageExtractor: OcrPageExtractor;

  /**
   * Create a new OCR fallback parser with injected dependencies.
   *
   * @param dependencies - Vision callback and optional page extraction strategy.
   */
  constructor(dependencies: OcrFallbackParserDependencies) {
    this.visionOcr = dependencies.visionOcr;
    this.pageExtractor = dependencies.pageExtractor ?? defaultPageExtractor;
  }

  /**
   * Determine whether the parser can consume the supplied MIME type directly.
   *
   * @param mimeType - MIME type detected for the input file.
   * @returns True when the OCR parser can directly handle the image MIME type.
   */
  public canHandle(mimeType: string): boolean {
    return this.supportedMimeTypes.includes(mimeType as (typeof IMAGE_MIME_TYPES)[number]);
  }

  /**
   * Parse a document by extracting OCR-ready page images and processing them
   * sequentially through the injected vision callback.
   *
   * @param fileBuffer - Raw file bytes for the source document.
   * @param filename - Original source filename.
   * @param options - OCR conversion options.
   * @returns Structured markdown conversion result.
   */
  public async parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult> {
    const pages = await this.pageExtractor({
      fileBuffer,
      filename,
      options,
    });

    return await this.parsePages(pages, filename);
  }

  /**
   * Parse already prepared page images in sequence.
   *
   * @param pages - OCR-ready page images.
   * @param filename - Original source filename used for metadata.
   * @returns Structured markdown conversion result assembled from page responses.
   */
  public async parsePages(pages: OcrPageInput[], filename: string): Promise<ConversionResult> {
    const normalizedPages = pages
      .filter((page) => page.buffer.byteLength > 0)
      .map((page, index) => ({
        ...page,
        pageNumber: page.pageNumber ?? index + 1,
      }))
      .sort((left, right) => (left.pageNumber ?? 0) - (right.pageNumber ?? 0));

    if (normalizedPages.length === 0) {
      const content = "";
      return {
        status: "failure",
        content,
        metadata: createMetadata(filename, getSourceFormat(filename), 0, content),
        errors: [
          {
            code: "ocr_failed",
            message: "No OCR-ready image pages were provided.",
          },
        ],
      };
    }

    const pageResults: string[] = [];
    const errors: ConversionError[] = [];
    const totalPages = normalizedPages.length;

    for (const page of normalizedPages) {
      const pageNumber = page.pageNumber ?? pageResults.length + 1;

      try {
        const response = await this.visionOcr({
          prompt: buildOcrPrompt(filename, pageNumber, totalPages),
          filename,
          pageNumber,
          totalPages,
          mimeType: page.mimeType,
          imageDataUrl: toImageDataUrl(page),
        });
        const markdown = normalizeMarkdown(response);

        if (!markdown) {
          errors.push({
            code: "ocr_failed",
            message: "The vision OCR callback returned no readable content.",
            page: pageNumber,
          });
          continue;
        }

        pageResults.push(totalPages > 1 ? `## Page ${pageNumber}\n\n${markdown}` : markdown);
      } catch (error) {
        errors.push({
          code: "ocr_failed",
          message: error instanceof Error ? error.message : String(error),
          page: pageNumber,
        });
      }
    }

    const content = pageResults.join("\n\n").trim();
    const metadata = createMetadata(filename, getSourceFormat(filename), totalPages, content);

    if (pageResults.length === 0) {
      return {
        status: "failure",
        content,
        metadata,
        errors,
      };
    }

    return {
      status: errors.length > 0 ? "partial" : "success",
      content,
      metadata,
      errors,
    };
  }
}
