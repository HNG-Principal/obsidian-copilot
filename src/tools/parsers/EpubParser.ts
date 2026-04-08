import JSZip from "jszip";
import TurndownService from "turndown";
import type {
  ConversionError,
  ConversionOptions,
  ConversionResult,
  FileParser,
} from "./conversionTypes";

const XHTML_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
  "application/x-dtbook+xml",
]);

const FALLBACK_CHAPTER_PREFIX = "Chapter";
const DEFAULT_TEXT_ENCODING = "utf-8";

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

interface PackageDocument {
  title?: string;
  manifest: Map<string, ManifestItem>;
  spine: string[];
  navigationItem?: ManifestItem;
}

interface ChapterEntry {
  path: string;
  title: string;
  markdown: string;
}

/**
 * Normalize archive-relative paths to a stable forward-slash representation.
 *
 * @param value - Raw path from EPUB metadata or ZIP entries.
 * @returns Normalized relative path without leading "./" segments.
 */
function normalizeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  const segments = normalized.split("/");
  const resolvedSegments: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      resolvedSegments.pop();
      continue;
    }

    resolvedSegments.push(segment);
  }

  return resolvedSegments.join("/");
}

/**
 * Resolve an href relative to a source document inside the EPUB archive.
 *
 * @param sourcePath - Path of the referencing file inside the archive.
 * @param href - Relative or absolute href from the source file.
 * @returns Normalized archive-relative target path without any fragment.
 */
function resolveArchiveHref(sourcePath: string, href: string): string {
  const [pathWithoutFragment] = href.split("#");
  if (!pathWithoutFragment) {
    return "";
  }

  if (pathWithoutFragment.startsWith("/")) {
    return normalizeArchivePath(pathWithoutFragment);
  }

  const sourceSegments = normalizeArchivePath(sourcePath).split("/");
  sourceSegments.pop();

  return normalizeArchivePath([...sourceSegments, pathWithoutFragment].join("/"));
}

/**
 * Safely read the local-name of an XML or HTML element.
 *
 * @param element - Candidate element.
 * @returns Lower-cased local name when available.
 */
function getElementLocalName(element: Element): string {
  return (element.localName ?? element.nodeName).toLowerCase();
}

/**
 * Find the first descendant element matching a local name.
 *
 * @param parent - Root node to search within.
 * @param localName - Target local name ignoring namespaces.
 * @returns Matching element when found.
 */
function findFirstElementByLocalName(parent: ParentNode, localName: string): Element | null {
  const targetName = localName.toLowerCase();

  for (const element of Array.from(parent.querySelectorAll("*"))) {
    if (getElementLocalName(element) === targetName) {
      return element;
    }
  }

  return null;
}

/**
 * Find all descendant elements matching a local name.
 *
 * @param parent - Root node to search within.
 * @param localName - Target local name ignoring namespaces.
 * @returns Matching elements in document order.
 */
function findElementsByLocalName(parent: ParentNode, localName: string): Element[] {
  const targetName = localName.toLowerCase();
  return Array.from(parent.querySelectorAll("*")).filter(
    (element) => getElementLocalName(element) === targetName
  );
}

/**
 * Return normalized text content for an element.
 *
 * @param element - Element whose text should be read.
 * @returns Trimmed text content with collapsed whitespace.
 */
function getNormalizedElementText(element: Element | null): string {
  return normalizeTextContent(element?.textContent ?? "");
}

/**
 * Normalize decoded text by removing byte-order marks, broken control
 * characters, and inconsistent whitespace artifacts.
 *
 * @param value - Raw decoded text.
 * @returns Cleaned plain-text string.
 */
