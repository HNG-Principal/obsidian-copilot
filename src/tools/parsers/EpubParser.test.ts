import JSZip from "jszip";
import { EpubParser } from "@/tools/parsers/EpubParser";

interface EpubChapterFixture {
  href: string;
  content: string | Uint8Array;
  navTitle?: string;
}

interface EpubFixtureOptions {
  title: string;
  chapters: EpubChapterFixture[];
}

const WINDOWS_1252_EXTRA_BYTES = new Map<string, number>([
  ["–", 0x96],
  ["—", 0x97],
  ["“", 0x93],
  ["”", 0x94],
  ["’", 0x92],
]);

/**
 * Encode a string using the limited Windows-1252 character set needed by the tests.
 *
 * @param value - Text that should be encoded.
 * @returns Encoded bytes suitable for a ZIP entry.
 */
function encodeWindows1252(value: string): Uint8Array {
  const bytes: number[] = [];

  for (const character of value) {
    const extraByte = WINDOWS_1252_EXTRA_BYTES.get(character);
    if (typeof extraByte === "number") {
      bytes.push(extraByte);
      continue;
    }

    const codePoint = character.codePointAt(0);
    if (typeof codePoint !== "number" || codePoint > 0xff) {
      throw new Error(`Unsupported Windows-1252 character in test fixture: ${character}`);
    }

    bytes.push(codePoint);
  }

  return Uint8Array.from(bytes);
}

/**
 * Build a minimal EPUB archive for parser unit tests.
 *
 * @param options - Fixture configuration for title and chapters.
 * @returns EPUB archive bytes as an ArrayBuffer.
 */
async function createEpubFixture(options: EpubFixtureOptions): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
  );

  const manifestItems = options.chapters
    .map(
      (chapter, index) =>
        `<item id="chapter-${index + 1}" href="${chapter.href}" media-type="application/xhtml+xml" />`
    )
    .join("\n    ");
  const spineItems = options.chapters
    .map((_, index) => `<itemref idref="chapter-${index + 1}" />`)
    .join("\n    ");
  const navItems = options.chapters
    .map(
      (chapter, index) =>
        `<li><a href="${chapter.href}">${chapter.navTitle ?? `Chapter ${index + 1}`}</a></li>`
    )
    .join("");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${options.title}</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <nav epub:type="toc">
      <ol>${navItems}</ol>
    </nav>
  </body>
</html>`
  );

  for (const chapter of options.chapters) {
    zip.file(`OEBPS/${chapter.href}`, chapter.content);
  }

  return zip.generateAsync({ type: "arraybuffer" });
}

describe("EpubParser", () => {
  it("extracts chapter structure in spine order and avoids duplicate headings", async () => {
    const parser = new EpubParser();
    const fileBuffer = await createEpubFixture({
      title: "Testing EPUB",
      chapters: [
        {
          href: "chapters/chapter-1.xhtml",
          navTitle: "Opening Move",
          content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h1>Opening Move</h1>
    <p>First chapter text.</p>
  </body>
</html>`,
        },
        {
          href: "chapters/chapter-2.xhtml",
          navTitle: "Endgame",
          content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <h2>Endgame</h2>
    <p>Second chapter text.</p>
  </body>
</html>`,
        },
      ],
    });

    const result = await parser.parse(fileBuffer, "book.epub", {});

    expect(result).toMatchObject({
      status: "success",
      content: "# Opening Move\n\nFirst chapter text.\n\n# Endgame\n\nSecond chapter text.",
      metadata: expect.objectContaining({
        title: "Testing EPUB",
        sourceFilename: "book.epub",
        sourceFormat: "epub",
        ocrUsed: false,
      }),
      errors: [],
    });
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(result.content.match(/^# /gm)).toHaveLength(2);
    expect(result.content.match(/Opening Move/g)).toHaveLength(1);
    expect(result.content.match(/Endgame/g)).toHaveLength(1);
  });

  it("strips HTML-only artifacts while preserving markdown structure", async () => {
    const parser = new EpubParser();
    const fileBuffer = await createEpubFixture({
      title: "HTML Cleanup",
      chapters: [
        {
          href: "chapter.xhtml",
          navTitle: "Clean Chapter",
          content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <style>.secret { display: none; }</style>
    <script>window.shouldNotAppear = true;</script>
  </head>
  <body>
    <h1>Clean Chapter</h1>
    <p>Paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
    <noscript>Fallback only</noscript>
    <ul>
      <li>First item</li>
      <li>Second item</li>
    </ul>
  </body>
</html>`,
        },
      ],
    });

    const result = await parser.parse(fileBuffer, "cleanup.epub", {});

    expect(result.status).toBe("success");
    expect(result.content).toContain("# Clean Chapter");
    expect(result.content).toContain("Paragraph with **bold** and *italic* text.");
    expect(result.content).toMatch(/-\s+First item/);
    expect(result.content).toMatch(/-\s+Second item/);
    expect(result.content).not.toContain("<strong>");
    expect(result.content).not.toContain("<script>");
    expect(result.content).not.toContain("window.shouldNotAppear");
    expect(result.content).not.toContain("display: none");
    expect(result.content).not.toContain("Fallback only");
  });

  it("honors declared text encodings for chapter documents", async () => {
    const parser = new EpubParser();
    const chapterHtml = `<?xml version="1.0" encoding="windows-1252"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="windows-1252" />
  </head>
  <body>
    <h1>Café Chapter</h1>
    <p>Résumé – déjà vu</p>
  </body>
</html>`;
    const fileBuffer = await createEpubFixture({
      title: "Encoded EPUB",
      chapters: [
        {
          href: "encoded.xhtml",
          navTitle: "Café Chapter",
          content: encodeWindows1252(chapterHtml),
        },
      ],
    });

    const result = await parser.parse(fileBuffer, "encoded.epub", {});

    expect(result.status).toBe("success");
    expect(result.content).toContain("# Café Chapter");
    expect(result.content).toContain("Résumé – déjà vu");
  });

  it("returns a failure result when the epub has no readable chapter text", async () => {
    const parser = new EpubParser();
    const fileBuffer = await createEpubFixture({
      title: "Empty EPUB",
      chapters: [
        {
          href: "empty.xhtml",
          navTitle: "Empty Chapter",
          content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <script>window.noText = true;</script>
    <style>.hidden { display: none; }</style>
  </body>
</html>`,
        },
      ],
    });

    const result = await parser.parse(fileBuffer, "empty.epub", {});

    expect(result).toMatchObject({
      status: "failure",
      content: "",
      metadata: expect.objectContaining({
        title: "Empty EPUB",
        sourceFilename: "empty.epub",
        sourceFormat: "epub",
        wordCount: 0,
      }),
      errors: [
        {
          code: "parse_error",
          message: "The EPUB did not yield readable text content.",
        },
      ],
    });
  });
});
