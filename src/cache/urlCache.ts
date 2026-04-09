import { logError, logInfo } from "@/logger";
import { ParsedURL, UrlCacheEntry } from "@/services/webContextTypes";
import { getSettings } from "@/settings/model";
import { normalizeUrlForMatching } from "@/utils/urlNormalization";
import { MD5 } from "crypto-js";

/**
 * Persist extracted URL content to disk for reuse across requests.
 */
export class UrlCache {
  private static instance: UrlCache;
  private readonly cacheDir = ".copilot/url-cache";

  /**
   * Return the singleton URL cache instance.
   */
  static getInstance(): UrlCache {
    if (!UrlCache.instance) {
      UrlCache.instance = new UrlCache();
    }
    return UrlCache.instance;
  }

  /**
   * Look up a cached extraction entry for a URL.
   */
  async get(url: string): Promise<UrlCacheEntry | undefined> {
    try {
      const cachePath = this.getCachePath(url);
      if (!(await app.vault.adapter.exists(cachePath))) {
        return undefined;
      }

      const entry = JSON.parse(await app.vault.adapter.read(cachePath)) as UrlCacheEntry;
      if (entry.expiresAt <= Date.now()) {
        await app.vault.adapter.remove(cachePath);
        return undefined;
      }

      return entry;
    } catch (error) {
      logError("Error reading URL cache entry:", error);
      return undefined;
    }
  }

  /**
   * Persist a URL extraction entry and enforce cache cleanup.
   */
  async set(url: string, parsedUrl: ParsedURL): Promise<void> {
    try {
      await this.ensureCacheDir();
      const ttlHours = getSettings().urlCacheTTLHours;
      const entry: UrlCacheEntry = {
        urlHash: this.getUrlHash(url),
        url: normalizeUrlForMatching(url) || url.trim(),
        title: parsedUrl.title,
        author: parsedUrl.author,
        publicationDate: parsedUrl.publicationDate,
        content: parsedUrl.content,
        excerpt: parsedUrl.excerpt,
        extractedAt: parsedUrl.extractedAt,
        expiresAt: parsedUrl.extractedAt + ttlHours * 60 * 60 * 1000,
        byteLength: parsedUrl.byteLength,
      };

      await app.vault.adapter.write(this.getCachePath(url), JSON.stringify(entry));
      await this.cleanup();
    } catch (error) {
      logError("Error writing URL cache entry:", error);
    }
  }

  /**
   * Remove expired or least-recent entries from the cache.
   */
  async cleanup(): Promise<void> {
    try {
      if (!(await app.vault.adapter.exists(this.cacheDir))) {
        return;
      }

      const listing = await app.vault.adapter.list(this.cacheDir);
      const parsedEntries = await Promise.all(
        listing.files.map(async (filePath) => {
          try {
            const entry = JSON.parse(await app.vault.adapter.read(filePath)) as UrlCacheEntry;
            return { filePath, entry };
          } catch (error) {
            logError("Error parsing URL cache entry:", error);
            return null;
          }
        })
      );

      const validEntries = parsedEntries.filter(
        (item): item is { filePath: string; entry: UrlCacheEntry } => item !== null
      );
      const now = Date.now();

      for (const item of validEntries.filter((candidate) => candidate.entry.expiresAt <= now)) {
        await app.vault.adapter.remove(item.filePath);
      }

      const maxEntries = getSettings().maxUrlCacheEntries;
      const activeEntries = validEntries
        .filter((candidate) => candidate.entry.expiresAt > now)
        .sort((left, right) => right.entry.extractedAt - left.entry.extractedAt);

      for (const item of activeEntries.slice(maxEntries)) {
        await app.vault.adapter.remove(item.filePath);
      }
    } catch (error) {
      logError("Error cleaning URL cache:", error);
    }
  }

  /**
   * Remove all URL cache entries.
   */
  async clear(): Promise<void> {
    try {
      if (!(await app.vault.adapter.exists(this.cacheDir))) {
        return;
      }

      const listing = await app.vault.adapter.list(this.cacheDir);
      for (const filePath of listing.files) {
        await app.vault.adapter.remove(filePath);
      }
    } catch (error) {
      logError("Error clearing URL cache:", error);
    }
  }

  private async ensureCacheDir(): Promise<void> {
    if (!(await app.vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating URL cache directory:", this.cacheDir);
      await app.vault.adapter.mkdir(this.cacheDir);
    }
  }

  private getCachePath(url: string): string {
    return `${this.cacheDir}/${this.getUrlHash(url)}.json`;
  }

  private getUrlHash(url: string): string {
    return MD5(normalizeUrlForMatching(url) || url.trim()).toString();
  }
}
