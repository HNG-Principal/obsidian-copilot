export type WebSearchProviderType = "firecrawl" | "perplexity" | "searxng";

export type WebExtractionStatus = "success" | "partial" | "failed";

export type WebExtractionErrorCode =
  | "network_error"
  | "timeout"
  | "blocked"
  | "paywall"
  | "invalid_url"
  | "parse_error"
  | "too_large";

export interface WebExtractionError {
  code: WebExtractionErrorCode;
  message: string;
}

export interface ParsedURL {
  url: string;
  title?: string;
  author?: string;
  publicationDate?: string;
  content: string;
  excerpt?: string;
  status: WebExtractionStatus;
  error?: WebExtractionError;
  extractedAt: number;
  byteLength: number;
}

export interface UrlCacheEntry {
  urlHash: string;
  url: string;
  title?: string;
  author?: string;
  publicationDate?: string;
  content: string;
  excerpt?: string;
  extractedAt: number;
  expiresAt: number;
  byteLength: number;
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  source: string;
  rank: number;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  provider: WebSearchProviderType;
  timestamp: number;
  totalResults?: number;
  summary?: string;
}

export interface WebExtractorOptions {
  bypassCache?: boolean;
  maxContentBytes?: number;
  timeoutMs?: number;
}

export interface IWebExtractor {
  extractUrlContent(url: string, options?: WebExtractorOptions): Promise<ParsedURL>;
}

export interface IUrlCache {
  get(url: string): Promise<UrlCacheEntry | undefined>;
  set(url: string, content: ParsedURL): Promise<void>;
  cleanup(): Promise<void>;
  clear(): Promise<void>;
}

export interface IWebSearchProvider {
  readonly providerType: WebSearchProviderType;
  search(query: string, maxResults: number): Promise<WebSearchResponse>;
}

export interface WebSearchProviderSettings {
  webSearchProvider: WebSearchProviderType;
  searxngUrl: string;
  firecrawlApiKey: string;
  perplexityApiKey: string;
}
