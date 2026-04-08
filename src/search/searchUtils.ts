import { CustomError } from "@/error";
import EmbeddingsManager from "@/LLMProviders/embeddingManager";
import { getSettings } from "@/settings/model";
import { logFileManager } from "@/logFileManager";
import { getTagsFromNote, stripHash } from "@/utils";
import { Embeddings } from "@langchain/core/embeddings";
import { MD5 } from "crypto-js";
import { App, TFile } from "obsidian";

export interface PatternCategory {
  tagPatterns?: string[];
  extensionPatterns?: string[];
  folderPatterns?: string[];
  notePatterns?: string[];
}

/**
 * Compute a deterministic MD5 hash for document content.
 *
 * @param content - Raw document content.
 * @returns Lowercase MD5 hex digest.
 */
export function computeContentHash(content: string): string {
  return MD5(content).toString();
}

/**
 * Parse a date embedded in a file name.
 *
 * Supported patterns: `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYYMMDD`.
 *
 * @param filename - File name or path.
 * @returns UTC timestamp for the detected date, or undefined.
 */
export function parseTitleDate(filename: string): number | undefined {
  const basename = filename.split("/").pop() ?? filename;
  const stem = basename.replace(/\.[^.]+$/, "");
  const match = stem.match(/(?:^|[^\d])(\d{4})([-.]?)(\d{2})\2(\d{2})(?:[^\d]|$)/);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }

  return parsed.getTime();
}

/**
 * Extract normalized tags from markdown frontmatter and inline content.
 *
 * @param content - Raw markdown document.
 * @returns Unique lowercase tags with leading hash.
 */
export function extractMarkdownTags(content: string): string[] {
  const tags = new Set<string>();
  const { body, frontmatter } = splitFrontmatter(content);

  for (const tag of extractFrontmatterTags(frontmatter)) {
    tags.add(normalizeTag(tag));
  }

  const inlineRegex = getInlineTagRegExp();
  for (const match of body.matchAll(inlineRegex)) {
    const rawTag = match[0].trim();
    if (rawTag.length > 1) {
      tags.add(normalizeTag(rawTag));
    }
  }

  return Array.from(tags);
}

/**
 * Extract markdown headings as plain text.
 *
 * @param content - Raw markdown document.
 * @returns Ordered heading texts without markdown markers.
 */
export function extractMarkdownHeadings(content: string): string[] {
  const { body } = splitFrontmatter(content);
  const headings: string[] = [];
  let inCodeFence = false;

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    const match = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (match) {
      headings.push(match[2].trim());
    }
  }

  return headings;
}

/**
 * Count human-readable words in markdown content.
 *
 * @param content - Raw markdown document.
 * @returns Total word count after removing frontmatter.
 */
export function computeWordCount(content: string): number {
  const { body } = splitFrontmatter(content);
  const matches = body.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}

export async function getVectorLength(embeddingInstance: Embeddings | undefined): Promise<number> {
  if (!embeddingInstance) {
    throw new CustomError("Embedding instance not found.");
  }
  try {
    const sampleText = "Sample text for embedding";
    const sampleEmbedding = await embeddingInstance.embedQuery(sampleText);

    if (!sampleEmbedding || sampleEmbedding.length === 0) {
      throw new CustomError("Failed to get valid embedding vector length");
    }

    console.log(
      `Detected vector length: ${sampleEmbedding.length} for model: ${EmbeddingsManager.getModelName(embeddingInstance)}`
    );
    return sampleEmbedding.length;
  } catch (error) {
    console.error("Error getting vector length:", error);
    throw new CustomError(
      "Failed to determine embedding vector length. Please check your Copilot settings to make sure you have a working embedding model."
    );
  }
}

export async function getAllQAMarkdownContent(app: App): Promise<string> {
  let allContent = "";

  const { inclusions, exclusions } = getMatchingPatterns();

  const filteredFiles = app.vault.getMarkdownFiles().filter((file) => {
    return shouldIndexFile(file, inclusions, exclusions);
  });

  await Promise.all(filteredFiles.map((file) => app.vault.cachedRead(file))).then((contents) =>
    contents.map((c) => (allContent += c + " "))
  );

  return allContent;
}

/**
 * Get the decoded patterns from the settings string.
 * @param value - The settings string.
 * @returns An array of decoded patterns.
 */
