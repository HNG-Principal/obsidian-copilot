import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { ProjectConfig } from "@/aiParams";
import { PDFCache } from "@/cache/pdfCache";
import { ProjectContextCache } from "@/cache/projectContextCache";
import { ModelCapability } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import { isSelfHostModeValid } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import { saveConvertedDocOutput as saveConvertedDocOutputCore } from "@/utils/convertedDocOutput";
import { extractRetryTime, isRateLimitError } from "@/utils/rateLimitUtils";
import { FileSystemAdapter, Notice, TFile, Vault } from "obsidian";
import { CanvasLoader } from "./CanvasLoader";
import { DocxParser } from "./parsers/DocxParser";
import { EpubParser } from "./parsers/EpubParser";
import { ImageParser } from "./parsers/ImageParser";
import { LocalPdfParser } from "./parsers/LocalPdfParser";
import { OcrFallbackParser, type VisionOcrCallback } from "./parsers/OcrFallbackParser";
import { PptxParser } from "./parsers/PptxParser";
import { XlsxParser } from "./parsers/XlsxParser";
import {
  SUPPORTED_FORMATS,
  type ConversionError,
  type ConversionMetadata,
  type ConversionOptions,
  type ConversionResult,
  type FileParser as TypedFileParser,
  type SupportedFormat,
} from "./parsers/conversionTypes";

export interface ParsedFileResult {
  content: string;
  metadata: ConversionMetadata;
}

interface LegacyFileParser {
  supportedExtensions: string[];
  parseFile: (file: TFile, vault: Vault) => Promise<string>;
  parseFileWithMetadata?: (file: TFile, vault: Vault) => Promise<ParsedFileResult>;
}

const OCR_FALLBACK_MIN_CONTENT_LENGTH = 50;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * Error subtype used to surface structured conversion failures while preserving
 * compatibility with existing `Error`-based catch blocks.
 */
class TypedConversionError extends Error implements ConversionError {
  public readonly code: ConversionError["code"];
  public readonly page?: number;
  public readonly sourceFilename?: string;

  /**
   * Create a new typed conversion error instance.
   *
   * @param error - Structured conversion error details.
   */
  constructor(error: ConversionError, sourceFilename?: string) {
    super(error.message);
    this.name = "TypedConversionError";
    this.code = error.code;
    this.page = error.page;
    this.sourceFilename = sourceFilename;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Create a typed conversion error with consistent file metadata attached.
 *
 * @param error - Structured conversion error details.
 * @param sourceFilename - Optional source filename for user-facing display.
 * @returns Typed conversion error instance.
 */
function createTypedConversionError(
  error: ConversionError,
  sourceFilename?: string
): TypedConversionError {
  return new TypedConversionError(error, sourceFilename);
}

const EXTENSION_TO_FORMAT: Record<string, SupportedFormat> = {
  pdf: "pdf",
  doc: "docx",
  docx: "docx",
  ppt: "pptx",
  pptx: "pptx",
  xls: "xlsx",
  xlsx: "xlsx",
  csv: "csv",
  tsv: "csv",
  epub: "epub",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  bmp: "image",
  tiff: "image",
  webp: "image",
  svg: "image",
};

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  epub: "application/epub+zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Normalize a file extension for parser registration and lookup.
 *
 * @param extension - Raw extension value from a file or caller.
 * @returns Lower-cased extension without a leading period.
 */
function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, "").toLowerCase();
}

/**
 * Resolve the MIME type associated with a file extension.
 *
 * @param extension - File extension to resolve.
 * @returns Matching MIME type when known, otherwise application/octet-stream.
 */
function getMimeTypeForExtension(extension: string): string {
  return EXTENSION_TO_MIME_TYPE[normalizeExtension(extension)] ?? "application/octet-stream";
}

/**
 * Resolve the shared document format associated with a file extension.
 *
 * @param extension - File extension to resolve.
 * @returns Matching shared format identifier when known, otherwise null.
 */
function getFormatForExtension(extension: string): SupportedFormat | null {
  return EXTENSION_TO_FORMAT[normalizeExtension(extension)] ?? null;
}

/**
 * Infer legacy file extensions for a typed parser based on MIME support.
 *
 * @param parser - Typed parser being exposed through the legacy contract.
 * @returns All matching file extensions for parser registration.
 */
