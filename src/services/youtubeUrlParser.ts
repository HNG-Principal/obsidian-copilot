import type { ParsedYouTubeUrl, YouTubeSourceKind } from "@/services/youtubeContextTypes";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Parse a YouTube timestamp token such as "90", "1m30s", or "1h2m3s".
 *
 * @param raw - Raw timestamp token from a URL parameter.
 * @returns Parsed timestamp in seconds, or undefined when the value is invalid.
 */
export function parseYouTubeStartTime(raw?: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : undefined;
}

/**
 * Build the canonical watch URL for a YouTube video ID.
 *
 * @param videoId - Canonical YouTube video identifier.
 * @param startTimeSeconds - Optional start offset to preserve.
 * @returns Canonical watch URL.
 */
export function formatCanonicalYouTubeUrl(videoId: string, startTimeSeconds?: number): string {
  const url = new URL(`https://www.youtube.com/watch?v=${videoId}`);
  if (startTimeSeconds && startTimeSeconds > 0) {
    url.searchParams.set("t", String(startTimeSeconds));
  }
  return url.toString();
}

/**
 * Parse a user-supplied URL into a canonical YouTube identity.
 *
 * @param rawUrl - User-supplied URL.
 * @returns Parsed canonical YouTube URL metadata, or undefined for non-YouTube URLs.
 */
export function parseYouTubeUrl(rawUrl: string): ParsedYouTubeUrl | undefined {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(hostname)) {
    return undefined;
  }

  let videoId: string | null = null;
  let sourceKind: YouTubeSourceKind | null = null;

  if (hostname.includes("youtu.be")) {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
    sourceKind = "shortlink";
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v");
    sourceKind = "watch";
  } else if (url.pathname.startsWith("/shorts/")) {
    videoId = url.pathname.split("/")[2] ?? null;
    sourceKind = "short";
  } else if (url.pathname.startsWith("/embed/")) {
    videoId = url.pathname.split("/")[2] ?? null;
    sourceKind = "embed";
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    return undefined;
  }

  const startTimeSeconds =
    parseYouTubeStartTime(url.searchParams.get("t")) ??
    parseYouTubeStartTime(url.searchParams.get("start")) ??
    undefined;

  return {
    originalUrl: trimmed,
    canonicalUrl: formatCanonicalYouTubeUrl(videoId, startTimeSeconds),
    videoId,
    startTimeSeconds,
    sourceKind,
  };
}
