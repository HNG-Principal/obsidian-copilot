import {
  type ConversionMetadata,
  type ConversionOptions,
  type ConversionResult,
  type FileParser,
} from "./conversionTypes";
import { OcrFallbackParser, type VisionOcrCallback } from "./OcrFallbackParser";

const IMAGE_EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  webp: "image/webp",
};

const IMAGE_MIME_TYPES = Object.values(IMAGE_EXTENSION_TO_MIME_TYPE);
const SUPPORTED_IMAGE_EXTENSIONS = Object.keys(IMAGE_EXTENSION_TO_MIME_TYPE);

type OcrParserDelegate = Pick<FileParser, "parse" | "canHandle">;

/**
 * Dependencies required to construct an image parser instance.
 */
export interface ImageParserDependencies {
  visionOcr?: VisionOcrCallback;
  ocrParser?: OcrParserDelegate;
}

/**
 * Normalize a filename extension for MIME type lookup.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns Lower-cased extension without a leading period.
 */
function getNormalizedExtension(filename: string): string {
  const lastSegment = filename.split("/").pop() ?? filename;
  const extension = lastSegment.includes(".") ? (lastSegment.split(".").pop() ?? "") : "";
  return extension.replace(/^\./, "").toLowerCase();
}

/**
 * Infer the image MIME type from the original filename.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns Matching image MIME type when known, otherwise null.
 */
function inferMimeTypeFromFilename(filename: string): string | null {
  return IMAGE_EXTENSION_TO_MIME_TYPE[getNormalizedExtension(filename)] ?? null;
}

/**
 * Remove the trailing file extension from a filename for display metadata.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns Filename stem without the final extension.
 */
function getFilenameStem(filename: string): string {
  const lastSegment = filename.split("/").pop() ?? filename;
  return lastSegment.replace(/\.[^.]+$/, "");
}

/**
 * Count the number of words contained in converted markdown.
 *
 * @param content - Converted markdown content.
 * @returns Total number of non-whitespace tokens.
 */
function countWords(content: string): number {
  return content.match(/\S+/g)?.length ?? 0;
}

/**
 * Build fallback metadata for image conversion failures.
 *
 * @param filename - Original source filename.
 * @param content - Converted content accumulated before failure.
 * @param ocrUsed - Whether OCR execution was attempted.
 * @returns Conversion metadata aligned with the shared parser contract.
 */
function createMetadata(filename: string, content: string, ocrUsed: boolean): ConversionMetadata {
  return {
    title: getFilenameStem(filename),
    sourceFilename: filename,
    sourceFormat: "image",
    wordCount: countWords(content),
    conversionDate: new Date().toISOString(),
    ocrUsed,
  };
}

/**
 * Create a structured failure result when the file cannot be routed to OCR.
 *
 * @param filename - Original source filename.
 * @param message - Human-readable failure message.
 * @returns Structured conversion failure result.
 */
function createUnsupportedFormatResult(filename: string, message: string): ConversionResult {
  const content = "";

  return {
    status: "failure",
    content,
    metadata: createMetadata(filename, content, false),
    errors: [
      {
        code: "unsupported_format",
        message,
      },
    ],
  };
}

/**
 * Image parser that delegates directly to the OCR fallback parser so image files
 * are converted through the user's configured vision-capable LLM callback.
 */
export class ImageParser implements FileParser {
  public readonly formatId = "image" as const;
  public readonly supportedMimeTypes = [...IMAGE_MIME_TYPES];
  public readonly displayName = "Image Parser";

  private readonly ocrParser: OcrParserDelegate;

  /**
   * Create a new image parser with injected OCR dependencies.
   *
   * @param dependencies - Vision callback and optional OCR parser override for tests.
   */
  constructor(dependencies: ImageParserDependencies) {
    if (!dependencies.ocrParser && !dependencies.visionOcr) {
      throw new Error("ImageParser requires either an OCR parser or a vision OCR callback.");
    }

    this.ocrParser =
      dependencies.ocrParser ??
      new OcrFallbackParser({
        visionOcr: dependencies.visionOcr as VisionOcrCallback,
      });
  }

  /**
   * Check whether the parser supports a given image MIME type.
   *
   * @param mimeType - MIME type detected for the source image.
   * @returns True when the MIME type matches a supported image format.
   */
  public canHandle(mimeType: string): boolean {
    return this.supportedMimeTypes.includes(mimeType.toLowerCase());
  }

  /**
   * Convert an image file by routing it directly through the OCR fallback parser.
   *
   * @param fileBuffer - Raw image file bytes.
   * @param filename - Original source filename.
   * @param options - Shared conversion options forwarded to OCR.
   * @returns Structured OCR conversion output for the image.
   */
  public async parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult> {
    const mimeType = inferMimeTypeFromFilename(filename);
    if (!mimeType || !this.canHandle(mimeType)) {
      return createUnsupportedFormatResult(
        filename,
        `Unsupported image format for ${filename}. Supported extensions: ${SUPPORTED_IMAGE_EXTENSIONS.join(
          ", "
        )}.`
      );
    }

    if (!this.ocrParser.canHandle(mimeType)) {
      return createUnsupportedFormatResult(
        filename,
        `The OCR parser cannot handle image MIME type "${mimeType}" for ${filename}.`
      );
    }

    return await this.ocrParser.parse(fileBuffer, filename, options);
  }
}