function getExtensionsForTypedParser(parser: TypedFileParser): string[] {
  const matchingExtensions = Object.entries(EXTENSION_TO_MIME_TYPE)
    .filter(([, mimeType]) => parser.canHandle(mimeType))
    .map(([extension]) => extension);

  if (matchingExtensions.length > 0) {
    return matchingExtensions;
  }

  return Object.entries(EXTENSION_TO_FORMAT)
    .filter(([, format]) => format === parser.formatId)
    .map(([extension]) => extension);
}

/**
 * Extract legacy string content from a typed conversion result.
 *
 * @param result - Structured conversion result returned by a typed parser.
 * @param file - Source file currently being converted.
 * @returns Legacy string content expected by existing callers.
 */
function extractContentFromConversionResult(result: ConversionResult, file: TFile): string {
  if (result.content.trim().length > 0) {
    return result.content;
  }

  const firstError = result.errors[0];
  if (firstError) {
    return `[Error: Could not extract content from ${file.basename}. ${firstError.message}]`;
  }

  return "";
}

/**
 * Count non-whitespace tokens in converted content.
 *
 * @param content - Converted content string to analyze.
 * @returns Approximate word count for metadata fallback usage.
 */
function countWords(content: string): number {
  return content.match(/\S+/g)?.length ?? 0;
}

/**
 * Extract plain text from a model response that may be text-only or multimodal.
 *
 * @param content - Response content returned by the active chat model.
 * @returns Concatenated text content with image blocks removed.
 */
function extractTextFromModelResponseContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (
          item
        ): item is {
          type: string;
          text?: string;
        } => Boolean(item) && typeof item === "object" && "type" in item
      )
      .filter((item) => item.type === "text")
      .map((item) => item.text?.trim() ?? "")
      .filter((item) => item.length > 0)
      .join("\n\n")
      .trim();
  }

  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text.trim() : "";
  }

  return "";
}

/**
 * Check whether the current chat model supports multimodal image inputs.
 *
 * @param chatModelManager - Active chat model manager singleton.
 * @returns True when the current model advertises vision capability.
 */
function currentModelSupportsVision(chatModelManager: ChatModelManager): boolean {
  const chatModel = chatModelManager.getChatModel();
  const modelName = (chatModel as { modelName?: string; model?: string }).modelName ?? "";
  const fallbackModelName =
    modelName || (chatModel as { modelName?: string; model?: string }).model || "";
  const customModel = chatModelManager.findModelByName(fallbackModelName);

  return customModel?.capabilities?.includes(ModelCapability.VISION) ?? false;
}

/**
 * Create an OCR callback backed by the user's currently selected chat model.
 *
 * @param chatModelManager - Active chat model manager singleton.
 * @returns Vision OCR callback suitable for the typed OCR parsers.
 */
function createVisionOcrCallback(chatModelManager: ChatModelManager): VisionOcrCallback {
  return async ({ prompt, imageDataUrl }) => {
    if (!currentModelSupportsVision(chatModelManager)) {
      throw new Error("The current model does not support vision input required for OCR.");
    }

    const response = await chatModelManager.getChatModel().invoke([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUrl,
            },
          },
        ],
      },
    ]);
    const responseText = extractTextFromModelResponseContent(
      (response as { content?: unknown }).content
    );

    if (!responseText) {
      throw new Error("The vision OCR callback returned no readable content.");
    }

    return responseText;
  };
}

/**
 * Build metadata when the active parser only exposes legacy string content.
 *
 * @param file - Source file being parsed.
 * @param content - Converted content returned by the parser.
 * @returns Best-effort metadata for context wrapping.
 */
function createFallbackMetadata(file: TFile, content: string): ConversionMetadata {
  const sourceFormat = getFormatForExtension(file.extension);
  if (!sourceFormat) {
    throw new Error(`No conversion metadata mapping found for file type: ${file.extension}`);
  }

  return {
    title: file.basename,
    sourceFilename: file.name,
    sourceFormat,
    wordCount: countWords(content),
    conversionDate: new Date().toISOString(),
    ocrUsed: false,
  };
}

/**
 * Normalize parser metadata so callers always receive content-aligned values.
 *
 * @param file - Source file being parsed.
 * @param content - Final content returned to callers.
 * @param metadata - Metadata emitted by the parser.
 * @returns Metadata patched with stable filename and word-count values.
 */
function normalizeParsedFileMetadata(
  file: TFile,
  content: string,
  metadata: ConversionMetadata
): ConversionMetadata {
  return {
    ...metadata,
    title: metadata.title ?? file.basename,
    sourceFilename: metadata.sourceFilename || file.name,
    wordCount: metadata.wordCount > 0 ? metadata.wordCount : countWords(content),
  };
}

