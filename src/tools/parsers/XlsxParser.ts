import { read, utils, type ParsingOptions, type WorkBook, type WorkSheet } from "xlsx";

import type {
  ConversionError,
  ConversionMetadata,
  ConversionOptions,
  ConversionResult,
  FileParser,
  SupportedFormat,
} from "@/tools/parsers/conversionTypes";

const XLSX_MIME_TYPES = [
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
] as const;

const CSV_LIKE_EXTENSIONS = new Set(["csv", "tsv"]);

/**
 * Normalize a MIME type so parser checks ignore casing and charset suffixes.
 *
 * @param mimeType - Raw MIME type value supplied by the caller.
 * @returns Lower-cased MIME type without parameters.
 */
function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/**
 * Extract the lower-cased file extension from a filename.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns File extension without a leading period.
 */
function getFileExtension(filename: string): string {
  const extension = filename.split(".").pop();
  return extension ? extension.toLowerCase() : "";
}

/**
 * Determine the conversion metadata source format for the current file.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns The supported format identifier that best matches the filename.
 */
function inferSourceFormat(filename: string): SupportedFormat {
  return CSV_LIKE_EXTENSIONS.has(getFileExtension(filename)) ? "csv" : "xlsx";
}

/**
 * Build SheetJS parsing options for the provided filename.
 *
 * @param filename - Source filename supplied to the parser.
 * @returns Workbook parsing options appropriate for the file type.
 */
function getReadOptions(filename: string): ParsingOptions {
  const extension = getFileExtension(filename);

  if (extension === "tsv") {
    return {
      type: "array",
      FS: "\t",
      dense: true,
      cellDates: true,
    };
  }

  return {
    type: "array",
    dense: true,
    cellDates: true,
  };
}

/**
 * Find the index of the last non-empty cell in a row.
 *
 * @param row - Worksheet row represented as a list of cell values.
 * @returns Zero-based index of the last meaningful cell, or -1 when empty.
 */
function getLastNonEmptyCellIndex(row: unknown[]): number {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if (String(row[index] ?? "").trim().length > 0) {
      return index;
    }
  }

  return -1;
}

/**
 * Remove empty rows from the start and end of a sheet while preserving internal gaps.
 *
 * @param rows - Raw sheet rows extracted from SheetJS.
 * @returns Sheet rows without leading or trailing empty rows.
 */
function trimBoundaryEmptyRows(rows: unknown[][]): unknown[][] {
  let startIndex = 0;
  while (startIndex < rows.length && getLastNonEmptyCellIndex(rows[startIndex]) === -1) {
    startIndex += 1;
  }

  let endIndex = rows.length - 1;
  while (endIndex >= startIndex && getLastNonEmptyCellIndex(rows[endIndex]) === -1) {
    endIndex -= 1;
  }

  return endIndex >= startIndex ? rows.slice(startIndex, endIndex + 1) : [];
}

/**
 * Calculate the visible width of a sheet based on its meaningful cells.
 *
 * @param rows - Sheet rows after boundary trimming.
 * @returns Number of columns required to represent the sheet.
 */
function getSheetColumnCount(rows: unknown[][]): number {
  return rows.reduce((maxColumns, row) => {
    const lastNonEmptyCellIndex = getLastNonEmptyCellIndex(row);
    return Math.max(maxColumns, lastNonEmptyCellIndex + 1);
  }, 0);
}

/**
 * Convert an arbitrary cell value into a markdown-safe string.
 *
 * @param value - Worksheet cell value.
 * @returns Sanitized cell text suitable for markdown table output.
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.replace(/\r\n|\r|\n/g, "<br>").replace(/\|/g, "\\|");
}

/**
 * Normalize extracted sheet rows into a rectangular string matrix.
 *
 * @param rows - Raw sheet rows extracted from SheetJS.
 * @returns Markdown-ready rows with trailing empty columns removed and missing cells padded.
 */
function normalizeSheetRows(rows: unknown[][]): string[][] {
  const trimmedRows = trimBoundaryEmptyRows(rows);
  const columnCount = getSheetColumnCount(trimmedRows);

  if (columnCount === 0) {
    return [];
  }

  return trimmedRows.map((row) =>
    Array.from({ length: columnCount }, (_, columnIndex) => formatCellValue(row[columnIndex]))
  );
}

/**
 * Create a markdown table from normalized sheet rows.
 *
 * @param rows - Rectangular sheet data where the first row is treated as the header row.
 * @returns Markdown table text, or an empty-sheet marker when no rows exist.
 */
function convertRowsToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) {
    return "_Sheet is empty._";
  }

  const headerRow = rows[0];
  const separatorRow = headerRow.map(() => "---");
  const dataRows = rows.slice(1);
  const tableRows = [headerRow, separatorRow, ...dataRows];

  return tableRows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

/**
 * Convert a worksheet into a markdown section with a sheet heading.
 *
 * @param sheetName - Workbook sheet name.
 * @param worksheet - SheetJS worksheet instance.
 * @returns Markdown section for the sheet.
 */
