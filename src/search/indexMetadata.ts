import { CustomError } from "@/error";
import type { IndexMetadata } from "@/search/types";
import { App } from "obsidian";

const INDEX_METADATA_FILE_NAME = "copilot-search-index-metadata.json";

/**
 * Resolve the directory where Copilot search metadata is stored.
 *
 * @param app - Obsidian app instance.
 * @param enableIndexSync - Whether index sync storage is enabled.
 * @returns Adapter-relative directory path.
 */
export async function getIndexMetadataDirectory(
  app: App,
  enableIndexSync: boolean
): Promise<string> {
  if (!(app.vault as any)?.adapter) {
    return ".copilot-index";
  }

  if (enableIndexSync) {
    return app.vault.configDir ?? ".obsidian";
  }

  const vaultRoot = typeof app.vault.getRoot === "function" ? app.vault.getRoot().path : "";
  const effectiveRoot = vaultRoot === "/" ? "" : vaultRoot;
  const prefix = effectiveRoot === "" || effectiveRoot.startsWith("/") ? "" : "/";
  const baseDir = `${prefix}${effectiveRoot}/.copilot-index`;

  if (!(await app.vault.adapter.exists(baseDir))) {
    await app.vault.adapter.mkdir(baseDir);
  }

  return baseDir;
}

/**
 * Resolve the metadata file path.
 *
 * @param app - Obsidian app instance.
 * @param enableIndexSync - Whether index sync storage is enabled.
 * @returns Adapter-relative metadata file path.
 */
export async function getIndexMetadataPath(app: App, enableIndexSync: boolean): Promise<string> {
  const directory = await getIndexMetadataDirectory(app, enableIndexSync);
  return `${directory}/${INDEX_METADATA_FILE_NAME}`;
}

/**
 * Load persisted search index metadata.
 *
 * @param app - Obsidian app instance.
 * @param enableIndexSync - Whether index sync storage is enabled.
 * @returns Parsed metadata, or null when no file exists.
 */
export async function readIndexMetadata(
  app: App,
  enableIndexSync: boolean
): Promise<IndexMetadata | null> {
  if (!(app.vault as any)?.adapter) {
    return null;
  }

  const metadataPath = await getIndexMetadataPath(app, enableIndexSync);
  if (!(await app.vault.adapter.exists(metadataPath))) {
    return null;
  }

  const raw = await app.vault.adapter.read(metadataPath);
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as IndexMetadata;
  } catch (error) {
    throw new CustomError(`Failed to parse search index metadata at ${metadataPath}: ${error}`);
  }
}

/**
 * Persist search index metadata.
 *
 * @param app - Obsidian app instance.
 * @param enableIndexSync - Whether index sync storage is enabled.
 * @param metadata - Metadata to persist.
 */
export async function writeIndexMetadata(
  app: App,
  enableIndexSync: boolean,
  metadata: IndexMetadata
): Promise<void> {
  if (!(app.vault as any)?.adapter) {
    return;
  }

  const metadataPath = await getIndexMetadataPath(app, enableIndexSync);
  await app.vault.adapter.write(metadataPath, JSON.stringify(metadata, null, 2));
}