/**
 * Determine whether OCR fallback should be attempted.
 *
 * @param result - Result returned by the primary parser.
 * @param options - Conversion options provided to the parser.
 * @returns True when OCR fallback should run.
 */
function shouldTriggerOcrFallback(result: ConversionResult, options: ConversionOptions): boolean {
  return (
    options.enableOcr !== false &&
    result.content.trim().length < OCR_FALLBACK_MIN_CONTENT_LENGTH &&
    (result.metadata.pageCount ?? 0) > 1
  );
}

/**
 * Format a byte size as a human-readable megabyte string.
 *
 * @param sizeInBytes - Raw byte size to format.
 * @returns Rounded megabyte string without unnecessary trailing decimals.
 */
function formatFileSizeInMegabytes(sizeInBytes: number): string {
  const sizeInMegabytes = sizeInBytes / BYTES_PER_MEGABYTE;
  return Number.isInteger(sizeInMegabytes)
    ? String(sizeInMegabytes)
    : sizeInMegabytes.toFixed(1).replace(/\.0$/, "");
}

/**
 * Build the typed error raised when a file exceeds the configured conversion limit.
 *
 * @param file - Source file rejected by validation.
 * @param maxFileSizeMB - Configured maximum file size in megabytes.
 * @returns Structured error wrapped in an `Error` subtype for legacy callers.
 */
function createFileTooLargeError(file: TFile, maxFileSizeMB: number): TypedConversionError {
  return createTypedConversionError(
    {
      code: "file_too_large",
      message: `File "${file.name}" is ${formatFileSizeInMegabytes(
        file.stat.size
      )} MB, which exceeds the configured limit of ${maxFileSizeMB} MB.`,
    },
    file.name
  );
}

/**
 * Build the typed error raised when a file extension is routed to a parser that
 * cannot actually handle the detected MIME type.
 *
 * @param file - Source file rejected by MIME validation.
 * @param mimeType - Detected MIME type for the source file.
 * @param parserName - Human-readable parser name used for diagnostics.
 * @returns Structured unsupported-format error.
 */
function createUnsupportedFormatError(
  file: TFile,
  mimeType: string,
  parserName: string
): TypedConversionError {
  return createTypedConversionError(
    {
      code: "unsupported_format",
      message: `${file.name} could not be parsed because MIME type "${mimeType}" is not supported by ${parserName}.`,
    },
    file.name
  );
}

/**
 * Select the most actionable conversion error from a parser result.
 *
 * @param result - Structured conversion result returned by a typed parser.
 * @param file - Source file being converted.
 * @returns Structured conversion error suitable for propagation.
 */
function getPrimaryConversionError(result: ConversionResult, file: TFile): ConversionError {
  return (
    result.errors[0] ?? {
      code: "parse_error",
      message: `Copilot could not extract readable content from ${file.name}.`,
    }
  );
}

/**
 * Reject files that exceed the configured local conversion size limit.
 *
 * @param file - Source file being parsed.
 * @param maxFileSizeMB - Maximum allowed file size in megabytes.
 */
function validateFileSize(file: TFile, maxFileSizeMB: number): void {
  const maxFileSizeBytes = maxFileSizeMB * BYTES_PER_MEGABYTE;
  if (file.stat.size > maxFileSizeBytes) {
    throw createFileTooLargeError(file, maxFileSizeMB);
  }
}

/**
 * Adapter that bridges the new typed parser contract into the legacy local
 * `parseFile(file, vault)` interface used throughout the plugin.
 */
class TypedParserAdapter implements LegacyFileParser {
  public readonly supportedExtensions: string[];
  private readonly parser: TypedFileParser;
  private readonly getOcrFallbackParser: () => TypedFileParser | null;
  private readonly pdfCache: PDFCache | null;

  /**
   * Create a new adapter for a typed parser implementation.
   *
   * @param parser - Typed parser to expose through the legacy interface.
   * @param getOcrFallbackParser - Lazy accessor for the OCR fallback parser.
   */
  constructor(parser: TypedFileParser, getOcrFallbackParser: () => TypedFileParser | null) {
    this.parser = parser;
    this.getOcrFallbackParser = getOcrFallbackParser;
    this.supportedExtensions = getExtensionsForTypedParser(parser);
    this.pdfCache = parser.formatId === "pdf" ? PDFCache.getInstance() : null;
  }

