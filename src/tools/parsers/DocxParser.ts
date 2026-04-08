import mammoth from "mammoth";
import TurndownService from "turndown";
import {
  type ConversionError,
  type ConversionMetadata,
  type ConversionOptions,
  type ConversionResult,
  type FileParser,
} from "./conversionTypes";

const DOCX_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
  "b => strong",
  "i => em",
];

const TITLE_PATTERN = /^(#{1,6})\s+(.+)$/m;
const CORRUPT_DOCX_PATTERN =
  /central directory|corrupt|invalid|zip|end of central directory|not a zip/i;
const PASSWORD_PROTECTED_PATTERN = /password|encrypted|protection/i;

interface MammothMessage {
  type: "warning" | "error";
  message: string;
}

/**
 * Create a Turndown service configured for stable Markdown output.
 *
 * Headings, lists, and inline emphasis are preserved through standard HTML
 * semantics emitted by Mammoth, while the explicit delimiter settings keep the
 * generated Markdown predictable for tests.
 *
 * @returns A Turndown service instance for DOCX HTML conversion.
 */
function createTurndownService(): TurndownService {
  return new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
}

/**
 * Convert the HTML fragment produced by Mammoth into normalized Markdown.
 *
 * @param html - HTML fragment returned by Mammoth.
 * @returns Markdown content with collapsed excess blank lines.
 */
function convertHtmlToMarkdown(html: string): string {
  if (!html.trim()) {
    return "";
  }

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const wrapper = doc.body.firstElementChild as HTMLElement | null;

  if (!wrapper) {
    return "";
  }

  return createTurndownService()
    .turndown(wrapper)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Count the number of words in converted Markdown content.
 *
 * @param content - Markdown content returned by the parser.
 * @returns Number of non-whitespace tokens in the content.
 */
function countWords(content: string): number {
  return content.match(/\S+/g)?.length ?? 0;
}

/**
 * Remove the final file extension from a filename.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns Filename without its trailing extension.
 */
function getFilenameStem(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

/**
 * Extract a human-readable document title from converted Markdown.
 *
 * @param content - Converted Markdown content.
 * @param filename - Source filename used as a fallback title.
 * @returns The first heading text, or the filename stem when no heading exists.
 */
function extractTitle(content: string, filename: string): string {
  const headingMatch = content.match(TITLE_PATTERN);
  return headingMatch?.[2]?.trim() || getFilenameStem(filename);
}

/**
 * Build standard metadata for a DOCX conversion attempt.
 *
 * @param filename - Original source filename.
 * @param content - Converted Markdown content.
 * @returns Metadata populated for the conversion result.
 */
function createMetadata(filename: string, content: string): ConversionMetadata {
  return {
    title: extractTitle(content, filename),
    sourceFilename: filename,
    sourceFormat: "docx",
    wordCount: countWords(content),
    conversionDate: new Date().toISOString(),
    ocrUsed: false,
  };
}

/**
 * Convert Mammoth conversion messages into the shared error contract.
 *
 * @param messages - Messages emitted by Mammoth during conversion.
 * @returns Structured conversion errors suitable for the shared result type.
 */
function mapMammothMessages(messages: MammothMessage[]): ConversionError[] {
  return messages.map((message) => ({
    code: message.type === "error" ? "parse_error" : "unknown",
    message: message.message,
  }));
}

/**
 * Classify an unexpected DOCX parsing failure into the shared error contract.
 *
 * @param error - Thrown error from Mammoth or downstream Markdown conversion.
 * @returns Structured error describing the failure.
 */
function classifyParseFailure(error: unknown): ConversionError {
  const message = error instanceof Error ? error.message : String(error);

  if (PASSWORD_PROTECTED_PATTERN.test(message)) {
    return {
      code: "password_protected",
      message,
    };
  }

  if (CORRUPT_DOCX_PATTERN.test(message)) {
    return {
      code: "corrupt_file",
      message,
    };
  }

  return {
    code: "parse_error",
    message,
  };
}

/**
 * Parse DOCX documents into structured Markdown conversion results.
 */
export class DocxParser implements FileParser {
  public readonly formatId = "docx";
  public readonly supportedMimeTypes = DOCX_MIME_TYPES;
  public readonly displayName = "DOCX Parser";

  /**
   * Check whether the parser supports a given MIME type.
   *
   * @param mimeType - MIME type detected for the source file.
   * @returns True when the MIME type matches supported DOCX inputs.
   */
  canHandle(mimeType: string): boolean {
    return this.supportedMimeTypes.includes(mimeType.toLowerCase());
  }

  /**
   * Convert a DOCX file buffer into Markdown content and metadata.
   *
   * The parser intentionally stays standalone by depending only on the provided
   * buffer and filename, which keeps it easy to unit test without Obsidian
   * runtime dependencies.
   *
   * @param fileBuffer - Raw DOCX file bytes.
   * @param filename - Original source filename.
   * @param _options - Conversion options reserved for the shared parser contract.
   * @returns Structured conversion output for the source document.
   */
  async parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    _options: ConversionOptions
  ): Promise<ConversionResult> {
    try {
      const mammothResult = await mammoth.convertToHtml(
        { arrayBuffer: fileBuffer },
        {
          styleMap: DOCX_STYLE_MAP,
          includeDefaultStyleMap: true,
          includeEmbeddedStyleMap: false,
          externalFileAccess: false,
        }
      );

      const content = convertHtmlToMarkdown(mammothResult.value);
      const metadata = createMetadata(filename, content);
      const errors = mapMammothMessages(mammothResult.messages as MammothMessage[]);

      if (!content) {
        return {
          status: "failure",
          content: "",
          metadata,
          errors:
            errors.length > 0
              ? errors
              : [
                  {
                    code: "parse_error",
                    message: `No extractable content was found in ${filename}.`,
                  },
                ],
        };
      }

      return {
        status: errors.length > 0 ? "partial" : "success",
        content,
        metadata,
        errors,
      };
    } catch (error) {
      return {
        status: "failure",
        content: "",
        metadata: createMetadata(filename, ""),
        errors: [classifyParseFailure(error)],
      };
    }
  }
}
