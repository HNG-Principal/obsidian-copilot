import { Pdf4llmResponse } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo } from "@/logger";
import { SupportedFormat } from "@/tools/parsers/conversionTypes";
import { MD5 } from "crypto-js";
import { TFile } from "obsidian";

/**
 * Persisted on-disk cache entry for a converted document.
 */
interface CachedDocumentEntry {
  sourcePath: string;
  fileHash: string;
  formatId: SupportedFormat;
  response: Pdf4llmResponse;
}

export class PDFCache {
  private static instance: PDFCache;
  private cacheDir: string = ".copilot/pdf-cache";

  private constructor() {}

  /**
   * Return the singleton cache instance used across document parsers.
   */
  static getInstance(): PDFCache {
    if (!PDFCache.instance) {
      PDFCache.instance = new PDFCache();
    }
    return PDFCache.instance;
  }

  /**
   * Ensure the on-disk cache directory exists before writing entries.
   */
  private async ensureCacheDir() {
    if (!(await app.vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating document cache directory:", this.cacheDir);
      await app.vault.adapter.mkdir(this.cacheDir);
    }
  }

  /**
   * Build a stable hash representing the current file contents.
   *
   * The hash intentionally uses path, size, and modified time to match the
   * existing invalidation behavior without reading the full file body.
   *
   * @param file - Source file being cached.
   * @returns Hash representing the current file state.
   */
  private getFileHash(file: TFile): string {
    const metadata = `${file.path}:${file.stat.size}:${file.stat.mtime}`;
    return MD5(metadata).toString();
  }

  /**
   * Build the composite cache key used for all supported document formats.
   *
   * @param fileHash - Hash representing the current file state.
   * @param formatId - Format identifier associated with the cached conversion.
   * @returns Composite cache key in `{fileHash}:{formatId}` form.
   */
  private getCacheKey(fileHash: string, formatId: SupportedFormat = "pdf"): string {
    const key = `${fileHash}:${formatId}`;
    return key;
  }

  /**
   * Convert a logical cache key into a filesystem-safe cache file path.
   *
   * @param cacheKey - Composite cache key.
   * @returns Absolute adapter-relative path for the cached entry.
   */
  private getCachePath(cacheKey: string): string {
    const sanitizedCacheKey = cacheKey.replace(":", "__");
    return `${this.cacheDir}/${sanitizedCacheKey}.json`;
  }

  /**
   * Parse a cache payload, supporting both the new wrapped structure and the
   * legacy PDF-only payload shape.
   *
   * @param cacheContent - Raw JSON cache payload.
   * @returns Cached response plus optional metadata when available.
   */
  private parseCacheEntry(cacheContent: string): CachedDocumentEntry | Pdf4llmResponse {
    const parsedCacheContent = JSON.parse(cacheContent) as CachedDocumentEntry | Pdf4llmResponse;

    if (
      typeof parsedCacheContent === "object" &&
      parsedCacheContent !== null &&
      "sourcePath" in parsedCacheContent &&
      "fileHash" in parsedCacheContent &&
      "formatId" in parsedCacheContent &&
      "response" in parsedCacheContent
    ) {
      return parsedCacheContent;
    }

    return parsedCacheContent;
  }

  /**
   * Remove stale cache entries for the same file and format when the file hash changes.
   *
   * @param file - Source file being cached.
   * @param formatId - Format identifier associated with the cached conversion.
   * @param currentFileHash - Current hash for the source file.
   */
  private async invalidateStaleEntries(
    file: TFile,
    formatId: SupportedFormat,
    currentFileHash: string
  ): Promise<void> {
    if (!(await app.vault.adapter.exists(this.cacheDir))) {
      return;
    }

    const files = await app.vault.adapter.list(this.cacheDir);

    for (const cachedFilePath of files.files) {
      try {
        const cacheContent = await app.vault.adapter.read(cachedFilePath);
        const parsedCacheEntry = this.parseCacheEntry(cacheContent);

        if (
          "sourcePath" in parsedCacheEntry &&
          parsedCacheEntry.sourcePath === file.path &&
          parsedCacheEntry.formatId === formatId &&
          parsedCacheEntry.fileHash !== currentFileHash
        ) {
          await app.vault.adapter.remove(cachedFilePath);
          logInfo("Invalidated stale document cache entry:", {
            path: file.path,
            formatId,
            cacheFile: cachedFilePath,
          });
        }
      } catch (error) {
        logError("Error invalidating stale document cache entry:", error);
      }
    }
  }

  /**
   * Read a cached conversion result for the provided file and format.
   *
   * @param file - Source file to look up.
   * @param formatId - Format identifier associated with the cached conversion.
   * @returns Cached response when present; otherwise null.
   */
  async get(file: TFile, formatId: SupportedFormat = "pdf"): Promise<Pdf4llmResponse | null> {
    try {
      const fileHash = this.getFileHash(file);
      const cacheKey = this.getCacheKey(fileHash, formatId);
      await this.invalidateStaleEntries(file, formatId, fileHash);
      const cachePath = this.getCachePath(cacheKey);
      logInfo("Generated document cache key:", { path: file.path, formatId, key: cacheKey });

      if (await app.vault.adapter.exists(cachePath)) {
        logInfo("Document cache hit:", { path: file.path, formatId });
        const cacheContent = await app.vault.adapter.read(cachePath);
        const parsedCacheEntry = this.parseCacheEntry(cacheContent);
        return "response" in parsedCacheEntry &&
          "sourcePath" in parsedCacheEntry &&
          "fileHash" in parsedCacheEntry &&
          "formatId" in parsedCacheEntry
          ? parsedCacheEntry.response
          : parsedCacheEntry;
      }
      logInfo("Document cache miss:", { path: file.path, formatId });
      return null;
    } catch (error) {
      logError("Error reading from document cache:", error);
      return null;
    }
  }

  /**
   * Persist a conversion result for the provided file and format.
   *
   * @param file - Source file being cached.
   * @param response - Conversion response payload to cache.
   * @param formatId - Format identifier associated with the cached conversion.
   */
  async set(
    file: TFile,
    response: Pdf4llmResponse,
    formatId: SupportedFormat = "pdf"
  ): Promise<void> {
    try {
      await this.ensureCacheDir();
      const fileHash = this.getFileHash(file);
      await this.invalidateStaleEntries(file, formatId, fileHash);
      const cacheKey = this.getCacheKey(fileHash, formatId);
      const cachePath = this.getCachePath(cacheKey);
      const cacheEntry: CachedDocumentEntry = {
        sourcePath: file.path,
        fileHash,
        formatId,
        response,
      };
      logInfo("Generated document cache key:", { path: file.path, formatId, key: cacheKey });
      logInfo("Caching document response for:", { path: file.path, formatId });
      await app.vault.adapter.write(cachePath, JSON.stringify(cacheEntry));
    } catch (error) {
      logError("Error writing to document cache:", error);
    }
  }

  /**
   * Remove every cached conversion entry managed by this cache.
   */
  async clear(): Promise<void> {
    try {
      if (await app.vault.adapter.exists(this.cacheDir)) {
        const files = await app.vault.adapter.list(this.cacheDir);
        logInfo("Clearing document cache, removing files:", files.files.length);
        for (const file of files.files) {
          await app.vault.adapter.remove(file);
        }
      }
    } catch (error) {
      logError("Error clearing document cache:", error);
    }
  }
}