  /**
   * Convert a vault file by reading its binary bytes and delegating to the
   * typed parser contract.
   *
   * @param file - Source file to convert.
   * @param vault - Obsidian vault instance used to read file bytes.
   * @returns Extracted markdown content for legacy callers.
   */
  async parseFile(file: TFile, vault: Vault): Promise<string> {
    const parsedFile = await this.parseFileWithMetadata(file, vault);
    return parsedFile.content;
  }

  /**
   * Convert a vault file and preserve the structured metadata emitted by typed
   * parsers when available.
   *
   * @param file - Source file to convert.
   * @param vault - Obsidian vault instance used to read file bytes.
   * @returns Converted content plus best-effort metadata for context injection.
   */
  async parseFileWithMetadata(file: TFile, vault: Vault): Promise<ParsedFileResult> {
    if (this.pdfCache) {
      const cachedResponse = await this.pdfCache.get(file);
      if (cachedResponse) {
        return {
          content: cachedResponse.response,
          metadata: createFallbackMetadata(file, cachedResponse.response),
        };
      }
    }

    const fileBuffer = await vault.readBinary(file);
    const mimeType = getMimeTypeForExtension(file.extension);
    const options: ConversionOptions = {
      absoluteFilePath: resolveAbsoluteFilePath(file, vault) ?? undefined,
    };

    if (!this.parser.canHandle(mimeType)) {
      throw createUnsupportedFormatError(file, mimeType, this.parser.displayName);
    }

    const primaryResult = await this.parser.parse(fileBuffer, file.name, options);
    const primaryContent = extractContentFromConversionResult(primaryResult, file);
    let finalResult = primaryResult;
    let finalContent = primaryContent;
    let finalMetadata = normalizeParsedFileMetadata(file, primaryContent, primaryResult.metadata);

    if (shouldTriggerOcrFallback(primaryResult, options)) {
      const ocrFallbackParser = this.getOcrFallbackParser();
      if (ocrFallbackParser) {
        try {
          const ocrResult = await ocrFallbackParser.parse(fileBuffer, file.name, {
            ...options,
            enableOcr: true,
          });
          const ocrContent = extractContentFromConversionResult(ocrResult, file);
          if (ocrContent.trim().length > 0) {
            finalResult = ocrResult;
            finalContent = ocrContent;
            finalMetadata = normalizeParsedFileMetadata(file, ocrContent, ocrResult.metadata);
          } else if (ocrResult.status === "failure" || ocrResult.errors.length > 0) {
            throw createTypedConversionError(getPrimaryConversionError(ocrResult, file), file.name);
          }
        } catch (error) {
          logWarn(`[TypedParserAdapter] OCR fallback failed for ${file.path}: ${String(error)}`);
          if (error instanceof TypedConversionError) {
            throw error;
          }
        }
      }
    }

    if (
      finalResult.status === "failure" ||
      (finalContent.trim().length === 0 && finalResult.errors.length > 0)
    ) {
      throw createTypedConversionError(getPrimaryConversionError(finalResult, file), file.name);
    }

    if (this.pdfCache && finalContent.trim().length > 0 && !finalContent.startsWith("[Error:")) {
      await this.pdfCache.set(file, {
        response: finalContent,
        elapsed_time_ms: 0,
      });
      await saveConvertedDocOutput(file, finalContent, vault);
    }

    return {
      content: finalContent,
      metadata: finalMetadata,
    };
  }

  /**
   * Clear any parser-specific cache maintained by the adapter.
   *
   * @returns Promise resolved once cache clearing is complete.
   */
  async clearCache(): Promise<void> {
    if (this.pdfCache) {
      await this.pdfCache.clear();
    }
  }
}

/**
 * Thin wrapper that reads the output folder from settings and delegates to the pure function.
 */
export async function saveConvertedDocOutput(
  file: TFile,
  content: string,
  vault: Vault
): Promise<void> {
  const outputFolder = getSettings().convertedDocOutputFolder;
  await saveConvertedDocOutputCore(file, content, vault, outputFolder);
}

/**
 * Resolve absolute file path for a vault file when supported by the adapter.
 *
 * @param file - Target file.
 * @param vault - Obsidian vault instance.
 * @returns Absolute file path or null when unavailable.
 */
function resolveAbsoluteFilePath(file: TFile, vault: Vault): string | null {
  const adapter = vault.adapter;
  if (!adapter) {
    return null;
  }

  if (typeof FileSystemAdapter !== "undefined" && adapter instanceof FileSystemAdapter) {
    return adapter.getFullPath(file.path);
  }

  const adapterAny = adapter as unknown as { getFullPath?: (normalizedPath: string) => string };
  if (typeof adapterAny.getFullPath === "function") {
    return adapterAny.getFullPath(file.path);
  }

  return null;
}

