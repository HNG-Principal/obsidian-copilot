import { logError, logInfo, logWarn } from "@/logger";
import type { ConversionMetadata } from "@/tools/parsers/conversionTypes";
import { ensureFolderExists } from "@/utils";
import { TFile, Vault } from "obsidian";

const DEFAULT_CONVERTED_DOC_OUTPUT_FOLDER = "Converted Documents";

/**
 * Escape a string for safe YAML double-quoted frontmatter values.
 *
 * @param value - Raw string value to encode.
 * @returns Escaped string safe for YAML double quotes.
 */
function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build YAML frontmatter for converted document metadata.
 *
 * @param metadata - Conversion metadata associated with the saved markdown.
 * @returns Serialized frontmatter block, or an empty string when metadata is absent.
 */
function buildConversionFrontmatter(metadata?: ConversionMetadata): string {
  if (!metadata) {
    return "";
  }

  const frontmatterLines = [
    "---",
    `sourceFilename: "${escapeYamlString(metadata.sourceFilename)}"`,
    `sourceFormat: "${escapeYamlString(metadata.sourceFormat)}"`,
    `conversionDate: "${escapeYamlString(metadata.conversionDate)}"`,
    ...(metadata.pageCount != null ? [`pageCount: ${metadata.pageCount}`] : []),
    `wordCount: ${metadata.wordCount}`,
    `ocrUsed: ${metadata.ocrUsed}`,
    "---",
    "",
  ];

  return `${frontmatterLines.join("\n")}\n`;
}

/**
 * Check whether persisted output belongs to the provided source file.
 *
 * @param persistedContent - Existing markdown saved in the vault.
 * @param sourcePath - Original vault path for the converted source file.
 * @returns True when the persisted content includes the expected source marker.
 */
function hasSourceMarker(persistedContent: string, sourcePath: string): boolean {
  return persistedContent.includes(`<!-- source: ${sourcePath} -->`);
}

/**
 * Resolve the folder path used for converted document output.
 *
 * Undefined means the setting has not been configured yet, so the utility falls
 * back to the default vault-root folder. An explicit empty string still
 * disables persistence so callers can intentionally opt out of writing files.
 *
 * @param outputFolder - Configured output folder value.
 * @returns Folder path to write into, or an empty string when persistence is disabled.
 */
function resolveOutputFolder(outputFolder?: string): string {
  if (outputFolder == null) {
    return DEFAULT_CONVERTED_DOC_OUTPUT_FOLDER;
  }

  return outputFolder.trim();
}

/**
 * Save converted document content to the specified output folder.
 * Uses flat naming: {basename}.md, disambiguating with double-underscore
 * path flattening on collision. No-op when outputFolder is empty, content
 * is empty/error, or source is already markdown.
 *
 * @param file - Source file that was converted.
 * @param content - Converted markdown content.
 * @param vault - Obsidian vault instance.
 * @param outputFolder - Target folder path. Undefined uses the default vault-root
 * folder, while an empty string keeps persistence disabled.
 * @param metadata - Optional conversion metadata used to generate frontmatter.
 */
export async function saveConvertedDocOutput(
  file: TFile,
  content: string,
  vault: Vault,
  outputFolder?: string,
  metadata?: ConversionMetadata
): Promise<void> {
  const trimmed = resolveOutputFolder(outputFolder);
  if (!trimmed) return;

  // Skip markdown files — they don't need conversion output
  if (file.extension === "md") return;

  // Skip empty or error content
  if (!content || content.startsWith("[Error:")) return;

  try {
    await ensureFolderExists(trimmed);

    let outputPath = `${trimmed}/${file.basename}.md`;
    const sourceMarker = `<!-- source: ${file.path} -->`;

    // Disambiguate if a file with the same name already exists from a different source
    if (await vault.adapter.exists(outputPath)) {
      const existing = await vault.adapter.read(outputPath);
      if (existing && !hasSourceMarker(existing, file.path)) {
        // Use full path to guarantee uniqueness even when path separators
        // were part of the original folder name (e.g. a/b/x.pdf vs a_b/x.pdf)
        const safePath = file.path.replace(/\.[^.]+$/, "").replace(/[/\\]/g, "__");
        outputPath = `${trimmed}/${safePath}.md`;

        // Final guard: if the disambiguated path also exists from a different source, skip
        if (await vault.adapter.exists(outputPath)) {
          const existingDisambig = await vault.adapter.read(outputPath);
          if (existingDisambig && !hasSourceMarker(existingDisambig, file.path)) {
            logWarn(`Skipping converted doc output for ${file.path}: collision at ${outputPath}`);
            return;
          }
        }
      }
    }

    // Prepend metadata frontmatter and source path for traceability and collision detection
    const outputContent = `${buildConversionFrontmatter(metadata)}${sourceMarker}\n${content}`;

    // Skip write when content is unchanged to avoid mtime churn and re-indexing
    if (await vault.adapter.exists(outputPath)) {
      const existing = await vault.adapter.read(outputPath);
      if (existing === outputContent) return;
    }

    await vault.adapter.write(outputPath, outputContent);
    logInfo(`Saved converted doc output: ${outputPath}`);
  } catch (error) {
    logError(`Failed to save converted doc output for ${file.path}:`, error);
  }
}
