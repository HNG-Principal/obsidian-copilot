import { Buffer } from "buffer";
import { logInfo, logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import { getMiyoCustomUrl } from "@/miyo/miyoUtils";
import { isSelfHostModeValid } from "@/plusUtils";
import { getSettings } from "@/settings/model";
import {
  type ConversionError,
  type ConversionMetadata,
  type ConversionOptions,
  type ConversionResult,
  type FileParser,
} from "./conversionTypes";

const PDF_MIME_TYPES = ["application/pdf"] as const;
const PAGE_MARKER = "__OBSIDIAN_COPILOT_PDF_PAGE__";
const ROW_Y_TOLERANCE = 2;
const INLINE_WORD_GAP = 3;
const COLUMN_GAP_THRESHOLD = 18;
const COLUMN_ALIGNMENT_TOLERANCE = 12;
const MIN_TABLE_COLUMN_COUNT = 2;
const MIN_TABLE_ROW_COUNT = 2;

interface PdfDocumentInfo {
  Title?: string;
}

interface PdfParseResult {
  numpages: number;
  numrender: number;
  info: PdfDocumentInfo | null;
  text: string;
}

interface PdfParseOptions {
  max?: number;
  pagerender: (pageData: PdfPageData) => Promise<string>;
}

interface MiyoParseDocResponse {
  text?: string;
}

interface MiyoPdfClient {
  resolveBaseUrl: (customUrl: string) => Promise<string>;
  parseDoc: (baseUrl: string, absoluteFilePath: string) => Promise<MiyoParseDocResponse>;
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
}

interface PdfPageData {
  getTextContent: (options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }) => Promise<PdfTextContent>;
}

interface PdfMetadataResult {
  info?: PdfDocumentInfo | null;
}

interface PdfDocumentProxy {
  numPages: number;
  getMetadata: () => Promise<PdfMetadataResult | null>;
  getPage: (pageNumber: number) => Promise<PdfPageData>;
  destroy: () => Promise<void>;
}

interface PdfDocumentLoadingTask {
  promise: Promise<PdfDocumentProxy>;
  destroy: () => Promise<void>;
}

interface PdfJsModule {
  getDocument: (source: { data: Uint8Array }) => PdfDocumentLoadingTask;
}

interface PdfJsWorkerModule {
  WorkerMessageHandler: unknown;
}

interface PositionedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

interface PdfCell {
  text: string;
  xStart: number;
  xEnd: number;
}

interface PdfRow {
  y: number;
  text: string;
  cells: PdfCell[];
}

interface StructuredPdfPage {
  pageNumber: number;
  rows: PdfRow[];
}

type PdfParseFunction = (buffer: Buffer, options: PdfParseOptions) => Promise<PdfParseResult>;

/**
 * Constructor dependencies used to keep the parser easy to unit test.
 */
export interface LocalPdfParserDependencies {
  pdfParse?: PdfParseFunction;
  miyoClient?: MiyoPdfClient;
}

let cachedPdfJsModule: Promise<PdfJsModule> | null = null;

/**
 * Load the browser-compatible PDF.js runtime and register its worker handler for
 * fake-worker execution inside the bundled Obsidian renderer process.
 *
 * @returns Memoized PDF.js module instance.
 */
async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (!cachedPdfJsModule) {
    cachedPdfJsModule = (async () => {
      const [pdfJsModule, workerModule] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);

      (globalThis as typeof globalThis & { pdfjsWorker?: PdfJsWorkerModule }).pdfjsWorker =
        workerModule as PdfJsWorkerModule;

      return pdfJsModule as PdfJsModule;
    })();
  }

  return cachedPdfJsModule;
}

/**
 * Convert a PDF buffer into the legacy parser contract consumed by the rest of
 * LocalPdfParser. This keeps the higher-level markdown extraction logic stable
 * while avoiding the Node-centric `pdf-parse` dependency.
 *
 * @param buffer - Raw PDF bytes to parse.
 * @param options - Page rendering callbacks and limits.
 * @returns `pdf-parse` compatible result data backed by PDF.js.
 */
async function defaultPdfParse(buffer: Buffer, options: PdfParseOptions): Promise<PdfParseResult> {
  const pdfJsModule = await loadPdfJsModule();
  const loadingTask = pdfJsModule.getDocument({
    data: new Uint8Array(buffer),
  });

  try {
    const document = await loadingTask.promise;

    try {
      const metadata = await document.getMetadata().catch(() => null);
      const pageLimit =
        options.max && options.max > 0
          ? Math.min(Math.floor(options.max), document.numPages)
          : document.numPages;
      const renderedPages: string[] = [];

      for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        renderedPages.push(await options.pagerender(page));
      }

      return {
        numpages: document.numPages,
        numrender: pageLimit,
        info: metadata?.info ?? null,
        text: renderedPages.map((pageText) => `\n\n${pageText}`).join(""),
      };
    } finally {
      await document.destroy().catch(() => undefined);
    }
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    throw error;
  }
}