/** Result from SelfHostPdfParser: null = not applicable, { content } = success, { error } = tried and failed. */
type MiyoParseResult = { content: string } | { error: string } | null;

/**
 * Self-host PDF parser bridge using Miyo parse-doc endpoint.
 */
class SelfHostPdfParser {
  private miyoClient: MiyoClient;

  /**
   * Create a new self-host PDF parser.
   */
  constructor() {
    this.miyoClient = new MiyoClient();
  }

  /**
   * Parse a PDF via Miyo when self-host mode is active.
   *
   * @param file - PDF file to parse.
   * @param vault - Obsidian vault instance.
   * @returns Content on success, error reason on failure, or null when not applicable.
   */
  public async parsePdf(file: TFile, vault: Vault): Promise<MiyoParseResult> {
    const settings = getSettings();
    if (!settings.enableMiyo || file.extension.toLowerCase() !== "pdf") {
      return null;
    }

    const absolutePath = resolveAbsoluteFilePath(file, vault);
    if (!absolutePath) {
      return { error: "Could not resolve absolute file path for Miyo parse-doc" };
    }

    try {
      const baseUrl = await this.miyoClient.resolveBaseUrl(getMiyoCustomUrl(settings));
      const response = await this.miyoClient.parseDoc(baseUrl, absolutePath);
      if (typeof response.text !== "string" || response.text.trim().length === 0) {
        return { error: "Miyo parse-doc returned empty text" };
      }

      logInfo(`[SelfHostPdfParser] Parsed PDF via Miyo: ${file.path}`);
      return { content: response.text };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logWarn(`[SelfHostPdfParser] Failed to parse ${file.path} via Miyo parse-doc: ${reason}`);
      return { error: reason };
    }
  }
}

export class MarkdownParser implements LegacyFileParser {
  supportedExtensions = ["md", "base"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    return await vault.read(file);
  }
}

export class PDFParser implements LegacyFileParser {
  supportedExtensions = ["pdf"];
  private brevilabsClient: BrevilabsClient;
  private pdfCache: PDFCache;
  private selfHostPdfParser: SelfHostPdfParser;

  constructor(brevilabsClient: BrevilabsClient) {
    this.brevilabsClient = brevilabsClient;
    this.pdfCache = PDFCache.getInstance();
    this.selfHostPdfParser = new SelfHostPdfParser();
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo("Parsing PDF file:", file.path);

      // Try to get from cache first
      const cachedResponse = await this.pdfCache.get(file);
      if (cachedResponse) {
        logInfo("Using cached PDF content for:", file.path);
        // Ensure output file exists even on cache hit (user may have just enabled the setting)
        await saveConvertedDocOutput(file, cachedResponse.response, vault);
        return cachedResponse.response;
      }

      const settings = getSettings();
      if (isSelfHostModeValid() && settings.enableMiyo && file.extension.toLowerCase() === "pdf") {
        const miyoResult = await this.selfHostPdfParser.parsePdf(file, vault);
        if (miyoResult && "content" in miyoResult) {
          await this.pdfCache.set(file, {
            response: miyoResult.content,
            elapsed_time_ms: 0,
          });
          await saveConvertedDocOutput(file, miyoResult.content, vault);
          return miyoResult.content;
        }

        if (miyoResult && "error" in miyoResult) {
          // Self-host mode: do NOT fall back to cloud API to preserve privacy.
          logWarn(`[PDFParser] Miyo parse failed for ${file.path}: ${miyoResult.error}`);
          return `[Error: Could not extract content from PDF ${file.basename}. ${miyoResult.error}]`;
        }
      }

      // If not in cache, read the file and call the API
      const binaryContent = await vault.readBinary(file);
      logInfo("Calling pdf4llm API for:", file.path);
      const pdf4llmResponse = await this.brevilabsClient.pdf4llm(binaryContent);
      await this.pdfCache.set(file, pdf4llmResponse);
      await saveConvertedDocOutput(file, pdf4llmResponse.response, vault);
      return pdf4llmResponse.response;
    } catch (error) {
      logError(`Error extracting content from PDF ${file.path}:`, error);
      return `[Error: Could not extract content from PDF ${file.basename}]`;
    }
  }

  async clearCache(): Promise<void> {
    logInfo("Clearing PDF cache");
    await this.pdfCache.clear();
  }
}