function convertSheetToMarkdownSection(sheetName: string, worksheet: WorkSheet): string {
  const rawRows = utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: true,
    defval: "",
    raw: false,
  }) as unknown[][];
  const normalizedRows = normalizeSheetRows(rawRows);
  const markdownTable = convertRowsToMarkdownTable(normalizedRows);

  return `## Sheet: ${sheetName}\n\n${markdownTable}`;
}

/**
 * Count words in converted markdown content for metadata reporting.
 *
 * @param content - Final markdown emitted by the parser.
 * @returns Word count derived from non-whitespace token boundaries.
 */
function countWords(content: string): number {
  const tokens = content.trim().match(/\S+/g);
  return tokens ? tokens.length : 0;
}

/**
 * Select the workbook title from embedded properties or the source filename.
 *
 * @param workbook - Parsed workbook returned by SheetJS.
 * @param filename - Source filename supplied to the parser.
 * @returns Best-effort title for conversion metadata.
 */
function getWorkbookTitle(workbook: WorkBook, filename: string): string {
  const propertyTitle = workbook.Props?.Title?.trim();
  if (propertyTitle) {
    return propertyTitle;
  }

  return filename.replace(/\.[^.]+$/, "");
}

/**
 * Convert a thrown parsing error into the structured conversion contract.
 *
 * @param error - Unknown error raised during workbook parsing.
 * @returns Structured conversion error compatible with ConversionResult.
 */
function toConversionError(error: unknown): ConversionError {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("password")) {
    return {
      code: "password_protected",
      message,
    };
  }

  if (
    normalizedMessage.includes("corrupt") ||
    normalizedMessage.includes("invalid") ||
    normalizedMessage.includes("unsupported file") ||
    normalizedMessage.includes("bad zip")
  ) {
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
 * Build metadata for a completed spreadsheet conversion.
 *
 * @param filename - Source filename supplied to the parser.
 * @param sourceFormat - Detected supported format for the source file.
 * @param title - Best-effort document title.
 * @param pageCount - Number of sheet sections included in the output.
 * @param content - Final markdown emitted by the parser.
 * @returns Structured metadata for the conversion result.
 */
function buildMetadata(
  filename: string,
  sourceFormat: SupportedFormat,
  title: string,
  pageCount: number,
  content: string
): ConversionMetadata {
  return {
    title,
    sourceFilename: filename,
    sourceFormat,
    pageCount,
    wordCount: countWords(content),
    conversionDate: new Date().toISOString(),
    ocrUsed: false,
  };
}

/**
 * Spreadsheet parser that converts workbook sheets into markdown tables.
 */
export class XlsxParser implements FileParser {
  public readonly formatId: SupportedFormat = "xlsx";
  public readonly supportedMimeTypes: string[] = [...XLSX_MIME_TYPES];
  public readonly displayName = "Spreadsheet Parser";

  /**
   * Determine whether this parser can handle the supplied MIME type.
   *
   * @param mimeType - MIME type detected for the source document.
   * @returns True when the MIME type maps to XLSX, XLS, CSV, or TSV content.
   */
  canHandle(mimeType: string): boolean {
    const normalizedMimeType = normalizeMimeType(mimeType);
    return this.supportedMimeTypes.includes(normalizedMimeType as (typeof XLSX_MIME_TYPES)[number]);
  }

  /**
   * Parse spreadsheet bytes into markdown tables separated by sheet headings.
   *
   * @param fileBuffer - Raw file bytes for the source spreadsheet.
   * @param filename - Original source filename used for metadata.
   * @param options - Conversion behavior overrides supplied by the caller.
   * @returns Structured conversion output containing markdown, metadata, and errors.
   */
  async parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult> {
    try {
      const workbook = read(fileBuffer, getReadOptions(filename));
      const sheetLimit =
        typeof options.maxPages === "number" && options.maxPages > 0
          ? Math.floor(options.maxPages)
          : undefined;
      const sheetNames = sheetLimit
        ? workbook.SheetNames.slice(0, sheetLimit)
        : workbook.SheetNames;
      const sections = sheetNames
        .map((sheetName) =>
          workbook.Sheets[sheetName]
            ? convertSheetToMarkdownSection(sheetName, workbook.Sheets[sheetName])
            : ""
        )
        .filter((section) => section.length > 0);
      const content =
        sections.length > 0 ? sections.join("\n\n") : "## Sheet: Sheet1\n\n_Sheet is empty._";
      const metadata = buildMetadata(
        filename,
        inferSourceFormat(filename),
        getWorkbookTitle(workbook, filename),
        sheetNames.length,
        content
      );

      return {
        status: "success",
        content,
        metadata,
        errors: [],
      };
    } catch (error) {
      const conversionError = toConversionError(error);
      const failureMetadata = buildMetadata(
        filename,
        inferSourceFormat(filename),
        filename.replace(/\.[^.]+$/, ""),
        0,
        ""
      );

      return {
        status: "failure",
        content: "",
        metadata: failureMetadata,
        errors: [conversionError],
      };
    }
  }
}
