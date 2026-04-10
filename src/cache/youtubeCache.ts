import { logError, logInfo } from "@/logger";
import type { YouTubeTranscriptCacheEntry } from "@/services/youtubeContextTypes";
import { getSettings } from "@/settings/model";
import { MD5 } from "crypto-js";

const YOUTUBE_CACHE_VERSION = 1;

/**
 * Persist processed YouTube transcript payloads to disk for reuse across chats.
 */
export class YouTubeCache {
  private static instance: YouTubeCache;
  private readonly cacheDir = ".copilot/youtube-cache";

  /**
   * Return the shared YouTube transcript cache.
   */
  static getInstance(): YouTubeCache {
    if (!YouTubeCache.instance) {
      YouTubeCache.instance = new YouTubeCache();
    }
    return YouTubeCache.instance;
  }

  /**
   * Read a cached transcript entry by lookup key.
   *
   * @param cacheKey - Stable lookup key derived from the video and preferred language.
   * @returns Cache entry when present and fresh.
   */
  async get(cacheKey: string): Promise<YouTubeTranscriptCacheEntry | undefined> {
    try {
      const cachePath = this.getCachePath(cacheKey);
      if (!(await app.vault.adapter.exists(cachePath))) {
        return undefined;
      }

      const entry = JSON.parse(
        await app.vault.adapter.read(cachePath)
      ) as YouTubeTranscriptCacheEntry;
      if (entry.version !== YOUTUBE_CACHE_VERSION || entry.expiresAt <= Date.now()) {
        await app.vault.adapter.remove(cachePath);
        return undefined;
      }

      return entry;
    } catch (error) {
      logError("Error reading YouTube transcript cache entry:", error);
      return undefined;
    }
  }

  /**
   * Write a transcript entry to the cache using the configured TTL.
   *
   * @param entry - Cache entry payload.
   */
  async set(
    entry: Omit<YouTubeTranscriptCacheEntry, "cachedAt" | "expiresAt" | "version">
  ): Promise<void> {
    try {
      await this.ensureCacheDir();
      const ttlHours = getSettings().youtubeTranscriptCacheTTLHours;
      const now = Date.now();
      const persistedEntry: YouTubeTranscriptCacheEntry = {
        ...entry,
        cachedAt: now,
        expiresAt: now + ttlHours * 60 * 60 * 1000,
        version: YOUTUBE_CACHE_VERSION,
      };

      await app.vault.adapter.write(
        this.getCachePath(entry.cacheKey),
        JSON.stringify(persistedEntry)
      );
      await this.cleanup();
    } catch (error) {
      logError("Error writing YouTube transcript cache entry:", error);
    }
  }

  /**
   * Remove expired cache entries.
   */
  async cleanup(): Promise<void> {
    try {
      if (!(await app.vault.adapter.exists(this.cacheDir))) {
        return;
      }

      const listing = await app.vault.adapter.list(this.cacheDir);
      const now = Date.now();
      for (const filePath of listing.files) {
        try {
          const entry = JSON.parse(
            await app.vault.adapter.read(filePath)
          ) as YouTubeTranscriptCacheEntry;
          if (entry.version !== YOUTUBE_CACHE_VERSION || entry.expiresAt <= now) {
            await app.vault.adapter.remove(filePath);
          }
        } catch (error) {
          logError("Error parsing YouTube transcript cache entry:", error);
          await app.vault.adapter.remove(filePath);
        }
      }
    } catch (error) {
      logError("Error cleaning YouTube transcript cache:", error);
    }
  }

  /**
   * Build a stable cache key for a video/language pair.
   *
   * @param videoId - Canonical YouTube video identifier.
   * @param preferredLanguage - Preferred transcript language.
   * @returns Stable cache key.
   */
  getLookupKey(videoId: string, preferredLanguage?: string): string {
    return `${videoId}:${preferredLanguage?.trim().toLowerCase() || "auto"}`;
  }

  private async ensureCacheDir(): Promise<void> {
    if (!(await app.vault.adapter.exists(this.cacheDir))) {
      logInfo("Creating YouTube transcript cache directory:", this.cacheDir);
      await app.vault.adapter.mkdir(this.cacheDir);
    }
  }

  private getCachePath(cacheKey: string): string {
    return `${this.cacheDir}/${MD5(cacheKey).toString()}.json`;
  }
}