/**
 * Derive a stable title from the provided filename.
 *
 * @param filename - Original filename supplied to the parser.
 * @returns Filename without directories or extension.
 */
function deriveTitleFromFilename(filename: string): string {
  const lastSegment = filename.split("/").pop() ?? filename;
  return lastSegment.replace(/\.[^/.]+$/, "");
}

/**
 * Resolve the most useful document title from PDF metadata.
 *
 * @param filename - Original filename supplied to the parser.
 * @param info - PDF metadata returned by pdf-parse.
 * @returns Metadata title when present, otherwise a filename-derived fallback.
 */
function resolveDocumentTitle(filename: string, info: PdfDocumentInfo | null): string {
  const metadataTitle = info?.Title?.trim();
  return metadataTitle && metadataTitle.length > 0
    ? metadataTitle
    : deriveTitleFromFilename(filename);
}

/**
 * Count words in normalized markdown output.
 *
 * @param markdown - Final markdown content produced by the parser.
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
 * Normalize a user-provided page limit into the shape expected by pdf-parse.
 *
 * @param options - Conversion options supplied by the caller.
 * @returns Zero for "all pages" or a positive whole-number page limit.
 */
function getRequestedPageLimit(options: ConversionOptions): number {
  if (!options.maxPages || options.maxPages <= 0) {
    return 0;
  }

  return Math.floor(options.maxPages);
}

/**
 * Normalize raw PDF text fragments before layout analysis.
 *
 * @param value - Raw text value emitted by pdf.js.
 * @returns Trimmed text with non-breaking spaces normalized.
 */
function normalizePdfText(value: string | undefined): string {
  return (value ?? "").replace(/\u00A0/g, " ").trim();
}

/**
 * Provide a safe width estimate for PDF text items.
 *
 * @param item - Raw text item emitted by pdf.js.
 * @param text - Normalized text associated with the item.
 * @returns Measured width when present, otherwise a conservative estimate.
 */
function getItemWidth(item: PdfTextItem, text: string): number {
  if (typeof item.width === "number" && item.width > 0) {
    return item.width;
  }

  return Math.max(text.length * 4, 1);
}

/**
 * Convert raw pdf.js text items into positioned text fragments.
 *
 * @param textContent - Text content returned for a single PDF page.
 * @returns Positioned text items suitable for row and column analysis.
 */
function extractPositionedItems(textContent: PdfTextContent): PositionedTextItem[] {
  return textContent.items
    .map((item) => {
      const text = normalizePdfText(item.str);
      const transform = item.transform ?? [];

      return {
        text,
        x: typeof transform[4] === "number" ? transform[4] : 0,
        y: typeof transform[5] === "number" ? transform[5] : 0,
        width: getItemWidth(item, text),
      };
    })
    .filter((item) => item.text.length > 0)
    .sort((left, right) => {
      if (Math.abs(left.y - right.y) > ROW_Y_TOLERANCE) {
        return right.y - left.y;
      }

      return left.x - right.x;
    });
}

/**
 * Append a text fragment while preserving likely word boundaries.
 *
 * @param current - Text accumulated so far.
 * @param next - Next fragment to append.
 * @param gap - Horizontal distance between the previous and next fragments.
 * @returns Combined text with a space inserted only when layout suggests one.
 */
function appendInlineText(current: string, next: string, gap: number): string {
  if (!current) {
    return next;
  }

  const separator = gap > INLINE_WORD_GAP ? " " : "";
  return `${current}${separator}${next}`;
}

/**
 * Convert a sorted row of text items into higher-level cell groupings.
 *
 * @param items - Positioned text items belonging to the same visual row.
 * @returns Row cells merged by horizontal proximity.
 */
function buildCellsForRow(items: PositionedTextItem[]): PdfCell[] {
  const cells: PdfCell[] = [];

  for (const item of items) {
    const lastCell = cells[cells.length - 1];
    const itemEndX = item.x + item.width;

    if (!lastCell || item.x - lastCell.xEnd > COLUMN_GAP_THRESHOLD) {
      cells.push({
        text: item.text,
        xStart: item.x,
        xEnd: itemEndX,
      });
      continue;
    }

    lastCell.text = appendInlineText(lastCell.text, item.text, item.x - lastCell.xEnd);
    lastCell.xEnd = Math.max(lastCell.xEnd, itemEndX);
  }

  return cells;
}

