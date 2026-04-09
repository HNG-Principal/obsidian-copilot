import { utils, write } from "xlsx";

import { XlsxParser } from "@/tools/parsers/XlsxParser";

const FIXED_CONVERSION_DATE = new Date("2024-03-15T12:00:00.000Z");

/**
 * Convert a Node.js Buffer into an exact ArrayBuffer view.
 *
 * @param buffer - Buffer returned by SheetJS workbook serialization.
 * @returns ArrayBuffer containing only the workbook bytes.
 */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const exactBytes = new Uint8Array(buffer.byteLength);
  exactBytes.set(buffer);
  return exactBytes.buffer as ArrayBuffer;
}

/**
 * Create an XLSX workbook buffer from a list of sheet definitions.
 *
 * @param sheets - Workbook sheets in output order.
 * @returns Serialized workbook bytes suitable for parser input.
 */
function createWorkbookBuffer(
  sheets: Array<{ name: string; rows: Array<Array<string | number | Date | null | undefined>> }>
): ArrayBuffer {
  const workbook = utils.book_new();

  for (const sheet of sheets) {
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(sheet.rows), sheet.name);
  }

  return toArrayBuffer(write(workbook, { bookType: "xlsx", type: "buffer" }));
}

/**
 * Encode CSV-like plaintext input into an ArrayBuffer for parser tests.
 *
 * @param content - Delimited text document content.
 * @returns Binary representation accepted by the parser.
 */
function createDelimitedTextBuffer(content: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(content);
  const exactBytes = new Uint8Array(encoded.byteLength);
  exactBytes.set(encoded);
  return exactBytes.buffer as ArrayBuffer;
}

describe("XlsxParser", () => {
  let parser: XlsxParser;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_CONVERSION_DATE);
    parser = new XlsxParser();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("converts a single worksheet into a markdown table", async () => {
    const result = await parser.parse(
      createWorkbookBuffer([
        {
          name: "Team",
          rows: [
            ["Name", "Role"],
            ["Ada", "Engineer"],
            ["Grace", "Scientist"],
          ],
        },
      ]),
      "team.xlsx",
      {}
    );

    expect(result.status).toBe("success");
    expect(result.content).toBe(
      "## Sheet: Team\n\n| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n| Grace | Scientist |"
    );
    expect(result.metadata).toMatchObject({
      title: "team",
      sourceFilename: "team.xlsx",
      sourceFormat: "xlsx",
      pageCount: 1,
      conversionDate: FIXED_CONVERSION_DATE.toISOString(),
      ocrUsed: false,
    });
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it("preserves workbook sheet order when rendering multiple sheets", async () => {
    const result = await parser.parse(
      createWorkbookBuffer([
        {
          name: "Summary",
          rows: [
            ["Metric", "Value"],
            ["Tickets", 12],
          ],
        },
        {
          name: "Backlog",
          rows: [
            ["Item", "Status"],
            ["Parser tests", "Done"],
          ],
        },
      ]),
      "roadmap.xlsx",
      {}
    );

    expect(result.status).toBe("success");
    expect(result.metadata.pageCount).toBe(2);
    expect(result.content).toBe(
      "## Sheet: Summary\n\n| Metric | Value |\n| --- | --- |\n| Tickets | 12 |\n\n## Sheet: Backlog\n\n| Item | Status |\n| --- | --- |\n| Parser tests | Done |"
    );
  });

  it("formats markdown table cells safely for markdown output", async () => {
    const result = await parser.parse(
      createWorkbookBuffer([
        {
          name: "Notes",
          rows: [
            ["Feature", "Details", "Owner"],
            ["Formatting", "Line one\nLine two | escaped", ""],
          ],
        },
      ]),
      "notes.xlsx",
      {}
    );

    expect(result.status).toBe("success");
    expect(result.content).toContain("| Feature | Details | Owner |");
    expect(result.content).toContain("| --- | --- | --- |");
    expect(result.content).toContain("| Formatting | Line one<br>Line two \\| escaped |  |");
  });

  it("parses CSV input through the spreadsheet parser", async () => {
    const result = await parser.parse(
      createDelimitedTextBuffer("Name,Role\nAda,Engineer\nGrace,Scientist"),
      "team.csv",
      {}
    );

    expect(result.status).toBe("success");
    expect(result.content).toBe(
      "## Sheet: Sheet1\n\n| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n| Grace | Scientist |"
    );
    expect(result.metadata).toMatchObject({
      title: "team",
      sourceFilename: "team.csv",
      sourceFormat: "csv",
      pageCount: 1,
      conversionDate: FIXED_CONVERSION_DATE.toISOString(),
      ocrUsed: false,
    });
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it("parses TSV input with a tab separator override", async () => {
    const result = await parser.parse(
      createDelimitedTextBuffer("Name\tRole\nAda\tEngineer\nGrace\tScientist"),
      "team.tsv",
      {}
    );

    expect(result.status).toBe("success");
    expect(result.metadata.sourceFormat).toBe("csv");
    expect(result.content).toBe(
      "## Sheet: Sheet1\n\n| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n| Grace | Scientist |"
    );
  });

  it("marks empty worksheets with an explicit empty-sheet message", async () => {
    const result = await parser.parse(
      createWorkbookBuffer([
        {
          name: "Empty",
          rows: [],
        },
      ]),
      "empty.xlsx",
      {}
    );

    expect(result.status).toBe("success");
    expect(result.content).toBe("## Sheet: Empty\n\n_Sheet is empty._");
    expect(result.metadata).toMatchObject({
      title: "empty",
      sourceFilename: "empty.xlsx",
      sourceFormat: "xlsx",
      pageCount: 1,
      conversionDate: FIXED_CONVERSION_DATE.toISOString(),
      ocrUsed: false,
    });
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });
});
