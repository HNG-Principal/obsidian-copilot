import JSZip from "jszip";
import {
  type ConversionError,
  type ConversionMetadata,
  type ConversionOptions,
  type ConversionResult,
  type FileParser,
} from "@/tools/parsers/conversionTypes";

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const RELATIONSHIP_NOTES_SLIDE_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const RELATIONSHIP_SLIDE_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const EMPTY_NOTES_PLACEHOLDER_TYPES = new Set(["dt", "ftr", "hdr", "sldImg", "slidenum"]);

interface SlideContent {
  title: string | null;
  body: string;
}

/**
 * PPTX parser that converts slide text and speaker notes into markdown.
 */
export class PptxParser implements FileParser {
  public readonly formatId = "pptx" as const;
  public readonly supportedMimeTypes = [PPTX_MIME_TYPE];
  public readonly displayName = "PowerPoint Parser";

  /**
   * Convert a PPTX buffer into slide-separated markdown.
   *
   * @param fileBuffer - Raw PPTX file bytes.
   * @param filename - Original source filename for metadata.
   * @param options - Optional conversion overrides.
   * @returns Structured markdown conversion output.
   */
  async parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult> {
    const metadata = createBaseMetadata(filename);

    try {
      const zip = await JSZip.loadAsync(fileBuffer);
      const orderedSlidePaths = await getOrderedSlidePaths(zip);
      const limitedSlidePaths =
        typeof options.maxPages === "number"
          ? orderedSlidePaths.slice(0, options.maxPages)
          : orderedSlidePaths;

      if (limitedSlidePaths.length === 0) {
        return createFailureResult(metadata, {
          code: "parse_error",
          message: "The presentation does not contain any readable slides.",
        });
      }

      const slideSections: string[] = [];
      const errors: ConversionError[] = [];
      let firstSlideTitle: string | null = null;
      let successfullyParsedSlideCount = 0;

      for (let index = 0; index < limitedSlidePaths.length; index += 1) {
        const slidePath = limitedSlidePaths[index];

        try {
          const slideText = await getZipText(zip, slidePath);
          if (!slideText) {
            errors.push({
              code: "parse_error",
              message: `Could not read slide XML for slide ${index + 1}.`,
              page: index + 1,
            });
            slideSections.push(formatSlideSection(index + 1, "", ""));
            continue;
          }

          const slideContent = extractSlideContent(slideText);
          if (!firstSlideTitle && slideContent.title) {
            firstSlideTitle = slideContent.title;
          }

          let notesMarkdown = "";

          try {
            const notesPath = await getNotesPathForSlide(zip, slidePath);
            const notesText = notesPath ? await getZipText(zip, notesPath) : null;
            notesMarkdown = notesText ? extractSpeakerNotes(notesText) : "";
          } catch (error) {
            errors.push({
              code: "parse_error",
              message: `Failed to parse speaker notes for slide ${index + 1}: ${getErrorMessage(error)}`,
              page: index + 1,
            });
          }

          slideSections.push(formatSlideSection(index + 1, slideContent.body, notesMarkdown));
          successfullyParsedSlideCount += 1;
        } catch (error) {
          errors.push({
            code: "parse_error",
            message: `Failed to parse slide ${index + 1}: ${getErrorMessage(error)}`,
            page: index + 1,
          });
          slideSections.push(formatSlideSection(index + 1, "", ""));
        }
      }

      const content = slideSections.join("\n\n").trim();
      const finalizedMetadata: ConversionMetadata = {
        ...metadata,
        title: firstSlideTitle ?? metadata.title,
        pageCount: limitedSlidePaths.length,
        wordCount: countWords(content),
      };

      return {
        status:
          errors.length === 0
            ? "success"
            : successfullyParsedSlideCount > 0 || content.length > 0
              ? "partial"
              : "failure",
        content,
        metadata: finalizedMetadata,
        errors,
      };
    } catch (error) {
      return createFailureResult(metadata, mapArchiveError(error));
    }
  }