/**
 * Group positioned text items into visually aligned rows.
 *
 * @param items - Positioned text items extracted from a page.
 * @returns Normalized rows preserving left-to-right reading order.
 */
function buildRows(items: PositionedTextItem[]): PdfRow[] {
  const groupedRows: Array<{ y: number; items: PositionedTextItem[] }> = [];

  for (const item of items) {
    const existingRow = groupedRows.find((row) => Math.abs(row.y - item.y) <= ROW_Y_TOLERANCE);
    if (existingRow) {
      existingRow.items.push(item);
      continue;
    }

    groupedRows.push({
      y: item.y,
      items: [item],
    });
  }

  return groupedRows
    .map((row) => {
      const sortedItems = [...row.items].sort((left, right) => left.x - right.x);
      const cells = buildCellsForRow(sortedItems);

      return {
        y: row.y,
        text: cells
          .map((cell) => cell.text)
          .join(" ")
          .trim(),
        cells,
      };
    })
    .filter((row) => row.text.length > 0)
    .sort((left, right) => right.y - left.y);
}

/**
 * Serialize a structured page so pdf-parse can concatenate it into a single string.
 *
 * @param page - Structured page representation.
 * @returns Marker-prefixed JSON payload that can be recovered later.
 */
function serializeStructuredPage(page: StructuredPdfPage): string {
  return `${PAGE_MARKER}${JSON.stringify(page)}`;
}

/**
 * Recover structured pages from the marker-prefixed text returned by pdf-parse.
 *
 * @param rawText - Concatenated page payload returned by pdf-parse.
 * @returns Structured page descriptors in render order.
 */
function parseStructuredPages(rawText: string): StructuredPdfPage[] {
  return rawText
    .split(PAGE_MARKER)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => JSON.parse(segment) as StructuredPdfPage)
    .sort((left, right) => left.pageNumber - right.pageNumber);
}

/**
 * Determine whether a row has enough cell structure to be considered tabular.
 *
 * @param row - Page row under evaluation.
 * @returns True when the row looks like a table row candidate.
 */
function isTableCandidateRow(row: PdfRow): boolean {
  return row.cells.length >= MIN_TABLE_COLUMN_COUNT;
}

/**
 * Determine whether two rows share the same column alignment pattern.
 *
 * @param left - First row to compare.
 * @param right - Second row to compare.
 * @returns True when both rows likely belong to the same table.
 */
function rowsShareColumnAlignment(left: PdfRow, right: PdfRow): boolean {
  if (!isTableCandidateRow(left) || !isTableCandidateRow(right)) {
    return false;
  }

  if (left.cells.length !== right.cells.length) {
    return false;
  }

  return left.cells.every((cell, index) => {
    const matchingCell = right.cells[index];
    return Math.abs(cell.xStart - matchingCell.xStart) <= COLUMN_ALIGNMENT_TOLERANCE;
  });
}

/**
 * Collect a run of consecutive rows that align like a table.
 *
 * @param rows - All page rows in reading order.
 * @param startIndex - Index at which to start evaluating a potential table.
 * @returns Consecutive table rows or null when the heuristic does not match.
 */
function collectTableRows(rows: PdfRow[], startIndex: number): PdfRow[] | null {
  const firstRow = rows[startIndex];
  const secondRow = rows[startIndex + 1];

  if (!firstRow || !secondRow || !rowsShareColumnAlignment(firstRow, secondRow)) {
    return null;
  }

  const tableRows = [firstRow, secondRow];
  const expectedColumnCount = firstRow.cells.length;

  for (let index = startIndex + 2; index < rows.length; index += 1) {
    const candidate = rows[index];
    const previous = tableRows[tableRows.length - 1];

    if (!candidate || candidate.cells.length !== expectedColumnCount) {
      break;
    }

    if (!rowsShareColumnAlignment(previous, candidate)) {
      break;
    }

    tableRows.push(candidate);
  }

  return tableRows.length >= MIN_TABLE_ROW_COUNT ? tableRows : null;
}

/**
 * Escape markdown table control characters inside a cell value.
 *
 * @param value - Raw cell text.
 * @returns Markdown-safe table cell content.
 */
function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").trim();
}

/**
 * Normalize a row into a fixed number of markdown table cells.
 *
 * @param row - Source row to normalize.
 * @param columnCount - Expected number of columns for the table.
 * @returns Escaped cell values padded to the expected width.
 */
