import type { ParsedURL } from "@/services/webContextTypes";
import { safeFetchNoThrow } from "@/utils";
import { parseHTML } from "linkedom";

interface SocialMediaExtractorDependencies {
  fetchImpl?: typeof safeFetchNoThrow;
  now?: () => number;
}

/**
 * Extract structured content from supported social media URLs.
 */
export class SocialMediaExtractor {
  private static instance: SocialMediaExtractor;

  private readonly fetchImpl: typeof safeFetchNoThrow;
  private readonly now: () => number;

  constructor(dependencies: SocialMediaExtractorDependencies = {}) {
    this.fetchImpl = dependencies.fetchImpl ?? safeFetchNoThrow;
    this.now = dependencies.now ?? Date.now;
  }

  /**
   * Get the shared social media extractor instance.
   */
  static getInstance(): SocialMediaExtractor {
    if (!SocialMediaExtractor.instance) {
      SocialMediaExtractor.instance = new SocialMediaExtractor();
    }
    return SocialMediaExtractor.instance;
  }

  /**
   * Extract a supported social post or return null when the URL is unsupported.
   */
  async extractSocialPost(url: string): Promise<ParsedURL | null> {
    if (!isTwitterStatusUrl(url)) {
      return null;
    }

    const response = await this.fetchImpl(
      `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url)}`
    );

    if (!response.ok) {
      throw new Error(`Twitter/X extraction failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      author_name?: string;
      author_url?: string;
      html?: string;
    };
    const { document } = parseHTML(`<body>${payload.html || ""}</body>`);
    const blockquote = document.querySelector("blockquote");
    const anchors = Array.from(document.querySelectorAll("a"));
    const publicationDate = anchors[anchors.length - 1]?.textContent?.trim() || undefined;
    const text = collapseWhitespace(blockquote?.textContent || document.body.textContent || "");
    const author = payload.author_name || payload.author_url?.split("/").filter(Boolean).pop();

    return {
      url,
      title: author ? `Post by ${author}` : "Twitter/X Post",
      author,
      publicationDate,
      content: text,
      excerpt: author ? `Social post by ${author}` : "Social post",
      status: "success",
      extractedAt: this.now(),
      byteLength: new TextEncoder().encode(text).byteLength,
    };
  }
}

/**
 * Determine whether a URL points to a Twitter/X status.
 */
export function isTwitterStatusUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (hostname !== "x.com" && hostname !== "twitter.com") {
      return false;
    }

    return /\/status\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Collapse HTML text into a readable single string.
 */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
