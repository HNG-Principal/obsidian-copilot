import { Readability } from "@mozilla/readability";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import {
  type IUrlCache,
  type IWebExtractor,
  type ParsedURL,
  type WebExtractorOptions,
} from "@/services/webContextTypes";
import { safeFetchNoThrow } from "@/utils";
import { normalizeUrlForMatching } from "@/utils/urlNormalization";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { UrlCache } from "./../cache/urlCache";
import { RenderedPageProvider, type IRenderedPageProvider } from "./renderedPageProvider";
import { SocialMediaExtractor } from "./socialMediaExtractor";

const DEFAULT_MAX_CONTENT_BYTES = 50000;
const PDF_CONTENT_TYPE = "application/pdf";

interface WebExtractorDependencies {
  cache?: IUrlCache;
  fetchImpl?: typeof safeFetchNoThrow;
  now?: () => number;
  convertPdf?: (buffer: ArrayBuffer) => Promise<string>;
  renderedPageProvider?: IRenderedPageProvider;
  socialMediaExtractor?: SocialMediaExtractor;
}

/**
 * Extract clean markdown content from public web URLs.
 */
export class WebExtractor implements IWebExtractor {
  private static instance: WebExtractor;

  private readonly cache: IUrlCache;
  private readonly fetchImpl: typeof safeFetchNoThrow;
  private readonly now: () => number;
  private readonly turndownService: TurndownService;
  private readonly convertPdf: (buffer: ArrayBuffer) => Promise<string>;
  private readonly renderedPageProvider: IRenderedPageProvider;
  private readonly socialMediaExtractor: SocialMediaExtractor;

  constructor(dependencies: WebExtractorDependencies = {}) {
    this.cache = dependencies.cache ?? UrlCache.getInstance();
    this.fetchImpl = dependencies.fetchImpl ?? safeFetchNoThrow;
    this.now = dependencies.now ?? Date.now;
    this.turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    this.convertPdf = dependencies.convertPdf ?? this.convertPdfWithBrevilabs.bind(this);
    this.renderedPageProvider =
      dependencies.renderedPageProvider ?? RenderedPageProvider.getInstance();
    this.socialMediaExtractor =
      dependencies.socialMediaExtractor ?? SocialMediaExtractor.getInstance();
  }

  /**
   * Get the shared extractor instance used by URL mentions.
   */
  static getInstance(): WebExtractor {
    if (!WebExtractor.instance) {
      WebExtractor.instance = new WebExtractor();
    }
    return WebExtractor.instance;
  }

  /**
   * Fetch and extract markdown content from a public URL.
   */
  async extractUrlContent(url: string, options: WebExtractorOptions = {}): Promise<ParsedURL> {
    const normalizedUrl = normalizeUrlForMatching(url);
    if (!normalizedUrl) {
      return this.createFailure(url, "invalid_url", "URL is empty or invalid");
    }

    if (!options.bypassCache) {
      const cached = await this.cache.get(normalizedUrl);
      if (cached) {
        return {
          url: cached.url,
          title: cached.title,
          author: cached.author,
          publicationDate: cached.publicationDate,
          content: cached.content,
          excerpt: cached.excerpt,
          status: "success",
          extractedAt: cached.extractedAt,
          byteLength: cached.byteLength,
        };
      }
    }

    const timeoutMs = options.timeoutMs ?? getSettings().urlExtractionTimeoutMs;
    const maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;

    try {
      const socialPost = await this.socialMediaExtractor.extractSocialPost(normalizedUrl);
      if (socialPost) {
        await this.cache.set(normalizedUrl, socialPost);
        return socialPost;
      }

      const response = await this.withTimeout(
        this.fetchImpl(normalizedUrl, {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        }),
        timeoutMs
      );

      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 || response.status === 451;
        return this.createFailure(
          normalizedUrl,
          code ? "blocked" : "network_error",
          `URL fetch failed with status ${response.status}`
        );
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes(PDF_CONTENT_TYPE) || normalizedUrl.toLowerCase().endsWith(".pdf")) {
        return this.extractPdfContent(normalizedUrl, response, maxContentBytes);
      }

      const html = await response.text();
      if (this.looksBlocked(html)) {
        return this.createFailure(
          normalizedUrl,
          "blocked",
          "Page content is blocked or requires login"
        );
      }

      const parsed = await this.extractWithFallback(
        normalizedUrl,
        html,
        timeoutMs,
        maxContentBytes
      );
      await this.cache.set(normalizedUrl, parsed);
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.message === "timeout") {
        return this.createFailure(normalizedUrl, "timeout", "URL fetch timed out");
      }

