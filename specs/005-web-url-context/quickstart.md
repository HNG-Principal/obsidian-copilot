# Quickstart: Web & URL Context

**Feature**: `005-web-url-context` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: URL Content Extractor

Create `src/services/webExtractor.ts`:

- `extractUrlContent(url: string, options?): Promise<ParsedURL>`
- Fetch HTML via `fetch()` with configurable timeout
- Parse HTML with `linkedom` for DOM APIs
- Run `@mozilla/readability` for article extraction
- Convert article HTML to markdown (headings, lists, tables, links preserved)
- Fallback: if Readability fails, strip HTML tags and return plain text
- Return `ParsedURL` with status, content, metadata

### Step 2: URL Cache

Create `src/cache/urlCache.ts`:

- Follow `pdfCache.ts` pattern
- Key: MD5 hash of normalized URL
- Storage: `.copilot/url-cache/` directory, one JSON file per entry
- TTL-based expiration check on read
- LRU eviction when `maxUrlCacheEntries` exceeded
- `get()`, `set()`, `cleanup()`, `clear()` methods

### Step 3: Web Search Provider

Create `src/services/webSearchProvider.ts`:

- `IWebSearchProvider` interface with `search()` method
- `SearXNGProvider`: HTTP request to user's SearXNG instance, parse JSON
- `PerplexitySonarProvider`: Perplexity API call with Sonar model
- `FirecrawlProvider`: Firecrawl search API call
- Factory: `createWebSearchProvider(settings): IWebSearchProvider`
- Each provider handles authentication from settings

### Step 4: Wire Mention Processing

Modify `src/mentions/Mention.ts`:

- Route `processUrl()` through `webExtractor.extractUrlContent()`
- Replace Brevilabs `url4llm()` calls with local extraction
- Use URL cache for repeated URLs
- Handle extraction errors gracefully (show inline error in chat)

### Step 5: Wire Web Search Tool

Modify `src/tools/SearchTools.ts`:

- `webSearchTool` uses `webSearchProvider.search()` instead of Brevilabs
- Format search results for LLM consumption
- Handle provider errors gracefully

### Step 6: Context Integration

Modify `src/contextProcessor.ts`:

- Wrap extracted URL content in `<web-content>` XML tags
- Wrap search results in `<web-search>` XML tags
- Content length capping with truncation marker
- Consistent with existing `<embedded-pdf>`, `<embedded-note>` patterns

### Step 7: Settings

Modify `src/settings/model.ts`:

- Add `webSearchProvider`, `searxngUrl`, `urlCacheTTLHours`, `maxUrlCacheEntries`, `urlExtractionTimeoutMs`
- Settings UI for provider selection and configuration

---

## Prerequisites

- Install `@mozilla/readability` and `linkedom` as dependencies
- Verify both bundle with esbuild (no native Node.js modules)
- Existing `Mention.ts` URL processing functional
- Existing `SearchTools.ts` web search tool functional

---

## Verification Checklist

- [ ] URL extraction returns readable markdown for typical web articles
- [ ] URL extraction handles paywalled/blocked sites gracefully (error message)
- [ ] URL cache prevents redundant network requests
- [ ] Expired cache entries trigger fresh fetch
- [ ] Cache cleanup removes expired entries
- [ ] Web search returns results from configured provider
- [ ] SearXNG provider connects to instance and returns results
- [ ] Perplexity Sonar provider returns results with API key
- [ ] Firecrawl provider returns results with API key
- [ ] @mention URL shows extracted content in chat context
- [ ] Context wrapping uses correct XML tags
- [ ] Network timeout returns clear error message
- [ ] Invalid URL returns clear error message
- [ ] Settings UI allows provider selection and configuration
- [ ] All pure functions have passing unit tests

---

## Key Files Reference

| File                                | Purpose                            |
| ----------------------------------- | ---------------------------------- |
| `src/services/webExtractor.ts`      | URL content extraction (new)       |
| `src/services/webSearchProvider.ts` | Pluggable search backends (new)    |
| `src/cache/urlCache.ts`             | URL content caching (new)          |
| `src/mentions/Mention.ts`           | URL processing pipeline (modified) |
| `src/tools/SearchTools.ts`          | Web search tool (modified)         |
| `src/contextProcessor.ts`           | Context XML wrapping (modified)    |
| `src/utils/urlNormalization.ts`     | URL normalization (existing)       |
| `src/settings/model.ts`             | Web settings (modified)            |
