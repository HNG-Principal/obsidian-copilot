# Feature Specification: Web & URL Context Engine

**Feature Branch**: `005-web-url-context`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "Web search and URL context engine enabling real-time web search within chat, automatic URL content parsing for any dropped link, and social media content extraction"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Real-Time Web Search (Priority: P1)

A user is in a chat conversation and needs current information that isn't in their vault (e.g., "What are the latest developments in quantum computing?"). They invoke web search (via @websearch or the agent auto-routes), and the system queries the web, retrieves relevant results, and the AI synthesizes a response grounded in fresh web content.

**Why this priority**: Web search is the most frequently needed external context source. It bridges the gap between the user's static vault and the live internet.

**Independent Test**: Perform several web searches on topics with recent developments. Verify results are current (within the last week), relevant, and synthesized into a coherent response.

**Acceptance Scenarios**:

1. **Given** a user asks a question requiring current information, **When** web search is invoked, **Then** search results are returned within 5 seconds.
2. **Given** the search returns multiple results, **When** the AI synthesizes the response, **Then** the response cites the sources used.
3. **Given** a query with no meaningful results, **When** the search completes, **Then** the system informs the user that no relevant results were found and suggests refining the query.

---

### User Story 2 - URL Content Parsing (Priority: P2)

A user drops a URL into the chat (e.g., a blog post, documentation page, or news article). The system automatically fetches the page, extracts the main content (stripping navigation, ads, and boilerplate), converts it to clean markdown, and makes it available as context for the conversation. The user can then ask questions about the page content.

**Why this priority**: URL parsing transforms the chat from an isolated environment into one that can consume any web content. Users frequently want to discuss external articles and documentation.

**Independent Test**: Drop 10 different URLs (blog posts, docs, news articles, wikis). Verify the main content is correctly extracted, ads/nav are stripped, and the content is usable as chat context.

**Acceptance Scenarios**:

1. **Given** a user pastes a URL in the chat, **When** the message is sent, **Then** the page content is fetched, parsed, and available as context within 10 seconds.
2. **Given** a page with heavy navigation and ads, **When** the content is extracted, **Then** only the main article body is returned.
3. **Given** a fetched URL's content is very long, **When** it exceeds the context window limit, **Then** the content is truncated intelligently (preserving the beginning and key sections) with a notice to the user.

---

### User Story 3 - JavaScript-Rendered Page Support (Priority: P3)

A user drops a URL for a single-page application or JavaScript-rendered site (e.g., a React app, an interactive dashboard). The system uses a headless browser or JS-rendering capable fetcher to extract the fully rendered content, not just the raw HTML source.

**Why this priority**: Many modern websites are JS-rendered. Without this capability, a large percentage of URLs would return empty or incomplete content.

**Independent Test**: Drop URLs from known JS-rendered sites (e.g., a React docs page, a dynamic dashboard). Verify the fully rendered content is extracted.

**Acceptance Scenarios**:

1. **Given** a URL to a JavaScript-rendered page, **When** the content is fetched, **Then** the fully rendered content is extracted (not empty or partial HTML).
2. **Given** JS rendering times out, **When** the fallback is triggered, **Then** the system attempts a simple HTML extraction and notifies the user if content may be incomplete.

---

### User Story 4 - Social Media Content Extraction (Priority: P4)

A user drops a social media URL (e.g., a tweet/X post) into the chat. The system extracts the post text, author, date, and any embedded media descriptions. The user can then discuss the content or save it.

**Why this priority**: Social media links are commonly shared and discussed, but their content is hard to extract with standard web scraping. Dedicated extraction is needed.

**Independent Test**: Drop 5 different social media URLs (tweets, threads). Verify the post text, author, and date are correctly extracted.

**Acceptance Scenarios**:

1. **Given** a user pastes a tweet/X URL, **When** the content is extracted, **Then** the post text, author name, and date are returned.
2. **Given** a social media URL for an unsupported platform, **When** extraction is attempted, **Then** the system falls back to generic URL parsing.

---

### Edge Cases

- What happens when a URL returns a 403 (Forbidden) or is behind a login wall?
- How does the system handle PDFs linked via URL — does it parse or redirect to the document conversion service?
- What happens when the same URL is fetched multiple times in the same conversation — is the result cached?
- How are very large pages (>100KB of text content) handled?
- What happens if the web search provider's API key is not configured or rate-limited?
- How are redirected URLs (HTTP 301/302 chains) handled?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST support web search via a configurable search provider, returning top-N results with title, URL, snippet, and extracted content.
- **FR-002**: System MUST support fetching and parsing any public URL into clean markdown (title, author, date, main content).
- **FR-003**: System MUST support rendering JavaScript-heavy pages to extract dynamically loaded content.
- **FR-004**: System MUST support social media content extraction for major platforms (at minimum: X/Twitter).
- **FR-005**: System MUST cache fetched URL content within a conversation to avoid redundant network requests.
- **FR-006**: System MUST truncate or chunk content that exceeds the LLM context window limit, preserving the most relevant portions.
- **FR-007**: System MUST handle fetch failures gracefully (timeouts, 403s, 404s, rate limits) with user-facing error messages.
- **FR-008**: System MUST strip non-content elements (navigation, ads, footers, cookie banners) from parsed pages.
- **FR-009**: System MUST respect a configurable rate limit for web search queries to avoid abuse of search provider APIs.

### Key Entities

- **WebSearchResult**: A single result from a web search. Key attributes: title, URL, snippet, full extracted content (optional).
- **ParsedURL**: The extracted content from a fetched URL. Key attributes: source URL, title, author, publication date, main content (markdown), fetch timestamp.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Web search returns relevant results within 5 seconds for 95% of queries.
- **SC-002**: URL content parsing correctly extracts the main article body (not nav/ads) for at least 90% of tested URLs across a diverse set of 50 sites.
- **SC-003**: JavaScript-rendered pages return meaningful content (not empty) for at least 80% of tested SPA URLs.
- **SC-004**: Social media extraction returns post text and author for at least 90% of tested X/Twitter URLs.
- **SC-005**: Repeated fetches of the same URL within one conversation use cached content (no redundant network calls).

## Assumptions

- The web search provider is configured by the user (BYOK). The system does not bundle a default search API key.
- URL fetching operates from the self-hosted backend, not from the user's local machine, to avoid CORS issues and enable JS rendering.
- Content caching is session-scoped (within a conversation) — no persistent URL content cache across conversations.
- PDF URLs are detected and routed to the Document Conversion Service (F1) rather than being parsed as web pages.
- The system does not bypass paywalls, login walls, or access restrictions — it only extracts publicly accessible content.