export function getDecodedPatterns(value: string): string[] {
  const patterns: string[] = [];
  patterns.push(
    ...value
      .split(",")
      .map((item) => {
        const trimmed = item.trim();
        try {
          return decodeURIComponent(trimmed);
        } catch {
          // Return original value if decodeURIComponent fails (e.g., invalid % sequence)
          return trimmed;
        }
      })
      .filter((item) => item.length > 0)
  );

  return patterns;
}

/**
 * Get the exclusion patterns from the exclusion settings string.
 * @returns An array of exclusion patterns.
 */
function getExclusionPatterns(): string[] {
  if (!getSettings().qaExclusions) {
    return [];
  }

  return getDecodedPatterns(getSettings().qaExclusions);
}

/**
 * Get the inclusion patterns from the inclusion settings string.
 * @returns An array of inclusion patterns.
 */
function getInclusionPatterns(): string[] {
  if (!getSettings().qaInclusions) {
    return [];
  }

  return getDecodedPatterns(getSettings().qaInclusions);
}

/**
 * Get the inclusion and exclusion patterns from the settings or provided values.
 * NOTE: isProject is used to determine if the patterns should be used for a project, ignoring global inclusions and exclusions
 * @param options - Optional parameters for inclusions and exclusions.
 * @returns An object containing the inclusions and exclusions patterns strings.
 */
export function getMatchingPatterns(options?: {
  inclusions?: string;
  exclusions?: string;
  isProject?: boolean;
}): {
  inclusions: PatternCategory | null;
  exclusions: PatternCategory | null;
} {
  // For projects, don't fall back to global patterns
  const inclusionPatterns = options?.inclusions
    ? getDecodedPatterns(options.inclusions)
    : options?.isProject
      ? []
      : getInclusionPatterns();

  const exclusionPatterns = options?.exclusions
    ? getDecodedPatterns(options.exclusions)
    : options?.isProject
      ? []
      : getExclusionPatterns();

  return {
    inclusions: inclusionPatterns.length > 0 ? categorizePatterns(inclusionPatterns) : null,
    exclusions: exclusionPatterns.length > 0 ? categorizePatterns(exclusionPatterns) : null,
  };
}

/**
 * Should index the file based on the inclusions and exclusions patterns.
 * @param file - The file to check.
 * @param inclusions - The inclusions patterns.
 * @param exclusions - The exclusions patterns.
 * @param isProject - Project: Only the included files need to be processed, setting vault embedding： All files not excluded need to be processed.
 * @returns True if the file should be indexed, false otherwise.
 */
export function shouldIndexFile(
  file: TFile,
  inclusions: PatternCategory | null,
  exclusions: PatternCategory | null,
  isProject?: boolean
): boolean {
  // Always exclude Copilot's own log file from Copilot searches/indexing
  if (isInternalExcludedFile(file)) {
    return false;
  }
  if (exclusions && matchFilePathWithPatterns(file.path, exclusions)) {
    return false;
  }
  if (inclusions && !matchFilePathWithPatterns(file.path, inclusions)) {
    return false;
  }

  // Project: Only the included files need to be processed.
  if (isProject && !inclusions) {
    return false;
  }

  return true;
}

/**
 * Break down the patterns into their respective categories.
 * @param patterns - The patterns to categorize.
 * @returns An object containing the categorized patterns.
 */
export function categorizePatterns(patterns: string[]) {
  const tagPatterns: string[] = [];
  const extensionPatterns: string[] = [];
  const folderPatterns: string[] = [];
  const notePatterns: string[] = [];

  const tagRegex = /^#[^\s#]+$/; // Matches #tag format
  const extensionRegex = /^\*\.([a-zA-Z0-9.]+)$/; // Matches *.extension format
  const noteRegex = /^\[\[(.*?)\]\]$/; // Matches [[note name]] format - removed global flag and added ^ $

  patterns.forEach((pattern) => {
    if (tagRegex.test(pattern)) {
      tagPatterns.push(pattern);
    } else if (extensionRegex.test(pattern)) {
      extensionPatterns.push(pattern);
    } else if (noteRegex.test(pattern)) {
      notePatterns.push(pattern);
    } else {
      folderPatterns.push(pattern);
    }
  });

  return { tagPatterns, extensionPatterns, folderPatterns, notePatterns };
}

