/**
 * Shared document conversion contracts used by parser implementations and the
 * FileParserManager adapter layer.
 */

/** Supported source formats for local document conversion. */
export const SUPPORTED_FORMATS = ["pdf", "docx", "pptx", "xlsx", "csv", "epub", "image"] as const;

/** Supported document format identifier. */
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

/** Error codes surfaced by the document conversion pipeline. */
export const CONVERSION_ERROR_CODES = [
  "unsupported_format",
  "file_too_large",
  "password_protected",
  "corrupt_file",
  "ocr_failed",
  "timeout",
  "parse_error",
  "unknown",
] as const;

/** Stable conversion error code identifier. */
export type ConversionErrorCode = (typeof CONVERSION_ERROR_CODES)[number];

/**
 * Options controlling how a document should be converted.
 *
 * Properties remain optional so callers can pass partial overrides while
 * higher-level orchestration layers apply defaults from settings.
 */
export interface ConversionOptions {
  enableOcr?: boolean;
  saveToVault?: boolean;
  outputFolder?: string;
  maxPages?: number;
  absoluteFilePath?: string;
}

/** Metadata extracted or computed during conversion. */
export interface ConversionMetadata {
  title?: string;
  sourceFilename: string;
  sourceFormat: SupportedFormat;
  pageCount?: number;
  wordCount: number;
  conversionDate: string;
  ocrUsed: boolean;
}

/** A structured error raised during document conversion. */
export interface ConversionError {
  code: ConversionErrorCode;
  message: string;
  page?: number;
}

/** Persisted markdown artifact produced from a converted document. */
export interface ConvertedDocument {
  markdownPath: string;
  sourceFilename: string;
  sourceFormat: SupportedFormat;
  conversionDate: string;
}

/** Structured output returned by all new parser implementations. */
export interface ConversionResult {
  status: "success" | "partial" | "failure";
  content: string;
  metadata: ConversionMetadata;
  errors: ConversionError[];
}

/**
 * New typed parser contract for local document conversion.
 *
 * Note: this intentionally differs from the legacy `FileParser` interface in
 * `src/tools/FileParserManager.ts`, which is adapted separately.
 */
export interface FileParser {
  readonly formatId: SupportedFormat;
  readonly supportedMimeTypes: string[];
  readonly displayName: string;

  /**
   * Convert raw file content into normalized markdown output.
   *
   * @param fileBuffer - Raw file bytes for the source document.
   * @param filename - Original source filename used for metadata and logging.
   * @param options - Conversion behavior overrides supplied by the caller.
   * @returns A structured conversion result containing markdown, metadata, and errors.
   */
  parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Check whether this parser can handle the provided MIME type.
   *
   * @param mimeType - MIME type detected for the source document.
   * @returns True when the parser supports the provided MIME type.
   */
  canHandle(mimeType: string): boolean;
}
