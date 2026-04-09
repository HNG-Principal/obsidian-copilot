# Research Decisions: Web & URL Context

**Feature**: `005-web-url-context` | **Date**: 2026-04-08

---

## 1. URL Content Extraction Strategy

**Decision**: Use Mozilla's `@mozilla/readability` library with a lightweight DOM parser (`linkedom`) for article extraction from HTML.

**Rationale**: Readability is the battle-tested algorithm behind Firefox's Reader View. It strips ads, navigation, and clutter to extract the main article content. Running it locally eliminates the Brevilabs cloud dependency. `linkedom` provides DOM APIs without a full browser environment, suitable for server-side (Electron) processing.

**Alternatives Considered**:

- **Keep Brevilabs `url4llm()`**: Rejected — violates self-hosted requirement.
- **Firecrawl API for extraction**: Considered — good quality but requires external API key and service. Offer as optional premium backend, not primary.
- **Simple HTML-to-text strip**: Rejected — loses structure (headings, lists, tables). Readability preserves semantic structure.
- **Puppeteer/Playwright for JavaScript rendering**: Rejected — too heavy for an Obsidian plugin. Falls back to fetch + Readability, which handles most content-focused pages.

**Implementation Approach**:

- `webExtractor.ts`: `extractUrlContent(url: string): Promise<WebExtractionResult>`
- Fetch HTML via `fetch()` (available in Electron)
- Parse with `linkedom` to get a DOM document
- Run `@mozilla/readability` on the DOM → `{ title, content (HTML), textContent, excerpt }`
- Convert article HTML to markdown using a lightweight converter (turndown or custom)
- Handle non-article pages: fallback to full-text extraction with HTML stripping

---

## 2. Web Search Provider Architecture

**Decision**: Pluggable search provider interface with three backends: SearXNG (self-hosted, free), Perplexity Sonar (commercial), and Firecrawl (commercial).

**Rationale**: Different users have different preferences and budgets. A pluggable interface allows supporting multiple backends without conditional logic. The existing `selfHostWebSearch()` already supports Firecrawl and Perplexity Sonar — this formalizes the pattern.

**Alternatives Considered**:

- **Single provider (SearXNG only)**: Rejected — not all users want to self-host a search instance.
- **Google Custom Search API**: Considered — commercial option, but requires Google Cloud setup. Defer to v2.
- **Tavily API**: Considered — purpose-built for LLM search. Defer to v2.
- **No web search (URL-only)**: Rejected — spec FR-005 requires live web search.

**Implementation Approach**:

- `IWebSearchProvider` interface: `search(query: string, maxResults: number): Promise<WebSearchResult[]>`
- `SearXNGProvider`: HTTP call to user's SearXNG instance
- `PerplexitySonarProvider`: Perplexity API with Sonar model
- `FirecrawlProvider`: Firecrawl search API
- Factory function selects provider based on `webSearchProvider` setting
- Each provider handles its own authentication (API keys from settings)

---

## 3. URL Content Caching

**Decision**: Disk-based cache with configurable TTL (default 24 hours), using URL hash as key, stored in `.copilot/url-cache/`.

**Rationale**: Fetching and extracting URLs is slow (network + parsing). Caching prevents redundant work when the same URL is referenced multiple times in conversation. Disk-based cache survives Obsidian restarts. TTL ensures content freshness for frequently-changing pages.

**Alternatives Considered**:

- **No cache**: Rejected — same URL referenced twice means two network fetches.
- **Memory-only cache**: Rejected — lost on Obsidian restart, which is frequent for a desktop app.
- **Unlimited cache duration**: Rejected — web content changes. TTL ensures freshness.
- **Context-scoped cache only**: Rejected — same URL across conversations should benefit from cache.

**Implementation Approach**:

- `urlCache.ts` following `pdfCache.ts` pattern
- Key: MD5 hash of normalized URL
- Value: `{ content: string, title: string, extractedAt: number, url: string }`
- TTL: configurable `urlCacheTTLHours` (default 24), check on read
- Storage: `.copilot/url-cache/` directory, one JSON file per cached URL
- Size limit: configurable `maxUrlCacheSize` (default 100 entries), LRU eviction

---

## 4. Context Integration Pattern

**Decision**: Web content wrapped in XML tags (`<web-content>`) with source attribution, consistent with existing `<embedded-pdf>` and `<embedded-note>` patterns.

**Rationale**: The codebase already uses XML tags for context wrapping. Using the same pattern for web content ensures consistency and makes it easy for the LLM to identify content sources.

**Alternatives Considered**:

- **Plain text insertion**: Rejected — no clear boundary between web content and conversation.
- **Markdown blockquote**: Rejected — may conflict with quoted content in the web page itself.
- **Separate context section**: Rejected — inconsistent with existing XML tag approach.

**Implementation Approach**:

- URL content: `<web-content url="https://example.com" title="Page Title" fetched="2026-04-08">[markdown]</web-content>`
- Web search results: `<web-search query="search terms"><result url="..." title="...">[snippet]</result>...</web-search>`
- Existing `WEB_TAB_CONTEXT_TAG`, `ACTIVE_WEB_TAB_CONTEXT_TAG` reused for web viewer content
- Content length capping: truncate to configurable max tokens with `[Content truncated]` marker

---

## 5. Error Handling for Network Failures

**Decision**: Graceful degradation with user-visible error messages. Return partial results when possible.

**Rationale**: Network operations are inherently unreliable. The user should see a clear message when a URL fails to load, not a generic error. If web search returns some results before one fails, return what's available.

**Alternatives Considered**:

- **Silent failure**: Rejected — user thinks the URL was processed when it wasn't.
- **Retry with exponential backoff**: Overkill for v1 — user can manually retry.
- **Proxy/fallback service**: Rejected — adds dependency complexity.

**Implementation Approach**:

- `WebExtractionResult`: status field (`success` | `partial` | `failed`)
- Common failure types: `network_error`, `timeout`, `blocked`, `paywall`, `invalid_url`
- Timeout: configurable (default 10s)
- For @mention URLs: show inline error in chat (e.g., "Could not fetch https://example.com: connection timed out")
- For web search: return available results, note failed queries in chat