  /**
   * Check whether the parser supports the provided MIME type.
   *
   * @param mimeType - MIME type to evaluate.
   * @returns True when the MIME type is supported.
   */
  canHandle(mimeType: string): boolean {
    const normalizedMimeType = mimeType.split(";")[0].trim().toLowerCase();
    return this.supportedMimeTypes.includes(normalizedMimeType);
  }
}

/**
 * Create the baseline conversion metadata for a PPTX file.
 *
 * @param filename - Source filename used for metadata.
 * @returns Metadata populated with stable defaults.
 */
function createBaseMetadata(filename: string): ConversionMetadata {
  return {
    title: stripFileExtension(filename),
    sourceFilename: filename,
    sourceFormat: "pptx",
    wordCount: 0,
    conversionDate: new Date().toISOString(),
    ocrUsed: false,
  };
}

/**
 * Build a failure result with consistent metadata and error formatting.
 *
 * @param metadata - Conversion metadata for the failed file.
 * @param error - Primary conversion error to surface.
 * @returns Failure-shaped conversion result.
 */
function createFailureResult(
  metadata: ConversionMetadata,
  error: ConversionError
): ConversionResult {
  return {
    status: "failure",
    content: "",
    metadata,
    errors: [error],
  };
}

/**
 * Resolve slide XML paths using the presentation manifest order when available.
 *
 * @param zip - Parsed PPTX archive.
 * @returns Ordered list of slide XML paths.
 */
async function getOrderedSlidePaths(zip: JSZip): Promise<string[]> {
  const presentationXml = await getZipText(zip, "ppt/presentation.xml");
  const relationshipsXml = await getZipText(zip, "ppt/_rels/presentation.xml.rels");

  if (presentationXml && relationshipsXml) {
    const orderedPaths = extractSlidePathsFromPresentation(presentationXml, relationshipsXml);
    if (orderedPaths.length > 0) {
      return orderedPaths;
    }
  }

  return Object.keys(zip.files)
    .map((filePath) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/u.exec(filePath);
      return match ? { filePath, slideNumber: Number(match[1]) } : null;
    })
    .filter((entry): entry is { filePath: string; slideNumber: number } => entry !== null)
    .sort((left, right) => left.slideNumber - right.slideNumber)
    .map((entry) => entry.filePath);
}

/**
 * Extract ordered slide part paths from the PPTX presentation manifest.
 *
 * @param presentationXml - `ppt/presentation.xml` content.
 * @param relationshipsXml - `ppt/_rels/presentation.xml.rels` content.
 * @returns Slide paths in presentation order.
 */
function extractSlidePathsFromPresentation(
  presentationXml: string,
  relationshipsXml: string
): string[] {
  const presentationDocument = parseXmlDocument(presentationXml, "presentation manifest");
  const relationshipsDocument = parseXmlDocument(relationshipsXml, "presentation relationships");
  const relationshipTargets = extractRelationshipTargets(
    relationshipsDocument,
    RELATIONSHIP_SLIDE_TYPE
  );
  const slideIdElements = getDescendantElementsByLocalName(
    presentationDocument.documentElement,
    "sldId"
  );

  return slideIdElements
    .map((element) => {
      const relationshipId = getAttributeByName(element, "r:id");
      const target = relationshipId ? relationshipTargets.get(relationshipId) : null;
      return target ? resolveZipPath("ppt/presentation.xml", target) : null;
    })
    .filter((path): path is string => path !== null);
}

/**
 * Resolve the notes slide path referenced by a slide relationship file.
 *
 * @param zip - Parsed PPTX archive.
 * @param slidePath - Slide XML path inside the archive.
 * @returns Notes slide XML path when present.
 */