      return this.createFailure(
        normalizedUrl,
        "network_error",
        error instanceof Error ? error.message : "Unknown network error"
      );
    }
  }

  /**
   * Fetch a PDF URL and convert it through the existing document conversion service.
   */
  private async extractPdfContent(
    url: string,
    response: Response,
    maxContentBytes: number
  ): Promise<ParsedURL> {
    const binary = await response.arrayBuffer();
    const extractedAt = this.now();
    const convertedContent = await this.convertPdf(binary);
    const truncated = truncateWebContent(convertedContent, maxContentBytes);

    const parsed: ParsedURL = {
      url,
      title: url.split("/").pop() || url,
      content: truncated.content,
      status: truncated.truncated ? "partial" : "success",
      excerpt: truncated.truncated
        ? "PDF content was truncated to fit the context budget."
        : undefined,
      extractedAt,
      byteLength: binary.byteLength,
    };

    await this.cache.set(url, parsed);
    return parsed;
  }

  /**
   * Convert an HTML page into structured markdown content.
   */
  private extractFromHtml(url: string, html: string, maxContentBytes: number): ParsedURL {
    const extractedAt = this.now();
    const byteLength = new TextEncoder().encode(html).length;
    const { document } = parseHTML(html);
    const readable = new Readability(document as unknown as Document).parse();

    const rawMarkdown = readable?.content
      ? this.turndownService.turndown(readable.content)
      : collapseWhitespace(document.body?.textContent || "");
    const cleanedContent = cleanMarkdown(rawMarkdown);

    if (!cleanedContent) {
      return this.createFailure(
        url,
        "parse_error",
        "Could not extract readable content from the page"
      );
    }

    const truncated = truncateWebContent(cleanedContent, maxContentBytes);

    return {
      url,
      title:
        readable?.title ||
        document.title ||
        extractMetaContent(document, ["meta[property='og:title']"]),
      author:
        readable?.byline ||
        extractMetaContent(document, ["meta[name='author']", "meta[property='article:author']"]),
      publicationDate: extractMetaContent(document, [
        "meta[property='article:published_time']",
        "meta[name='date']",
        "time[datetime]",
      ]),
      excerpt:
        readable?.excerpt ||
        extractMetaContent(document, [
          "meta[name='description']",
          "meta[property='og:description']",
        ]),
      content: truncated.content,
      status: truncated.truncated ? "partial" : "success",
      extractedAt,
      byteLength,
    };
  }

  /**
   * Use rendered HTML when the raw response looks too thin for a reliable extract.
   */
  private async extractWithFallback(
    url: string,
    html: string,
    timeoutMs: number,
    maxContentBytes: number
  ): Promise<ParsedURL> {
    const rawParsed = this.extractFromHtml(url, html, maxContentBytes);
    if (!this.shouldUseRenderedFallback(rawParsed, html)) {
      return rawParsed;
    }

    try {
      const renderedHtml = await this.renderedPageProvider.renderPage(url, timeoutMs);
      const renderedParsed = this.extractFromHtml(url, renderedHtml, maxContentBytes);
      if (renderedParsed.content.length > rawParsed.content.length) {
        return renderedParsed;
      }
    } catch (error) {
      return {
        ...rawParsed,
        status: rawParsed.content ? "partial" : "failed",
        error: {
          code: "parse_error",
          message: error instanceof Error ? error.message : "Rendered fallback failed",
        },
      };
    }

    return rawParsed;
  }

  /**
   * Convert a PDF buffer with the existing Brevilabs document conversion endpoint.
   */
  private async convertPdfWithBrevilabs(buffer: ArrayBuffer): Promise<string> {
    const response = await BrevilabsClient.getInstance().pdf4llm(buffer);

    if (typeof response.response === "string") {
      return response.response;
    }

    if (response.response && typeof response.response === "object") {
      const candidate = response.response as Record<string, unknown>;
      const textValue = candidate.md || candidate.text || candidate.content;
      if (typeof textValue === "string") {
        return textValue;
      }
    }

    throw new Error("PDF conversion returned an unsupported payload");
  }

  /**
   * Wrap a promise with timeout handling.
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Detect common blocked-page markers in fetched HTML.
   */
  private looksBlocked(html: string): boolean {
    const lowerHtml = html.toLowerCase();
    return ["captcha", "access denied", "sign in to continue", "enable javascript"].some((token) =>
      lowerHtml.includes(token)
    );
  }

  /**
   * Identify pages that are likely JS-rendered and need a rendered fallback.
   */
  private shouldUseRenderedFallback(parsed: ParsedURL, html: string): boolean {
    const lowerHtml = html.toLowerCase();
    const hasJsSignals =
      lowerHtml.includes("__next_data__") ||
      lowerHtml.includes('id="root"') ||
      lowerHtml.includes('id="app"') ||
      lowerHtml.includes("loading") ||
      lowerHtml.includes("enable javascript");

    return parsed.status === "failed" || (parsed.content.length < 240 && hasJsSignals);
  }

  /**
   * Create a structured extraction failure payload.
   */
  private createFailure(
    url: string,
    code: ParsedURL["error"] extends { code: infer T } ? T : never,
    message: string
  ): ParsedURL {
    logWarn(`[WebExtractor] ${code} for ${url}: ${message}`);
    return {
      url,
      content: "",
      status: "failed",
      error: { code, message },
      extractedAt: this.now(),
      byteLength: 0,
    };
  }
}

/**
 * Truncate extracted markdown to fit the context budget.
 */
export function truncateWebContent(
  content: string,
  maxContentBytes: number
): {
  content: string;
  truncated: boolean;
} {
  const encoded = new TextEncoder().encode(content);
  if (encoded.byteLength <= maxContentBytes) {
    return { content, truncated: false };
  }

  const headLength = Math.max(200, Math.floor(maxContentBytes * 0.75));
  const tailLength = Math.max(120, Math.floor(maxContentBytes * 0.15));
  const head = content.slice(0, headLength).trimEnd();
  const tail = content.slice(-tailLength).trimStart();

  return {
    truncated: true,
    content:
      `${head}\n\n[Content truncated to fit the context window.]` + (tail ? `\n\n${tail}` : ""),
  };
}

/**
 * Collapse repeated whitespace into readable plain text.
 */
function collapseWhitespace(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

/**
 * Clean markdown output after HTML conversion.
 */
function cleanMarkdown(content: string): string {
  return content
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Extract metadata from HTML meta or element selectors.
 */
function extractMetaContent(document: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node) {
      continue;
    }

    const datetime = node.getAttribute("datetime");
    if (datetime) {
      return datetime;
    }

    const content = node.getAttribute("content");
    if (content) {
      return content;
    }

    const text = node.textContent?.trim();
    if (text) {
      return text;
    }
  }

  return undefined;
}