/**
 * Convert the pattern settings value to a preview string.
 * @param value - The value to preview.
 * @returns The previewed value.
 */
export function previewPatternValue(value: string): string {
  const patterns = getDecodedPatterns(value);
  return patterns.join(", ");
}

/**
 * Create the pattern settings value from the categorized patterns.
 * @param tagPatterns - The tag patterns.
 * @param extensionPatterns - The extension patterns.
 * @param folderPatterns - The folder patterns.
 * @param notePatterns - The note patterns.
 * @returns The pattern settings value.
 */
export function createPatternSettingsValue({
  tagPatterns,
  extensionPatterns,
  folderPatterns,
  notePatterns,
}: PatternCategory) {
  const patterns = [
    ...(tagPatterns ?? []),
    ...(extensionPatterns ?? []),
    ...(notePatterns ?? []),
    ...(folderPatterns ?? []),
  ].map((pattern) => encodeURIComponent(pattern));

  return patterns.join(",");
}

/**
 * Match the file path with the tag patterns.
 * @param filePath - The file path to match.
 * @param tagPatterns - The tag patterns to match the file path with.
 * @returns True if the file path matches the tags, false otherwise.
 */
function matchFilePathWithTags(filePath: string, tagPatterns: string[]): boolean {
  if (tagPatterns.length === 0) return false;

  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    const tags = getTagsFromNote(file);
    if (
      tagPatterns.some((pattern) =>
        tags.some((tag) => tag.toLowerCase() === stripHash(pattern).toLowerCase())
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Match the file path with the extension patterns.
 * @param filePath - The file path to match.
 * @param extensionPatterns - The extension patterns to match the file path with.
 * @returns True if the file path matches the extensions, false otherwise.
 */
function matchFilePathWithExtensions(filePath: string, extensionPatterns: string[]): boolean {
  if (extensionPatterns.length === 0) return false;

  // Convert file path to lowercase for case-insensitive matching
  const normalizedPath = filePath.toLowerCase();

  // Check if the file path ends with any of the extension patterns
  return extensionPatterns.some((pattern) => {
    // Convert *.extension to .extension
    const patternExt = pattern.slice(1).toLowerCase();
    return normalizedPath.endsWith(patternExt);
  });
}

/**
 * Match the file path with the folder patterns.
 * @param filePath - The file path to match.
 * @param folderPatterns - The folder patterns to match the file path with.
 * @returns True if the file path matches the folders, false otherwise.
 */
function matchFilePathWithFolders(filePath: string, folderPatterns: string[]): boolean {
  if (folderPatterns.length === 0) return false;

  // Normalize path separators to forward slashes to ensure cross-platform compatibility
  const normalizedFilePath = filePath.replace(/\\/g, "/");

  return folderPatterns.some((pattern) => {
    // Normalize pattern path separators and remove trailing slashes
    const normalizedPattern = pattern.replace(/\\/g, "/").replace(/\/$/, "");

    // Check if the path starts with the pattern
    return (
      normalizedFilePath.startsWith(normalizedPattern) &&
      // Ensure it's a proper folder match by checking for / after pattern
      (normalizedFilePath.length === normalizedPattern.length ||
        normalizedFilePath[normalizedPattern.length] === "/")
    );
  });
}

/**
 * Match the file path with the note title patterns.
 * @param filePath - The file path to match.
 * @param notePatterns - The note patterns to match the file path with.
 * @returns True if the file path matches the note titles, false otherwise.
 */
function matchFilePathWithNotes(filePath: string, noteTitles: string[]): boolean {
  if (noteTitles.length === 0) return false;

  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    if (noteTitles.some((title) => title.slice(2, -2) === file.basename)) {
      return true;
    }
  }
  return false;
}

/**
 * Match the file path with the patterns.
 * @param filePath - The file path to match.
 * @param patterns - The patterns to match the file path with.
 * @returns True if the file path matches the patterns, false otherwise.
 */
function matchFilePathWithPatterns(filePath: string, patterns: PatternCategory): boolean {
  if (!patterns) return false;

  const { tagPatterns, extensionPatterns, folderPatterns, notePatterns } = patterns;

  return (
    matchFilePathWithTags(filePath, tagPatterns ?? []) ||
    matchFilePathWithExtensions(filePath, extensionPatterns ?? []) ||
    matchFilePathWithFolders(filePath, folderPatterns ?? []) ||
    matchFilePathWithNotes(filePath, notePatterns ?? [])
  );
}

export function extractAppIgnoreSettings(app: App): string[] {
  const appIgnoreFolders: string[] = [];
  try {
    // Check if getConfig method exists (it won't in tests)
    if (typeof (app.vault as any).getConfig === "function") {
      const userIgnoreFilters: unknown = (app.vault as any).getConfig("userIgnoreFilters");

      if (!!userIgnoreFilters && Array.isArray(userIgnoreFilters)) {
        userIgnoreFilters.forEach((it) => {
          if (typeof it === "string") {
            appIgnoreFolders.push(it.endsWith("/") ? it.slice(0, -1) : it);
          }
        });
      }
    }
  } catch (e) {
    // Only log in non-test environments
    if (process.env.NODE_ENV !== "test") {
      console.warn("Error getting userIgnoreFilters from Obsidian config", e);
    }
  }

  return appIgnoreFolders;
}

export function getTagPattern(tag: string): string {
  return `#${tag}`;
}

export function getFilePattern(file: TFile): string {
  return `[[${file.basename}]]`;
}

/**
 * Generate extension pattern from user input.
 * Note: User input is used as-is. If user inputs ".md", the result will be "*..md".
 * This is intentional - user is responsible for correct input format (e.g., "md" not ".md").
 */
export function getExtensionPattern(extension: string): string {
  return `*.${extension}`;
}

/**
 * Get a list of internal Copilot file paths that must be excluded from searches.
 * Currently includes the rolling log file path (e.g., "copilot/copilot-log.md").
 */
export function getInternalExcludePaths(): string[] {
  return [logFileManager.getLogPath()];
}

/**
 * Check whether a file path is an internal Copilot file that should be excluded from searches.
 * @param filePath - Full path to the file in the vault
 */
export function isInternalExcludedPath(filePath: string): boolean {
  const excludes = new Set(getInternalExcludePaths());
  return excludes.has(filePath);
}

/**
 * Check whether a TFile is an internal Copilot file that should be excluded from searches.
 * @param file - Obsidian file object
 */
export function isInternalExcludedFile(file: TFile): boolean {
  return isInternalExcludedPath(file.path);
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: "", body: content };
  }

  const lines = content.split(/\r?\n/);
  if (lines[0].trim() !== "---") {
    return { frontmatter: "", body: content };
  }

  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === "---") {
      return {
        frontmatter: lines.slice(1, index).join("\n"),
        body: lines.slice(index + 1).join("\n"),
      };
    }
  }

  return { frontmatter: "", body: content };
}