export class CanvasParser implements LegacyFileParser {
  supportedExtensions = ["canvas"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo("Parsing Canvas file:", file.path);
      const canvasLoader = new CanvasLoader(vault);
      const canvasData = await canvasLoader.load(file);

      // Use the specialized buildPrompt method to create LLM-friendly format
      return canvasLoader.buildPrompt(canvasData);
    } catch (error) {
      logError(`Error parsing Canvas file ${file.path}:`, error);
      return `[Error: Could not parse Canvas file ${file.basename}]`;
    }
  }
}

export class Docs4LLMParser implements LegacyFileParser {
  // Support various document and media file types
  supportedExtensions = [
    // Base types
    "pdf",

    // Documents and presentations
    "602",
    "abw",
    "cgm",
    "cwk",
    "doc",
    "docx",
    "docm",
    "dot",
    "dotm",
    "hwp",
    "key",
    "lwp",
    "mw",
    "mcw",
    "pages",
    "pbd",
    "ppt",
    "pptm",
    "pptx",
    "pot",
    "potm",
    "potx",
    "rtf",
    "sda",
    "sdd",
    "sdp",
    "sdw",
    "sgl",
    "sti",
    "sxi",
    "sxw",
    "stw",
    "sxg",
    "txt",
    "uof",
    "uop",
    "uot",
    "vor",
    "wpd",
    "wps",
    "xml",
    "zabw",
    "epub",

    // Images
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "svg",
    "tiff",
    "webp",
    "web",
    "htm",
    "html",

    // Spreadsheets
    "xlsx",
    "xls",
    "xlsm",
    "xlsb",
    "xlw",
    "csv",
    "dif",
    "sylk",
    "slk",
    "prn",
    "numbers",
    "et",
    "ods",
    "fods",
    "uos1",
    "uos2",
    "dbf",
    "wk1",
    "wk2",
    "wk3",
    "wk4",
    "wks",
    "123",
    "wq1",
    "wq2",
    "wb1",
    "wb2",
    "wb3",
    "qpw",
    "xlr",
    "eth",
    "tsv",

    // Audio (limited to 20MB)
    "mp3",
    "mp4",
    "mpeg",
    "mpga",
    "m4a",
    "wav",
    "webm",
  ];
  private brevilabsClient: BrevilabsClient;
  private projectContextCache: ProjectContextCache;
  private selfHostPdfParser: SelfHostPdfParser;
  private currentProject: ProjectConfig | null;
  private static lastRateLimitNoticeTime: number = 0;

  public static resetRateLimitNoticeTimer(): void {
    Docs4LLMParser.lastRateLimitNoticeTime = 0;
  }