function getMarkdownCells(row: PdfRow, columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) =>
    escapeMarkdownTableCell(row.cells[index]?.text ?? "")
  );
}

/**
 * Convert a set of aligned rows into a markdown table.
 *
 * @param rows - Consecutive table rows.
 * @returns Markdown table preserving detected columns.
 */
function renderMarkdownTable(rows: PdfRow[]): string {
  const columnCount = Math.max(...rows.map((row) => row.cells.length));
  const [headerRow, ...bodyRows] = rows;
  const headerCells = getMarkdownCells(headerRow, columnCount);
  const separator = Array.from({ length: columnCount }, () => "---");

  return [
    `| ${headerCells.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...bodyRows.map((row) => `| ${getMarkdownCells(row, columnCount).join(" | ")} |`),
  ].join("\n");
}

/**
 * Render a single page's rows into markdown, converting table-like regions when possible.
 *
 * @param rows - Structured rows for a single page.
 * @returns Markdown representation of the page.
 */
function renderPageMarkdown(rows: PdfRow[]): string {
  const blocks: string[] = [];
  let index = 0;

  while (index < rows.length) {
    const tableRows = collectTableRows(rows, index);
    if (tableRows) {
      blocks.push(renderMarkdownTable(tableRows));
      index += tableRows.length;
      continue;
    }

    blocks.push(rows[index].text);
    index += 1;
  }

  return blocks.join("\n\n").trim();
}

/**
 * Build shared conversion metadata for the parsed document.
 *
 * @param filename - Original source filename.
 * @param title - Resolved document title.
 * @param pageCount - Total page count reported by pdf-parse.
 * @param content - Final markdown content.
 * @returns Structured conversion metadata.
 */
function createMetadata(
  filename: string,
  title: string,
  pageCount: number,
  content: string
): ConversionMetadata {
  return {
    title,
    sourceFilename: filename,
    sourceFormat: "pdf",
    pageCount,
    wordCount: countWords(content),
    conversionDate: new Date().toISOString(),
    ocrUsed: false,
  };
}

/**
 * Map low-level parser failures into the shared conversion error contract.
 *
 * @param error - Unknown error thrown by pdf-parse.
 * @returns Structured conversion error describing the failure category.
 */
function mapPdfError(error: unknown): ConversionError {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("password")) {
    return {
      code: "password_protected",
      message,
    };
  }

  if (normalizedMessage.includes("invalid") || normalizedMessage.includes("corrupt")) {
    return {
      code: "corrupt_file",
      message,
    };
  }

  if (normalizedMessage.includes("timeout")) {
    return {
      code: "timeout",
      message,
    };
  }

  return {
    code: "parse_error",
    message,
  };
}

/**
 * Local PDF parser that converts PDF buffers into markdown using pdf-parse and
 * a lightweight column-alignment heuristic for table detection.
 */
export class LocalPdfParser implements FileParser {
  public readonly formatId = "pdf" as const;
  public readonly supportedMimeTypes = [...PDF_MIME_TYPES];
  public readonly displayName = "Local PDF Parser";

  private readonly pdfParse: PdfParseFunction;
  private readonly miyoClient: MiyoPdfClient;

  /**
   * Create a new local PDF parser.
   *
   * @param dependencies - Optional injected dependencies for testing.
   */
  constructor(dependencies: LocalPdfParserDependencies = {}) {
    this.pdfParse = dependencies.pdfParse ?? defaultPdfParse;
    this.miyoClient = dependencies.miyoClient ?? new MiyoClient();
  }

  /**
   * Determine whether this parser can handle the provided MIME type.
   *
   * @param mimeType - MIME type detected for the source document.
   * @returns True when the MIME type is a supported PDF type.
   */
  public canHandle(mimeType: string): boolean {
    return this.supportedMimeTypes.includes(mimeType as (typeof PDF_MIME_TYPES)[number]);
  }

  /**
   * Parse a PDF document into markdown with metadata and structured errors.
   *
   * @param fileBuffer - Raw PDF bytes.
   * @param filename - Original source filename.
   * @param options - Conversion behavior overrides.
   * @returns Structured conversion result for the supplied PDF.
   */
  public async parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult> {
    const localResult = await this.parseLocally(fileBuffer, filename, options);

    if (localResult.content.trim().length > 0 || fileBuffer.byteLength === 0) {
      return localResult;
    }

    const miyoResult = await this.tryMiyoFallback(filename, options);
    return miyoResult ?? localResult;
  }

  /**
   * Parse the PDF locally with `pdf-parse`.
   *
   * @param fileBuffer - Raw PDF bytes.
   * @param filename - Original source filename.
   * @param options - Conversion behavior overrides.
   * @returns Structured conversion result produced by the local parser.
   */
  private async parseLocally(
    fileBuffer: ArrayBuffer,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult> {
    const pageLimit = getRequestedPageLimit(options);
    const titleFallback = deriveTitleFromFilename(filename);

    if (fileBuffer.byteLength === 0) {
      const content = "";
      return {
        status: "failure",
        content,
        metadata: createMetadata(filename, titleFallback, 0, content),
        errors: [
          {
            code: "parse_error",
            message: "The PDF file is empty.",
          },
        ],
      };
    }

    try {
      let pageNumber = 0;
      const parsedPdf = await this.pdfParse(Buffer.from(fileBuffer), {
        max: pageLimit,
        pagerender: async (pageData) => {
          pageNumber += 1;
          const textContent = await pageData.getTextContent({
            normalizeWhitespace: false,
            disableCombineTextItems: false,
          });
          const rows = buildRows(extractPositionedItems(textContent));

          return serializeStructuredPage({
            pageNumber,
            rows,
          });
        },
      });

      const structuredPages = parseStructuredPages(parsedPdf.text);
      const errors: ConversionError[] = [];
      const renderedPageCount =
        pageLimit > 0 ? Math.min(parsedPdf.numpages, pageLimit) : parsedPdf.numrender;
      const pageSections: string[] = [];

      for (let index = 1; index <= renderedPageCount; index += 1) {
        const page = structuredPages.find((candidate) => candidate.pageNumber === index);
        if (!page) {
          errors.push({
            code: "parse_error",
            message: "The page could not be parsed.",
            page: index,
          });
          continue;
        }

        const pageMarkdown = renderPageMarkdown(page.rows);
        if (!pageMarkdown) {
          errors.push({
            code: "parse_error",
            message: "No extractable text was found on the page.",
            page: index,
          });
          continue;
        }

        pageSections.push(
          renderedPageCount > 1 ? `## Page ${index}\n\n${pageMarkdown}` : pageMarkdown
        );
      }

      const content = pageSections.join("\n\n").trim();
      const metadata = createMetadata(
        filename,
        resolveDocumentTitle(filename, parsedPdf.info),
        parsedPdf.numpages,
        content
      );

      if (!content) {
        return {
          status: "failure",
          content,
          metadata,
          errors:
            errors.length > 0
              ? errors
              : [
                  {
                    code: "parse_error",
                    message: "The PDF did not contain any extractable text.",
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
      const mappedError = mapPdfError(error);
      const content = "";

      return {
        status: "failure",
        content,
        metadata: createMetadata(filename, titleFallback, 0, content),
        errors: [mappedError],
      };
    }
  }

  /**
   * Attempt the legacy self-hosted Miyo PDF parser when local extraction did not
   * produce usable content.
   *
   * @param filename - Original source filename.
   * @param options - Conversion behavior overrides including the resolved file path.
   * @returns A successful conversion result when Miyo succeeds, otherwise null.
   */
  private async tryMiyoFallback(
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult | null> {
    if (!this.shouldUseMiyoFallback(options)) {
      return null;
    }

    try {
      const settings = getSettings();
      const baseUrl = await this.miyoClient.resolveBaseUrl(getMiyoCustomUrl(settings));
      const response = await this.miyoClient.parseDoc(baseUrl, options.absoluteFilePath as string);
      const content = response.text?.trim() ?? "";

      if (!content) {
        logWarn(`[LocalPdfParser] Miyo fallback returned empty text for ${filename}`);
        return null;
      }

      logInfo(`[LocalPdfParser] Parsed PDF via Miyo fallback: ${filename}`);
      return {
        status: "success",
        content,
        metadata: createMetadata(filename, deriveTitleFromFilename(filename), 0, content),
        errors: [],
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logWarn(`[LocalPdfParser] Miyo fallback failed for ${filename}: ${reason}`);
      return null;
    }
  }

  /**
   * Check whether the parser can invoke the optional Miyo fallback path.
   *
   * @param options - Conversion behavior overrides supplied by the caller.
   * @returns True when Miyo is enabled and an absolute source path is available.
   */
  private shouldUseMiyoFallback(options: ConversionOptions): boolean {
    return (
      isSelfHostModeValid() &&
      getSettings().enableMiyo &&
      typeof options.absoluteFilePath === "string" &&
      options.absoluteFilePath.trim().length > 0
    );
  }
}