async function getNotesPathForSlide(zip: JSZip, slidePath: string): Promise<string | null> {
  const relationshipPath = getRelationshipPath(slidePath);
  const relationshipsXml = await getZipText(zip, relationshipPath);

  if (!relationshipsXml) {
    return null;
  }

  const relationshipsDocument = parseXmlDocument(
    relationshipsXml,
    `relationships for ${slidePath}`
  );
  const relationshipTargets = extractRelationshipTargets(
    relationshipsDocument,
    RELATIONSHIP_NOTES_SLIDE_TYPE
  );
  const firstTarget = relationshipTargets.values().next();

  return firstTarget.done ? null : resolveZipPath(slidePath, firstTarget.value);
}

/**
 * Read a text file from the PPTX archive.
 *
 * @param zip - Parsed PPTX archive.
 * @param filePath - Path of the file to read.
 * @returns UTF-8 text content when the file exists.
 */
async function getZipText(zip: JSZip, filePath: string): Promise<string | null> {
  const entry = zip.file(filePath);
  return entry ? await entry.async("text") : null;
}

/**
 * Parse slide XML into a title and markdown-friendly body text.
 *
 * @param slideXml - Raw slide XML string.
 * @returns Extracted slide text grouped by shape.
 */
function extractSlideContent(slideXml: string): SlideContent {
  const document = parseXmlDocument(slideXml, "slide");
  const shapeElements = getDescendantElementsByLocalName(document.documentElement, "sp");
  const titleBlocks: string[] = [];
  const bodyBlocks: string[] = [];

  for (const shapeElement of shapeElements) {
    const blockText = extractShapeText(shapeElement);
    if (!blockText) {
      continue;
    }

    const placeholderType = getShapePlaceholderType(shapeElement);
    if (placeholderType === "title" || placeholderType === "ctrTitle") {
      titleBlocks.push(blockText);
      bodyBlocks.push(blockText);
      continue;
    }

    bodyBlocks.push(blockText);
  }

  return {
    title: titleBlocks[0] ?? null,
    body: bodyBlocks.join("\n\n").trim(),
  };
}

/**
 * Extract speaker notes text and format it as markdown blockquotes.
 *
 * @param notesXml - Raw notes slide XML string.
 * @returns Markdown blockquote content for the notes section.
 */
function extractSpeakerNotes(notesXml: string): string {
  const document = parseXmlDocument(notesXml, "speaker notes");
  const shapeElements = getDescendantElementsByLocalName(document.documentElement, "sp");
  const noteBlocks: string[] = [];

  for (const shapeElement of shapeElements) {
    const placeholderType = getShapePlaceholderType(shapeElement);
    if (placeholderType && EMPTY_NOTES_PLACEHOLDER_TYPES.has(placeholderType)) {
      continue;
    }

    const blockText = extractShapeText(shapeElement);
    if (blockText) {
      noteBlocks.push(blockText);
    }
  }

  return noteBlocks
    .join("\n\n")
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n")
    .trim();
}

/**
 * Extract the readable text for a single PowerPoint shape.
 *
 * @param shapeElement - Shape XML element.
 * @returns Normalized text content for the shape.
 */
function extractShapeText(shapeElement: Element): string {
  const textBody = getFirstDescendantElementByLocalName(shapeElement, "txBody");
  if (!textBody) {
    return "";
  }

  const paragraphElements = getDirectChildElementsByLocalName(textBody, "p");
  return paragraphElements
    .map((paragraphElement) => normalizeParagraphText(extractParagraphText(paragraphElement)))
    .filter((paragraphText) => paragraphText.length > 0)
    .join("\n")
    .trim();
}

/**
 * Extract raw text from a paragraph while preserving explicit line breaks.
 *
 * @param paragraphElement - Paragraph XML element.
 * @returns Paragraph text before whitespace normalization.
 */
function extractParagraphText(paragraphElement: Element): string {
  let textContent = "";

  for (const childNode of Array.from(paragraphElement.childNodes)) {
    textContent += extractNodeText(childNode);
  }

  return textContent;
}

/**
 * Recursively extract text content from an XML node.
 *
 * @param node - XML node to inspect.
 * @returns Extracted text for the node subtree.
 */
function extractNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
  if (element.localName === "br") {
    return "\n";
  }

  if (element.localName === "tab") {
    return " ";
  }

  let textContent = "";
  for (const childNode of Array.from(element.childNodes)) {
    textContent += extractNodeText(childNode);
  }

  return textContent;
}

/**
 * Normalize PowerPoint paragraph text for markdown output.
 *
 * @param paragraphText - Raw paragraph text extracted from XML.
 * @returns Cleaned paragraph text.
 */
function normalizeParagraphText(paragraphText: string): string {
  return paragraphText
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Format a slide section with a required markdown heading and optional notes.
 *
 * @param slideNumber - One-based slide index.
 * @param slideBody - Extracted slide body text.
 * @param notesMarkdown - Extracted speaker notes as markdown blockquotes.
 * @returns Markdown section for the slide.
 */
function formatSlideSection(slideNumber: number, slideBody: string, notesMarkdown: string): string {
  const sectionParts = [`## Slide ${slideNumber}`];

  if (slideBody.trim().length > 0) {
    sectionParts.push(slideBody.trim());
  }

  if (notesMarkdown.trim().length > 0) {
    sectionParts.push(notesMarkdown.trim());
  }

  return sectionParts.join("\n\n");
}

/**
 * Parse XML text into a DOM document and surface parser failures clearly.
 *
 * @param xmlText - XML source to parse.
 * @param contextLabel - Human-readable context for error messages.
 * @returns Parsed XML document.
 */
function parseXmlDocument(xmlText: string, contextLabel: string): XMLDocument {
  const document = new DOMParser().parseFromString(xmlText.trim(), "application/xml");
  const parserError = document.getElementsByTagName("parsererror")[0];

  if (parserError) {
    throw new Error(`Invalid ${contextLabel} XML.`);
  }

  return document;
}

/**
 * Extract relationship targets for a specific relationship type.
 *
 * @param relationshipsDocument - Parsed relationships XML document.
 * @param relationshipType - Relationship type URI to match.
 * @returns Mapping of relationship ids to target paths.
 */
function extractRelationshipTargets(
  relationshipsDocument: XMLDocument,
  relationshipType: string
): Map<string, string> {
  const relationships = getDescendantElementsByLocalName(
    relationshipsDocument.documentElement,
    "Relationship"
  );
  const targets = new Map<string, string>();

  for (const relationshipElement of relationships) {
    const type = getAttributeByName(relationshipElement, "Type");
    const id = getAttributeByName(relationshipElement, "Id");
    const target = getAttributeByName(relationshipElement, "Target");

    if (type === relationshipType && id && target) {
      targets.set(id, target);
    }
  }

  return targets;
}

/**
 * Resolve a zip-internal relative target path against a source file path.
 *
 * @param sourcePath - Source archive file path.
 * @param targetPath - Relative target path from a relationship.
 * @returns Normalized archive path.
 */
function resolveZipPath(sourcePath: string, targetPath: string): string {
  const sourceSegments = sourcePath.split("/");
  const resolvedSegments = sourceSegments.slice(0, -1);

  for (const segment of targetPath.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (resolvedSegments.length > 0) {
        resolvedSegments.pop();
      }
      continue;
    }

    resolvedSegments.push(segment);
  }

  return resolvedSegments.join("/");
}

/**
 * Convert a part path to the conventional `.rels` sidecar path.
 *
 * @param filePath - Primary PPTX part path.
 * @returns Relationships path associated with the part.
 */
function getRelationshipPath(filePath: string): string {
  const pathSegments = filePath.split("/");
  const fileName = pathSegments.pop() ?? "";
  return `${pathSegments.join("/")}/_rels/${fileName}.rels`;
}

/**
 * Read the placeholder type associated with a shape when one exists.
 *
 * @param shapeElement - Shape XML element.
 * @returns Placeholder type such as `title`, `body`, or `null`.
 */