  constructor(brevilabsClient: BrevilabsClient, project: ProjectConfig | null = null) {
    this.brevilabsClient = brevilabsClient;
    this.projectContextCache = ProjectContextCache.getInstance();
    this.selfHostPdfParser = new SelfHostPdfParser();
    this.currentProject = project;
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo(
        `[Docs4LLMParser] Project ${this.currentProject?.name}: Parsing ${file.extension} file: ${file.path}`
      );

      if (!this.currentProject) {
        logError("[Docs4LLMParser] No project context for parsing file: ", file.path);
        throw new Error("No project context provided for file parsing");
      }

      const cachedContent = await this.projectContextCache.getOrReuseFileContext(
        this.currentProject,
        file.path
      );
      if (cachedContent) {
        logInfo(
          `[Docs4LLMParser] Project ${this.currentProject.name}: Using cached content for: ${file.path}`
        );
        // Ensure output file exists even on cache hit (user may have just enabled the setting)
        await saveConvertedDocOutput(file, cachedContent, vault);
        return cachedContent;
      }
      logInfo(
        `[Docs4LLMParser] Project ${this.currentProject.name}: Cache miss for: ${file.path}. Proceeding to API call.`
      );

      // For PDFs, try Miyo first when self-host mode is active
      if (
        isSelfHostModeValid() &&
        getSettings().enableMiyo &&
        file.extension.toLowerCase() === "pdf"
      ) {
        const miyoResult = await this.selfHostPdfParser.parsePdf(file, vault);
        if (miyoResult && "content" in miyoResult) {
          await this.projectContextCache.setFileContext(
            this.currentProject,
            file.path,
            miyoResult.content
          );
          await saveConvertedDocOutput(file, miyoResult.content, vault);
          logInfo(
            `[Docs4LLMParser] Project ${this.currentProject.name}: Parsed PDF via Miyo: ${file.path}`
          );
          return miyoResult.content;
        }
        if (miyoResult && "error" in miyoResult) {
          // Self-host mode: do NOT fall back to cloud API to preserve privacy.
          // Throw so executeWithProcessTracking marks this file as failed/retriable.
          throw new Error(`Miyo failed to parse ${file.basename}: ${miyoResult.error}`);
        }
      }

      const binaryContent = await vault.readBinary(file);

      logInfo(
        `[Docs4LLMParser] Project ${this.currentProject.name}: Calling docs4llm API for: ${file.path}`
      );
      const docs4llmResponse = await this.brevilabsClient.docs4llm(binaryContent, file.extension);

      if (!docs4llmResponse || !docs4llmResponse.response) {
        throw new Error("Empty response from docs4llm API");
      }

      // Extract markdown content from response
      let content = "";
      if (typeof docs4llmResponse.response === "string") {
        content = docs4llmResponse.response;
      } else if (Array.isArray(docs4llmResponse.response)) {
        // Handle array of documents from docs4llm
        const markdownParts: string[] = [];
        for (const doc of docs4llmResponse.response) {
          if (doc.content) {
            // Prioritize markdown content, then fallback to text content
            if (doc.content.md) {
              markdownParts.push(doc.content.md);
            } else if (doc.content.text) {
              markdownParts.push(doc.content.text);
            }
          }
        }
        content = markdownParts.join("\n\n");
      } else if (typeof docs4llmResponse.response === "object") {
        // Handle single object response (backward compatibility)
        if (docs4llmResponse.response.md) {
          content = docs4llmResponse.response.md;
        } else if (docs4llmResponse.response.text) {
          content = docs4llmResponse.response.text;
        } else if (docs4llmResponse.response.content) {
          content = docs4llmResponse.response.content;
        } else {
          // If no markdown/text/content field, stringify the entire response
          content = JSON.stringify(docs4llmResponse.response, null, 2);
        }
      } else {
        content = String(docs4llmResponse.response);
      }

      // Cache the converted content
      await this.projectContextCache.setFileContext(this.currentProject, file.path, content);
      await saveConvertedDocOutput(file, content, vault);

      logInfo(
        `[Docs4LLMParser] Project ${this.currentProject.name}: Successfully processed and cached: ${file.path}`
      );
      return content;
    } catch (error) {
      logError(
        `[Docs4LLMParser] Project ${this.currentProject?.name}: Error processing file ${file.path}:`,
        error
      );

      // Check if this is a rate limit error and show user-friendly notice
      if (isRateLimitError(error)) {
        this.showRateLimitNotice(error);
      }

      throw error; // Propagate the error up
    }
  }

  private showRateLimitNotice(error: any): void {
    const now = Date.now();

    // Only show one rate limit notice per minute to avoid spam
    if (now - Docs4LLMParser.lastRateLimitNoticeTime < 60000) {
      return;
    }

    Docs4LLMParser.lastRateLimitNoticeTime = now;

    const retryTime = extractRetryTime(error);

    new Notice(
      `⚠️ Rate limit exceeded for document processing. Please try again in ${retryTime}. Having fewer non-markdown files in the project will help.`,
      10000 // Show notice for 10 seconds
    );
  }

  async clearCache(): Promise<void> {
    // This method is no longer needed as cache clearing is handled at the project level
    logInfo("Cache clearing is now handled at the project level");
  }
}

// Future parsers can be added like this:
/*
class DocxParser implements FileParser {
  supportedExtensions = ["docx", "doc"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    // Implementation for Word documents
  }
}
*/

export class FileParserManager {
  private parsers: Map<string, LegacyFileParser> = new Map();
  private ocrFallbackParser: TypedFileParser | null = null;

  constructor(
    brevilabsClient: BrevilabsClient,
    _vault: Vault,
    isProjectMode: boolean = false,
    project: ProjectConfig | null = null,
    visionOcrCallback?: VisionOcrCallback
  ) {
    // Register parsers
    this.registerParser(new MarkdownParser());

    // In project mode, use Docs4LLMParser for all supported files including PDFs
    this.registerParser(new Docs4LLMParser(brevilabsClient, project));

    // Only register local typed parsers when not in project mode
    if (!isProjectMode) {
      const ocrFallbackParser = new OcrFallbackParser({
        visionOcr: visionOcrCallback ?? createVisionOcrCallback(ChatModelManager.getInstance()),
      });

      this.registerOcrFallbackParser(ocrFallbackParser);

      // Preserve Docs4LLMParser as the project-mode handler for Office and EPUB formats.
      this.registerParser(new ImageParser({ ocrParser: ocrFallbackParser }));
      this.registerParser(new LocalPdfParser());
      this.registerParser(new DocxParser());
      this.registerParser(new EpubParser());
      this.registerParser(new PptxParser());
      this.registerParser(new XlsxParser());
    }

    this.registerParser(new CanvasParser());
  }