function extractFrontmatterTags(frontmatter: string): string[] {
  if (!frontmatter) {
    return [];
  }

  const tags: string[] = [];
  const bracketMatch = frontmatter.match(/^tags:\s*\[(.+?)\]\s*$/m);
  if (bracketMatch) {
    tags.push(
      ...bracketMatch[1]
        .split(",")
        .map((tag) => stripWrappingQuotes(tag.trim()))
        .filter(Boolean)
    );
  }

  const scalarMatch = frontmatter.match(/^tags:\s*(.+?)\s*$/m);
  if (scalarMatch && !bracketMatch && !scalarMatch[1].startsWith("-")) {
    tags.push(...scalarMatch[1].split(",").map((tag) => stripWrappingQuotes(tag.trim())));
  }

  const listMatch = frontmatter.match(/^tags:\s*$([\s\S]*?)(?:^\S|(?![\s\S]))/m);
  if (listMatch) {
    const listLines = listMatch[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));
    tags.push(...listLines.map((line) => stripWrappingQuotes(line.slice(2).trim())));
  }

  return tags.filter(Boolean);
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function normalizeTag(tag: string): string {
  return `#${stripHash(tag).toLowerCase()}`;
}

function getInlineTagRegExp(): RegExp {
  try {
    return /(?<!\w)#[\p{L}\p{N}_/-]+/gu;
  } catch {
    return /(^|\s)(#[a-zA-Z0-9_/-]+)/g;
  }
}