function getShapePlaceholderType(shapeElement: Element): string | null {
  const placeholderElement = getFirstDescendantElementByLocalName(shapeElement, "ph");
  const type = placeholderElement ? getAttributeByName(placeholderElement, "type") : null;
  return type ? type.trim() : null;
}

/**
 * Recursively collect descendant elements with the requested local name.
 *
 * @param rootElement - Root element to search beneath.
 * @param localName - Local name to match.
 * @returns Matching descendant elements in document order.
 */
function getDescendantElementsByLocalName(rootElement: Element, localName: string): Element[] {
  const matches: Element[] = [];

  for (const childNode of Array.from(rootElement.childNodes)) {
    if (childNode.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const childElement = childNode as Element;
    if (childElement.localName === localName || childElement.tagName === localName) {
      matches.push(childElement);
    }

    matches.push(...getDescendantElementsByLocalName(childElement, localName));
  }

  return matches;
}

/**
 * Return the first descendant element with the requested local name.
 *
 * @param rootElement - Root element to search beneath.
 * @param localName - Local name to match.
 * @returns First matching descendant element when present.
 */
function getFirstDescendantElementByLocalName(
  rootElement: Element,
  localName: string
): Element | null {
  const matches = getDescendantElementsByLocalName(rootElement, localName);
  return matches[0] ?? null;
}

/**
 * Collect direct child elements with the requested local name.
 *
 * @param rootElement - Parent element whose children should be inspected.
 * @param localName - Local name to match.
 * @returns Direct child elements that match the requested name.
 */
function getDirectChildElementsByLocalName(rootElement: Element, localName: string): Element[] {
  return Array.from(rootElement.childNodes).filter((childNode): childNode is Element => {
    return (
      childNode.nodeType === Node.ELEMENT_NODE &&
      ((childNode as Element).localName === localName ||
        (childNode as Element).tagName === localName)
    );
  });
}

/**
 * Read an attribute by its raw name or namespace-local name.
 *
 * @param element - Element containing the attribute.
 * @param attributeName - Attribute name to retrieve.
 * @returns Attribute value when present.
 */
function getAttributeByName(element: Element, attributeName: string): string | null {
  if (element.hasAttribute(attributeName)) {
    return element.getAttribute(attributeName);
  }

  const attributeLocalName = attributeName.includes(":")
    ? attributeName.split(":")[attributeName.split(":").length - 1]
    : attributeName;

  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === attributeName || attribute.localName === attributeLocalName) {
      return attribute.value;
    }
  }

  return null;
}

/**
 * Count markdown words using a whitespace-delimited heuristic.
 *
 * @param content - Markdown content to inspect.
 * @returns Estimated word count.
 */
function countWords(content: string): number {
  const trimmedContent = content.trim();
  return trimmedContent.length > 0 ? trimmedContent.split(/\s+/u).length : 0;
}

/**
 * Remove the final filename extension from a path-like filename.
 *
 * @param filename - Source filename.
 * @returns Filename without the trailing extension.
 */
function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/u, "");
}

/**
 * Convert an unknown thrown value into a readable error message.
 *
 * @param error - Unknown error value.
 * @returns Human-readable error string.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Translate archive parsing errors into typed conversion errors.
 *
 * @param error - Unknown failure raised while loading the PPTX archive.
 * @returns Structured conversion error.
 */
function mapArchiveError(error: unknown): ConversionError {
  const message = getErrorMessage(error);
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("password")) {
    return {
      code: "password_protected",
      message: "The presentation appears to be password protected and could not be opened.",
    };
  }

  if (normalizedMessage.includes("corrupt") || normalizedMessage.includes("crc32")) {
    return {
      code: "corrupt_file",
      message: "The presentation archive appears to be corrupted.",
    };
  }

  if (normalizedMessage.includes("zip")) {
    return {
      code: "corrupt_file",
      message: "The presentation is not a valid PPTX archive.",
    };
  }

  return {
    code: "parse_error",
    message,
  };
}
