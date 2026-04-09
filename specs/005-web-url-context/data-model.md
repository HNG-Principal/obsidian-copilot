# Data Model: Web & URL Context

**Feature**: `005-web-url-context` | **Date**: 2026-04-08

---

## Entities

### ParsedURL

A URL that has been fetched and its content extracted.

| Field         | Type                                 | Description                     |
| ------------- | ------------------------------------ | ------------------------------- |
| `url`         | `string`                             | Normalized URL                  |
| `title`       | `string \| undefined`                | Page title                      |
| `content`     | `string`                             | Extracted markdown content      |
| `excerpt`     | `string \| undefined`                | Brief excerpt (first 200 chars) |
| `status`      | `'success' \| 'partial' \| 'failed'` | Extraction outcome              |
| `error`       | `WebExtractionError \| undefined`    | Error details if failed         |
| `extractedAt` | `number`                             | Extraction timestamp (epoch ms) |
| `byteLength`  | `number`                             | Content size in bytes           |

### WebExtractionError

| Field     | Type                     | Description                  |
| --------- | ------------------------ | ---------------------------- |
| `code`    | `WebExtractionErrorCode` | Error category               |
| `message` | `string`                 | Human-readable error message |

### WebExtractionErrorCode (union type)

```typescript
type WebExtractionErrorCode =
  | "network_error"
  | "timeout"
  | "blocked"
  | "paywall"
  | "invalid_url"
  | "parse_error"
  | "too_large";
```

### WebSearchResult

A single result from a web search query.

| Field     | Type     | Description                               |
| --------- | -------- | ----------------------------------------- |
| `url`     | `string` | Result URL                                |
| `title`   | `string` | Result title                              |
| `snippet` | `string` | Search result snippet/description         |
| `source`  | `string` | Search provider that returned this result |
| `rank`    | `number` | Position in search results (1-indexed)    |

### WebSearchResponse

The full response from a web search query.

| Field          | Type                    | Description                                   |
| -------------- | ----------------------- | --------------------------------------------- |
| `query`        | `string`                | Original search query                         |
| `results`      | `WebSearchResult[]`     | Search results                                |
| `provider`     | `WebSearchProviderType` | Provider used                                 |
| `timestamp`    | `number`                | Search timestamp                              |
| `totalResults` | `number \| undefined`   | Estimated total results (if provider reports) |

### WebSearchProviderType (union type)

```typescript
type WebSearchProviderType = "searxng" | "perplexity" | "firecrawl";
```

### UrlCacheEntry

A cached URL extraction stored on disk.

| Field         | Type                  | Description                           |
| ------------- | --------------------- | ------------------------------------- |
| `urlHash`     | `string`              | MD5 hash of normalized URL (file key) |
| `url`         | `string`              | Original URL                          |
| `title`       | `string \| undefined` | Page title                            |
| `content`     | `string`              | Extracted markdown content            |
| `extractedAt` | `number`              | Extraction timestamp (epoch ms)       |
| `expiresAt`   | `number`              | Cache expiration timestamp            |

---

## Relationships

```
ParsedURL     1──0..1 WebExtractionError (failed extraction)
ParsedURL     1──0..1 UrlCacheEntry (cached extraction)
WebSearchResponse 1──* WebSearchResult (search → results)
```

---

## Validation Rules

1. **URL format**: Must be a valid HTTP/HTTPS URL (validated before extraction)
2. **Cache TTL**: `expiresAt > Date.now()` for cache to be valid
3. **Content size**: `byteLength ≤ maxUrlContentBytes` (configurable, prevents memory issues)
4. **Search results**: `results.length ≤ maxSearchResults` (configurable, default 10)
5. **URL hash**: 32-character hex string (MD5)

---

## State Transitions

### URL Extraction Lifecycle

```
Requested → Checking Cache → [Cache Hit] → Return cached
                            → [Cache Miss] → Fetching → Parsing → Extracted → Cached
                                                                 → Failed (not cached)
```

### Cache Entry Lifecycle

```
Created → Valid (within TTL) → Expired → Evicted
                              → Evicted (LRU, cache full)
```

---

## Access Patterns

| Operation             | Frequency                       | Method                             |
| --------------------- | ------------------------------- | ---------------------------------- |
| Extract URL content   | Per @-mention URL or tool call  | `webExtractor.extractUrlContent()` |
| Web search            | Per user query or tool call     | `webSearchProvider.search()`       |
| Check URL cache       | Per extraction request          | `urlCache.get()`                   |
| Store in URL cache    | Per successful extraction       | `urlCache.set()`                   |
| Inject web context    | Per message with URL references | `ContextProcessor` wrapping        |
| Evict expired entries | Periodic (on cache access)      | `urlCache.cleanup()`               |
