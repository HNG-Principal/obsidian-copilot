import type { ConversionErrorCode } from "./conversionTypes";

/**
 * Error shape used when document conversion failures need to be surfaced to the
 * chat UI.
 */
export interface ConversionErrorLike {
  code?: ConversionErrorCode;
  message?: string;
  page?: number;
  sourceFilename?: string;
}

const SUPPORTED_FORMAT_HINT = "pdf, docx, pptx, xlsx/csv, epub, and common image formats";

/**
 * Check whether an unknown value resembles a structured conversion error.
 *
 * @param error - Unknown error candidate.
 * @returns True when the value exposes the shared conversion error fields.
 */
export function isConversionErrorLike(error: unknown): error is ConversionErrorLike {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as ConversionErrorLike;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

/**
 * Format a structured conversion error into the user-facing text shown inside
 * the chat error block.
 *
 * @param error - Structured conversion error.
 * @returns Friendly, actionable chat error copy.
 */
export function formatConversionErrorForChat(error: ConversionErrorLike): string {
  const fileLabel = error.sourceFilename ? `"${error.sourceFilename}"` : "the attached document";
  const pageLabel = typeof error.page === "number" ? ` on page ${error.page}` : "";
  const detail = error.message?.trim();

  let summary = `Copilot could not convert ${fileLabel}.`;
  let suggestion = "Try again with a different file or remove the attachment from this message.";

  switch (error.code) {
    case "unsupported_format":
      summary = `Copilot could not convert ${fileLabel} because its format is not supported.`;
      suggestion = `Use one of the supported formats: ${SUPPORTED_FORMAT_HINT}. If the file extension looks wrong, rename the file to match its real format and try again.`;
      break;
    case "file_too_large":
      summary = `${fileLabel} is too large to add as chat context.`;
      suggestion =
        "Use a smaller file, split the document into smaller parts, or increase the maximum conversion file size in Copilot settings.";
      break;
    case "password_protected":
      summary = `${fileLabel} appears to be password protected and could not be opened.`;
      suggestion =
        "Remove the password or export an unlocked copy of the document, then attach it again.";
      break;
    case "corrupt_file":
      summary = `${fileLabel} appears to be corrupted or incomplete.`;
      suggestion =
        "Open the file outside Copilot to confirm it works, then export or replace it with a clean copy.";
      break;
    case "ocr_failed":
      summary = `Copilot could not extract readable text from ${fileLabel}${pageLabel}.`;
      suggestion =
        "Try a clearer scan or image, or use a text-based version of the document if one is available.";
      break;
    case "timeout":
      summary = `Copilot took too long to convert ${fileLabel}.`;
      suggestion =
        "Try a smaller document, reduce the page count, or retry when your device has fewer heavy tasks running.";
      break;
    case "parse_error":
      summary = `Copilot could not extract readable content from ${fileLabel}${pageLabel}.`;
      suggestion =
        "Make sure the file opens normally in another app, then try again or export it to a supported format.";
      break;
    default:
      summary = `Copilot could not convert ${fileLabel}.`;
      suggestion = "Try the file again or attach a different copy of the document.";
      break;
  }

  return [
    "Document Conversion Failed",
    "",
    summary,
    suggestion,
    detail ? `Details: ${detail}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/**
 * Convert an unknown error into a chat-display message when it matches the
 * shared conversion error contract.
 *
 * @param error - Unknown error raised while sending a chat message.
 * @returns Friendly chat error text when the error is conversion-related.
 */
export function getConversionErrorChatMessage(error: unknown): string | null {
  if (!isConversionErrorLike(error)) {
    return null;
  }

  return formatConversionErrorForChat(error);
}
