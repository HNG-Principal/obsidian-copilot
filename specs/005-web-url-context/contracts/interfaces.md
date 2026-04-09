# Interface Contracts: Web & URL Context

**Feature**: `005-web-url-context` | **Date**: 2026-04-08

---

## Core Interfaces

### IWebExtractor

```typescript
interface IWebExtractor {
  /**
   * Fetch a URL and extract its content as markdown.
   * Uses cache when available and not expired.
   */
  extractUrlContent(url: string, options?: ExtractionOptions): Promise<ParsedURL>;
}

interface ExtractionOptions {
  /** Skip cache and force fresh fetch */
  bypassCache?: boolean;
  /** Maximum content size in bytes */
  maxContentBytes?: number;
  /** Fetch timeout in ms */
  timeoutMs?: number;
}
```

### IWebSearchProvider

```typescript
interface IWebSearchProvider {
  /** Provider type identifier */
  readonly providerType: WebSearchProviderType;

  /**
   * Execute a web search query.
   * @param query - Search query string
   * @param maxResults - Maximum results to return
   * @returns Search results from the provider
   */
  search(query: string, maxResults: number): Promise<WebSearchResponse>;
}
```

### IUrlCache

```typescript
interface IUrlCache {
  /**
   * Get cached content for a URL. Returns undefined if not cached or expired.
   */
  get(url: string): Promise<UrlCacheEntry | undefined>;

  /**
   * Store extracted content in cache.
   */
  set(url: string, content: ParsedURL): Promise<void>;

  /**
   * Remove expired entries and enforce size limits.
   */
  cleanup(): Promise<void>;

  /**
   * Clear entire cache.
   */
  clear(): Promise<void>;
}
```

---

## Pure Function Type Contracts

### Normalize URL

```typescript
/**
 * Normalize a URL for consistent caching and deduplication.
 * Removes fragments, normalizes protocol, sorts query params.
 * Reuses existing urlNormalization.ts logic.
 */
type NormalizeUrl = (url: string) => string;
```

### HTML to Markdown

```typescript
/**
 * Convert extracted HTML article content to clean markdown.
 * Preserves headings, lists, tables, bold/italic, links.
 */
type HtmlToMarkdown = (html: string, baseUrl: string) => string;
```

### Format Web Context

```typescript
/**
 * Wrap extracted web content in XML context tags for LLM consumption.
 */
type FormatWebContext = (parsedUrl: ParsedURL) => string;

// Output:
// <web-content url="https://example.com" title="Page Title" fetched="2026-04-08T12:00:00Z">
//   [markdown content]
// </web-content>
```

### Format Search Results

```typescript
/**
 * Wrap web search results in XML context tags.
 */
type FormatSearchResults = (response: WebSearchResponse) => string;

// Output:
// <web-search query="search terms">
//   <result url="..." title="..." rank="1">[snippet]</result>
//   ...
// </web-search>
```

---

## Settings Contract

New settings in `CopilotSettings`:

| Setting                  | Type                    | Default     | Range      | Description                 |
| ------------------------ | ----------------------- | ----------- | ---------- | --------------------------- |
| `webSearchProvider`      | `WebSearchProviderType` | `'searxng'` | —          | Web search backend provider |
| `searxngUrl`             | `string`                | `''`        | —          | SearXNG instance URL        |
| `urlCacheTTLHours`       | `number`                | `24`        | 1–168      | URL cache time-to-live      |
| `maxUrlCacheEntries`     | `number`                | `100`       | 10–1000    | Maximum cached URLs         |
| `urlExtractionTimeoutMs` | `number`                | `10000`     | 5000–60000 | Fetch + extraction timeout  |

Existing settings reused:

- `perplexityApiKey` — for Perplexity Sonar search
- `firecrawlApiKey` — for Firecrawl search

---

## Event Hooks

| Hook                   | Trigger                            | Handler                                                      |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------ |
| URL mentioned in chat  | User types URL or @-mentions a URL | `Mention.processUrl()` → `IWebExtractor.extractUrlContent()` |
| Web search tool called | Agent uses web search tool         | `SearchTools.webSearchTool` → `IWebSearchProvider.search()`  |
| URL cached             | Successful extraction              | `IUrlCache.set()`                                            |
| Cache cleanup          | On plugin load or cache access     | `IUrlCache.cleanup()`                                        |
| Context injection      | Message being prepared for LLM     | `ContextProcessor` wraps web content in XML tags             |