  /**
   * Register either a legacy parser or a typed parser implementation.
   *
   * @param parser - Parser implementation to register for its supported extensions.
   */
  registerParser(parser: LegacyFileParser | TypedFileParser): void {
    const legacyParser = this.isTypedFileParser(parser)
      ? new TypedParserAdapter(parser, () => this.ocrFallbackParser)
      : parser;

    for (const ext of legacyParser.supportedExtensions) {
      this.parsers.set(normalizeExtension(ext), legacyParser);
    }
  }

  /**
   * Register the OCR fallback parser used by typed parser adapters.
   *
   * @param parser - Typed parser that should handle OCR fallback conversions.
   */
  registerOcrFallbackParser(parser: TypedFileParser): void {
    this.ocrFallbackParser = parser;
  }

  /**
   * Parse a file using the registered legacy or adapted parser implementation.
   *
   * @param file - Source file to parse.
   * @param vault - Obsidian vault used to read file contents.
   * @returns Extracted content as a string for existing callers.
   */
  async parseFile(file: TFile, vault: Vault): Promise<string> {
    const parser = this.parsers.get(normalizeExtension(file.extension));
    if (!parser) {
      throw createTypedConversionError(
        {
          code: "unsupported_format",
          message: `No parser is registered for files with the .${file.extension} extension.`,
        },
        file.name
      );
    }

    validateFileSize(file, getSettings().maxFileSizeMB);

    return await parser.parseFile(file, vault);
  }

  /**
   * Parse a converted-document attachment and retain metadata required for
   * downstream XML wrapping.
   *
   * @param file - Source file to parse.
   * @param vault - Obsidian vault used to read file contents.
   * @returns Parsed content plus metadata for supported converted documents.
   */
  async parseFileWithMetadata(file: TFile, vault: Vault): Promise<ParsedFileResult> {
    const parser = this.parsers.get(normalizeExtension(file.extension));
    if (!parser) {
      throw createTypedConversionError(
        {
          code: "unsupported_format",
          message: `No parser is registered for files with the .${file.extension} extension.`,
        },
        file.name
      );
    }

    validateFileSize(file, getSettings().maxFileSizeMB);

    if (parser.parseFileWithMetadata) {
      return await parser.parseFileWithMetadata(file, vault);
    }

    const content = await parser.parseFile(file, vault);
    return {
      content,
      metadata: createFallbackMetadata(file, content),
    };
  }

  /**
   * Check whether a parser is registered for a file extension.
   *
   * @param extension - File extension to check.
   * @returns True when a parser is registered.
   */
  supportsExtension(extension: string): boolean {
    return this.parsers.has(normalizeExtension(extension));
  }

  /**
   * Return the normalized list of supported conversion formats currently backed
   * by registered parsers.
   *
   * @returns Supported format identifiers in stable declaration order.
   */
  getSupportedFormats(): SupportedFormat[] {
    const registeredFormats = new Set<SupportedFormat>();

    for (const extension of this.parsers.keys()) {
      const format = EXTENSION_TO_FORMAT[extension];
      if (format) {
        registeredFormats.add(format);
      }
    }

    return SUPPORTED_FORMATS.filter((format) => registeredFormats.has(format));
  }

  /**
   * Clear the local PDF cache when the local PDF parser is registered.
   *
   * @returns Promise resolved once cache clearing completes.
   */
  async clearPDFCache(): Promise<void> {
    const pdfParser = this.parsers.get("pdf");
    const parserWithClearCache = pdfParser as LegacyFileParser & {
      clearCache?: () => Promise<void>;
    };

    if (typeof parserWithClearCache.clearCache === "function") {
      await parserWithClearCache.clearCache();
    }
  }

  /**
   * Detect whether the provided parser implements the new typed conversion contract.
   *
   * @param parser - Parser instance being registered.
   * @returns True when the parser uses the typed conversion interface.
   */
  private isTypedFileParser(parser: LegacyFileParser | TypedFileParser): parser is TypedFileParser {
    return "parse" in parser && "canHandle" in parser && "formatId" in parser;
  }
}