function normalizeTextContent(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\u00A0/g, " ")
    .replace(/\u00AD/g, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Build a stable markdown heading text from EPUB metadata or fallback content.
 *
 * @param value - Candidate heading text.
 * @param chapterNumber - One-based chapter index used for fallback generation.
 * @returns Sanitized heading text suitable for markdown.
 */
function normalizeChapterTitle(value: string, chapterNumber: number): string {
  const normalized = normalizeTextContent(value);
  return normalized || `${FALLBACK_CHAPTER_PREFIX} ${chapterNumber}`;
}

/**
 * Count words using a Unicode-aware tokenization heuristic.
 *
 * @param value - Markdown content to analyze.
 * @returns Approximate word count.
 */
function countWords(value: string): number {
  const matches = value.match(/\p{L}[\p{L}\p{N}'’-]*/gu);
  return matches?.length ?? 0;
}

/**
 * Detect the declared text encoding from an XML declaration or HTML meta tag.
 *
 * @param bytes - Raw file bytes.
 * @returns Declared encoding label when one is present.
 */
function detectDeclaredEncoding(bytes: Uint8Array): string | null {
  const sniffableBytes = Array.from(bytes.slice(0, 1024), (byte) => String.fromCharCode(byte)).join(
    ""
  );
  const xmlMatch = sniffableBytes.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i);
  if (xmlMatch?.[1]) {
    return xmlMatch[1].trim().toLowerCase();
  }

  const htmlMatch = sniffableBytes.match(/<meta[^>]+charset=["']?\s*([a-z0-9_-]+)\s*["']?/i);
  if (htmlMatch?.[1]) {
    return htmlMatch[1].trim().toLowerCase();
  }

  const httpEquivMatch = sniffableBytes.match(
    /<meta[^>]+content=["'][^"']*charset=([a-z0-9_-]+)[^"']*["']/i
  );
  return httpEquivMatch?.[1]?.trim().toLowerCase() ?? null;
}

/**
 * Decode raw EPUB entry bytes while honoring declared encodings when possible.
 *
 * @param bytes - Raw ZIP entry bytes.
 * @returns Decoded text content.
 */
function decodeArchiveText(bytes: Uint8Array): string {
  const declaredEncoding = detectDeclaredEncoding(bytes);
  const candidateEncodings = [
    declaredEncoding,
    DEFAULT_TEXT_ENCODING,
    "utf-16le",
    "windows-1252",
  ].filter(
    (encoding, index, values): encoding is string =>
      Boolean(encoding) && values.indexOf(encoding) === index
  );

  for (const encoding of candidateEncodings) {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      continue;
    }
  }

  return new TextDecoder(DEFAULT_TEXT_ENCODING).decode(bytes);
}

/**
 * Parse XML content into a DOM document.
 *
 * @param xml - XML source string.
 * @returns Parsed XML document.
 */
function parseXmlDocument(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

/**
 * Parse HTML or XHTML content into a DOM document.
 *
 * @param html - HTML source string.
 * @returns Parsed HTML document.
 */
function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * Determine whether a parsed XML document contains a parser error node.
 *
 * @param document - Parsed XML document.
 * @returns True when the document failed to parse cleanly.
 */
function hasXmlParserError(document: Document): boolean {
  return document.getElementsByTagName("parsererror").length > 0;
}

/**
 * Extract the package document path from META-INF/container.xml.
 *
 * @param containerXml - Raw container XML string.
 * @returns Normalized OPF path.
 */
function extractPackagePath(containerXml: string): string {
  const document = parseXmlDocument(containerXml);
  if (hasXmlParserError(document)) {
    throw new Error("Invalid EPUB container.xml");
  }

  const rootfile = findFirstElementByLocalName(document, "rootfile");
  const fullPath = rootfile?.getAttribute("full-path")?.trim();

  if (!fullPath) {
    throw new Error("EPUB container.xml is missing the package document path");
  }

  return normalizeArchivePath(fullPath);
}

/**
 * Parse the OPF package document into manifest and spine structures.
 *
 * @param packageXml - Raw OPF XML string.
 * @returns Structured package metadata.
 */
function parsePackageDocument(packageXml: string): PackageDocument {
  const document = parseXmlDocument(packageXml);
  if (hasXmlParserError(document)) {
    throw new Error("Invalid EPUB package document");
  }

  const manifest = new Map<string, ManifestItem>();
  for (const item of findElementsByLocalName(document, "item")) {
    const id = item.getAttribute("id")?.trim();
    const href = item.getAttribute("href")?.trim();
    const mediaType = item.getAttribute("media-type")?.trim().toLowerCase();
    if (!id || !href || !mediaType) {
      continue;
    }

    manifest.set(id, {
      id,
      href,
      mediaType,
      properties: (item.getAttribute("properties") ?? "")
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean),
    });
  }

  const spine = findElementsByLocalName(document, "itemref")
    .filter((element) => element.getAttribute("linear")?.toLowerCase() !== "no")
    .map((element) => element.getAttribute("idref")?.trim())
    .filter((idref): idref is string => Boolean(idref));

  const metadataElement = findFirstElementByLocalName(document, "metadata");
  const title =
    metadataElement &&
    findElementsByLocalName(metadataElement, "title")
      .map((element) => getNormalizedElementText(element))
      .find(Boolean);

  const navigationItem =
    Array.from(manifest.values()).find((item) => item.properties.includes("nav")) ??
    Array.from(manifest.values()).find((item) => item.mediaType === "application/x-dtbncx+xml");

  return {
    title: title || undefined,
    manifest,
    spine,
    navigationItem,
  };
}

/**
 * Resolve a ZIP entry from a normalized archive path.
 *
 * @param zip - Loaded ZIP archive.
 * @param archivePath - Target file path inside the archive.
 * @returns ZIP object when found.
 */
function getArchiveFile(zip: JSZip, archivePath: string): JSZip.JSZipObject | null {
  const normalizedPath = normalizeArchivePath(archivePath);
  return zip.file(normalizedPath) ?? null;
}

/**
 * Read a text file from the EPUB archive.
 *
 * @param zip - Loaded ZIP archive.
 * @param archivePath - Path to the target file inside the archive.
 * @returns Decoded text file contents.
 */
async function readArchiveText(zip: JSZip, archivePath: string): Promise<string> {
  const file = getArchiveFile(zip, archivePath);
  if (!file) {
    throw new Error(`Missing EPUB archive entry: ${archivePath}`);
  }

  const bytes = await file.async("uint8array");
  return decodeArchiveText(bytes);
}

/**
 * Extract chapter titles from a navigation document when the EPUB provides one.
 *
 * @param zip - Loaded ZIP archive.
 * @param packagePath - Path to the OPF package file.
 * @param navigationItem - Manifest entry for the navigation document.
 * @returns Map of chapter paths to titles.
 */
async function extractNavigationTitleMap(
  zip: JSZip,
  packagePath: string,
  navigationItem?: ManifestItem
): Promise<Map<string, string>> {
  const titleMap = new Map<string, string>();
  if (!navigationItem) {
    return titleMap;
  }

  const navigationPath = resolveArchiveHref(packagePath, navigationItem.href);
  const navigationText = await readArchiveText(zip, navigationPath);

  if (navigationItem.mediaType === "application/x-dtbncx+xml") {
    const navigationDocument = parseXmlDocument(navigationText);
    if (hasXmlParserError(navigationDocument)) {
      return titleMap;
    }

    for (const navPoint of findElementsByLocalName(navigationDocument, "navPoint")) {
      const contentElement = findFirstElementByLocalName(navPoint, "content");
      const labelElement = findFirstElementByLocalName(navPoint, "text");
      const src = contentElement?.getAttribute("src")?.trim();
      const title = getNormalizedElementText(labelElement);
      if (!src || !title) {
        continue;
      }

      titleMap.set(resolveArchiveHref(navigationPath, src), title);
    }

    return titleMap;
  }

  const navigationDocument = parseHtmlDocument(navigationText);
  const links = Array.from(navigationDocument.querySelectorAll("nav a, a"));

  for (const link of links) {
    const href = link.getAttribute("href")?.trim();
    const title = normalizeTextContent(link.textContent ?? "");
    if (!href || !title) {
      continue;
    }

    const resolvedPath = resolveArchiveHref(navigationPath, href);
    if (resolvedPath) {
      titleMap.set(resolvedPath, title);
    }
  }

  return titleMap;
}

/**
 * Create a Turndown instance configured for consistent chapter markdown output.
 *
 * @returns Configured Turndown service.
 */
function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  turndown.remove((node) => ["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(node.nodeName));
  return turndown;
}

/**
 * Remove leading headings that duplicate the chapter title we already emit.
 *
 * @param markdown - Markdown generated from the chapter body.
 * @param chapterTitle - Final chapter title rendered as the section heading.
 * @returns Markdown without the duplicated opening heading.
 */
function stripDuplicateLeadingHeading(markdown: string, chapterTitle: string): string {
  const normalizedTitle = chapterTitle.trim().toLowerCase();
  const lines = markdown.split("\n");

  while (lines.length > 0) {
    const firstLine = lines[0].trim();
    const headingMatch = firstLine.match(/^#{1,6}\s+(.*)$/);
    if (!headingMatch) {
      break;
    }

    if (headingMatch[1].trim().toLowerCase() !== normalizedTitle) {
      break;
    }

    lines.shift();
    while (lines[0]?.trim() === "") {
      lines.shift();
    }
    break;
  }

  return lines.join("\n").trim();
}

/**
 * Convert a chapter XHTML document into normalized markdown.
 *
 * @param chapterHtml - Raw chapter XHTML or HTML string.
 * @param fallbackTitle - Title to use when the chapter does not provide one internally.
 * @param chapterNumber - One-based chapter index.
 * @returns Structured chapter entry with heading and markdown body.
 */
function convertChapterToMarkdown(
  chapterHtml: string,
  fallbackTitle: string,
  chapterNumber: number
): ChapterEntry {
  const document = parseHtmlDocument(chapterHtml);
  const contentRoot = document.body ?? document.documentElement;

  Array.from(contentRoot.querySelectorAll("script, style, noscript")).forEach((element) =>
    element.remove()
  );

  const headingElement =
    contentRoot.querySelector("h1, h2, h3, h4, h5, h6") ?? document.querySelector("title");
  const chapterTitle = normalizeChapterTitle(
    headingElement?.textContent ?? fallbackTitle,
    chapterNumber
  );

  const bodyHtml = contentRoot.innerHTML ?? "";
  const markdown = normalizeTextContent(
    stripDuplicateLeadingHeading(createTurndownService().turndown(bodyHtml).trim(), chapterTitle)
  );

  return {
    path: "",
    title: chapterTitle,
    markdown,
  };
}

/**
 * Build the ordered list of chapter resources from the EPUB spine.
 *
 * @param packageDocument - Parsed OPF package structure.
 * @param packagePath - Path to the OPF package file.
 * @returns Archive paths for XHTML content documents in reading order.
 */
function getOrderedChapterPaths(packageDocument: PackageDocument, packagePath: string): string[] {
  const spinePaths = packageDocument.spine
    .map((idref) => packageDocument.manifest.get(idref))
    .filter((item): item is ManifestItem => Boolean(item))
    .filter((item) => !item.properties.includes("nav"))
    .filter((item) => XHTML_MEDIA_TYPES.has(item.mediaType))
    .map((item) => resolveArchiveHref(packagePath, item.href));

  if (spinePaths.length > 0) {
    return spinePaths;
  }

  return Array.from(packageDocument.manifest.values())
    .filter((item) => !item.properties.includes("nav"))
    .filter((item) => XHTML_MEDIA_TYPES.has(item.mediaType))
    .map((item) => resolveArchiveHref(packagePath, item.href))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Build a structured conversion result for a hard failure.
 *
 * @param filename - Original source filename.
 * @param message - Human-readable failure message.
 * @param code - Stable error code for the failure.
 * @returns Conversion result describing the failure.
 */
function createFailureResult(
  filename: string,
  message: string,
  code: ConversionError["code"]
): ConversionResult {
  return {
    status: "failure",
    content: "",
    metadata: {
      sourceFilename: filename,
      sourceFormat: "epub",
      wordCount: 0,
      conversionDate: new Date().toISOString(),
      ocrUsed: false,
    },
    errors: [{ code, message }],
  };
}

/**
 * Build a failure result while preserving extracted title metadata and any
 * chapter-level errors collected before conversion terminated.
 *
 * @param filename - Original source filename.
 * @param title - EPUB title extracted from package metadata.
 * @param message - Human-readable failure message.
 * @param errors - Recoverable errors captured during parsing.
 * @returns Failure conversion result with enriched metadata.
 */
function createContentFailureResult(
  filename: string,
  title: string | undefined,
  message: string,
  errors: ConversionError[]
): ConversionResult {
  const result = createFailureResult(filename, message, "parse_error");
  return {
    ...result,
    metadata: {
      ...result.metadata,
      title,
    },
    errors: errors.length > 0 ? [...errors, ...result.errors] : result.errors,
  };
}

/**
 * EPUB parser that extracts chapter content from the archive and converts it to markdown.
 */
export class EpubParser implements FileParser {
  public readonly formatId = "epub" as const;
  public readonly supportedMimeTypes = ["application/epub+zip"];
  public readonly displayName = "EPUB Parser";

  /**
   * Check whether the parser supports the provided MIME type.
   *
   * @param mimeType - MIME type provided by the caller.
   * @returns True when the EPUB parser can handle the MIME type.
   */
  public canHandle(mimeType: string): boolean {
    return this.supportedMimeTypes.includes(mimeType.toLowerCase());
  }

  /**
   * Convert an EPUB archive into structured markdown grouped by chapter.
   *
   * @param fileBuffer - Raw EPUB file bytes.
   * @param filename - Source filename for metadata.
   * @param _options - Conversion overrides supplied by the caller.
   * @returns Markdown conversion result with metadata and recoverable errors.
   */
  public async parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    _options: ConversionOptions
  ): Promise<ConversionResult> {
    try {
      const zip = await JSZip.loadAsync(fileBuffer);
      const containerXml = await readArchiveText(zip, "META-INF/container.xml");
      const packagePath = extractPackagePath(containerXml);
      const packageXml = await readArchiveText(zip, packagePath);
      const packageDocument = parsePackageDocument(packageXml);
      const navigationTitleMap = await extractNavigationTitleMap(
        zip,
        packagePath,
        packageDocument.navigationItem
      );
      const chapterPaths = getOrderedChapterPaths(packageDocument, packagePath);

      if (chapterPaths.length === 0) {
        return createFailureResult(
          filename,
          "The EPUB does not contain readable chapter documents.",
          "parse_error"
        );
      }

      const chapters: ChapterEntry[] = [];
      const errors: ConversionError[] = [];

      for (const [index, chapterPath] of chapterPaths.entries()) {
        try {
          const chapterHtml = await readArchiveText(zip, chapterPath);
          const fallbackTitle =
            navigationTitleMap.get(chapterPath) ?? `${FALLBACK_CHAPTER_PREFIX} ${index + 1}`;
          const chapter = convertChapterToMarkdown(chapterHtml, fallbackTitle, index + 1);

          if (!chapter.markdown) {
            continue;
          }

          chapters.push({
            ...chapter,
            path: chapterPath,
          });
        } catch (error) {
          errors.push({
            code: "parse_error",
            message: `Failed to parse chapter ${index + 1}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            page: index + 1,
          });
        }
      }

      const content = chapters
        .map((chapter) => `# ${chapter.title}\n\n${chapter.markdown}`.trim())
        .join("\n\n")
        .trim();

      if (!content) {
        return createContentFailureResult(
          filename,
          packageDocument.title,
          "The EPUB did not yield readable text content.",
          errors
        );
      }

      return {
        status: errors.length > 0 ? "partial" : "success",
        content,
        metadata: {
          title: packageDocument.title,
          sourceFilename: filename,
          sourceFormat: "epub",
          wordCount: countWords(content),
          conversionDate: new Date().toISOString(),
          ocrUsed: false,
        },
        errors,
      };
    } catch (error) {
      return createFailureResult(
        filename,
        error instanceof Error ? error.message : "Failed to parse EPUB archive.",
        "corrupt_file"
      );
    }
  }
}
