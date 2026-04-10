# Tasks: Web & URL Context

**Input**: Design documents from `/specs/005-web-url-context/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Unit and integration-style verification tasks are included because the specification and quickstart explicitly require measurable validation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the dependencies, settings, and shared types required for local web extraction and configurable search providers.

- [x] T001 Add `@mozilla/readability`, `linkedom`, and `turndown` dependencies for local HTML extraction and markdown conversion in package.json
- [x] T002 [P] Add default values for `webSearchProvider`, `searxngUrl`, `urlCacheTTLHours`, `maxUrlCacheEntries`, and `urlExtractionTimeoutMs` in src/constants.ts
- [x] T003 [P] Extend `CopilotSettings` and `sanitizeSettings()` for the new web search, cache, and extraction settings in src/settings/model.ts
- [x] T004 [P] Create shared `ParsedURL`, `WebExtractionError`, `WebSearchResponse`, `WebSearchResult`, and `UrlCacheEntry` types in src/services/webContextTypes.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared cache, provider, and formatting infrastructure that all user stories rely on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 Create the disk-backed URL cache with TTL expiry and size-limit cleanup in src/cache/urlCache.ts
- [x] T006 [P] Create XML formatting helpers for `<web-content>` and `<web-search>` context blocks in src/services/webContextFormatting.ts
- [x] T007 [P] Create the pluggable provider interface, provider factory, and authentication helpers for Firecrawl, Perplexity, and SearXNG in src/services/webSearchProvider.ts
- [x] T008 [P] Refactor the existing self-host web search entry points to delegate to the new provider layer in src/LLMProviders/selfHostServices.ts
- [x] T009 [P] Expose provider selection, SearXNG URL, cache TTL, cache size, and extraction timeout controls in src/settings/v2/components/CopilotPlusSettings.tsx

**Checkpoint**: Shared web context infrastructure is ready; user stories can now be implemented independently.

---

## Phase 3: User Story 1 - Real-Time Web Search (Priority: P1) 🎯 MVP

**Goal**: Users can run live web searches and receive fast, source-grounded results inside chat.

**Independent Test**: Invoke `@websearch` with recent-events queries, verify results return within the expected time budget, include citations, and surface a clear no-results message when appropriate.

### Tests for User Story 1

- [x] T010 [P] [US1] Add provider unit tests for Firecrawl, Perplexity, and SearXNG dispatch, parsing, and error handling in src/services/webSearchProvider.test.ts
- [x] T011 [P] [US1] Add web search tool tests covering citations, empty-result handling, and provider failure messaging in src/tools/SearchTools.webSearch.test.ts

### Implementation for User Story 1

- [x] T012 [US1] Implement top-N structured search response mapping, provider-specific request logic, and no-results behavior in src/services/webSearchProvider.ts
- [x] T013 [US1] Replace the Brevilabs/self-host branching in the `webSearch` tool with provider-based search execution in src/tools/SearchTools.ts
- [x] T014 [US1] Update web search tool result formatting to preserve source URLs and citation instructions in src/tools/ToolResultFormatter.ts
- [x] T015 [US1] Remove legacy direct web-search fallback code paths while preserving key validation behavior in src/LLMProviders/selfHostServices.ts

**Checkpoint**: Web search is fully functional, source-aware, and independently testable without the legacy Brevilabs web search path.

---

## Phase 4: User Story 2 - URL Content Parsing (Priority: P2)

**Goal**: Users can paste public URLs and get clean, article-focused markdown content injected into chat context.

**Independent Test**: Paste representative article, documentation, news, and wiki URLs; verify the extracted content strips boilerplate, caches repeat fetches, and produces truncated context with a notice when content is too large.

### Tests for User Story 2

- [x] T016 [P] [US2] Add URL extraction tests for readable pages, blocked pages, oversize pages, and cache hits in src/services/webExtractor.test.ts
- [x] T017 [P] [US2] Add context wrapping tests for `<web-content>` blocks and truncation notices in src/contextProcessor.webContent.test.ts

### Implementation for User Story 2

- [x] T018 [US2] Implement fetch, timeout handling, Readability parsing, markdown conversion, and fallback text extraction in src/services/webExtractor.ts
- [x] T019 [US2] Integrate URL cache reads/writes and PDF URL routing into the extractor workflow in src/services/webExtractor.ts
- [x] T020 [US2] Replace generic `url4llm()` processing with `webExtractor` integration for normal URLs in src/mentions/Mention.ts
- [x] T021 [US2] Emit `<web-content>` context blocks with source metadata and truncation markers in src/contextProcessor.ts

**Checkpoint**: Generic URL parsing works end-to-end and can be validated independently from web search.

---

## Phase 5: User Story 3 - JavaScript-Rendered Page Support (Priority: P3)

**Goal**: Users can extract meaningful content from dynamic pages that are incomplete when fetched as raw HTML.

**Independent Test**: Paste several JS-rendered URLs and verify the extractor uses the rendered fallback when raw extraction is too thin, and degrades to partial extraction with a clear warning if rendering fails or times out.

### Tests for User Story 3

- [x] T022 [P] [US3] Add rendered-page fallback tests for thin HTML, rendered success, and rendered timeout degradation in src/services/webExtractor.rendered.test.ts

### Implementation for User Story 3

- [x] T023 [US3] Create a rendered page fetch abstraction for dynamic-page fallback in src/services/renderedPageProvider.ts
- [x] T024 [US3] Detect low-content raw extracts and invoke the rendered-page fallback with partial-result status handling in src/services/webExtractor.ts
- [x] T025 [US3] Surface dynamic-page fallback warnings and partial extraction notices in src/mentions/Mention.ts

**Checkpoint**: JS-heavy pages have a dedicated fallback path and fail gracefully when rendering is unavailable.

---

## Phase 6: User Story 4 - Social Media Content Extraction (Priority: P4)

**Goal**: Users can paste social media links, especially X/Twitter posts, and receive structured post content with author/date metadata.

**Independent Test**: Paste multiple X/Twitter URLs and verify the extracted output includes post text, author, and date; paste an unsupported social URL and verify the flow falls back to generic URL parsing.

### Tests for User Story 4

- [x] T026 [P] [US4] Add X/Twitter extraction tests and unsupported-platform fallback tests in src/services/socialMediaExtractor.test.ts

### Implementation for User Story 4

- [x] T027 [US4] Implement normalized social post extraction and metadata formatting for X/Twitter URLs in src/services/socialMediaExtractor.ts
- [x] T028 [US4] Replace the Brevilabs Twitter path with `socialMediaExtractor` integration in src/mentions/Mention.ts
- [x] T029 [US4] Route supported social URLs through specialized extraction before generic web parsing in src/services/webExtractor.ts

**Checkpoint**: Social URLs are handled through a specialized extraction path and degrade cleanly to generic parsing when unsupported.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finalize documentation, validation, and code quality across all stories.

- [x] T030 [P] Update web-search and URL-context user documentation in docs/agent-mode-and-tools.md and docs/context-and-mentions.md
- [x] T031 [P] Update self-host configuration documentation for SearXNG, Firecrawl, Perplexity, caching, and rendered fallback in docs/copilot-plus-and-self-host.md
- [x] T032 Run the verification checklist scenarios from specs/005-web-url-context/quickstart.md and record any follow-up fixes needed in specs/005-web-url-context/tasks.md
- [x] T033 [P] Add missing JSDoc comments and final cleanup for the new web context services in src/services/webExtractor.ts and src/services/webSearchProvider.ts

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies; can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1; blocks all user stories.
- **Phase 3 (US1)**: Depends on Phase 2; delivers the MVP.
- **Phase 4 (US2)**: Depends on Phase 2; can proceed in parallel with US1 after the foundation is ready.
- **Phase 5 (US3)**: Depends on Phase 4 because rendered fallback extends the extractor built for generic URL parsing.
- **Phase 6 (US4)**: Depends on Phase 4 because social URL handling plugs into the same extractor and mention pipeline.
- **Phase 7 (Polish)**: Depends on the completion of all desired user stories.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after the foundational phase; no dependency on other stories.
- **User Story 2 (P2)**: Starts after the foundational phase; no dependency on US1.
- **User Story 3 (P3)**: Extends US2’s extractor and depends on the generic URL parsing pipeline.
- **User Story 4 (P4)**: Extends US2’s extractor and mention pipeline with specialized social handling.

### Within Each User Story

- Write tests first and verify they fail before implementing behavior.
- Shared type and provider work before integration.
- Extraction/search service logic before UI or context-wrapping integration.
- Story-specific integration before polish.

### Parallel Opportunities

- **Phase 1**: T002, T003, and T004 can run in parallel.
- **Phase 2**: T006, T007, and T009 can run in parallel after T005 begins.
- **US1**: T010 and T011 can run in parallel; T012 then feeds T013 and T014.
- **US2**: T016 and T017 can run in parallel before T018–T021.
- **US3**: T022 can run before T023/T024; T025 depends on extractor integration.
- **US4**: T026 can run before T027–T029.
- **Polish**: T030, T031, and T033 can run in parallel.

---

## Parallel Example: User Story 1

```text
# Write tests in parallel:
T010: src/services/webSearchProvider.test.ts
T011: src/tools/SearchTools.webSearch.test.ts

# After provider behavior is defined:
T012: src/services/webSearchProvider.ts

# Then integration can split:
T013: src/tools/SearchTools.ts
T014: src/tools/ToolResultFormatter.ts
```

## Parallel Example: User Story 2

```text
# Write tests in parallel:
T016: src/services/webExtractor.test.ts
T017: src/contextProcessor.webContent.test.ts

# Then implement extractor core:
T018: src/services/webExtractor.ts
T019: src/services/webExtractor.ts

# Then integrate call sites:
T020: src/mentions/Mention.ts
T021: src/contextProcessor.ts
```

---

## Implementation Strategy

### MVP First (Recommended)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational).
3. Complete Phase 3 (User Story 1).
4. Validate live web search behavior before proceeding.

### Incremental Delivery

## Verification Notes

- Focused validation completed with `npm test -- --runInBand` across the new web search, URL extraction, rendered fallback, social extraction, formatter, compatibility wrapper, and context-registry suites: 69 tests passed.
- `npm run lint` completed successfully.
- Manual live-provider checks from the quickstart that require real Firecrawl, Perplexity, or SearXNG credentials remain environment-dependent and were not exercised in this workspace.
- Manual UI confirmation of the settings screen and rendered fallback with a live open Web Viewer tab remains a follow-up verification step outside the automated suite.

1. Ship **US1** for live web search.
2. Add **US2** for pasted URL article parsing.
3. Add **US3** for dynamic-page fallback.
4. Add **US4** for social media extraction.
5. Finish documentation and final verification in Phase 7.

### Suggested MVP Scope

**User Story 1 only** after Setup and Foundational phases. This delivers immediate user value and removes the highest-priority cloud web-search dependency first.

---

## Notes

- [P] tasks target different files and can be assigned to different contributors safely.
- Each user story maps directly back to the priority order in spec.md.
- The task list intentionally covers JS-rendered pages and social URLs because they are explicit requirements in spec.md, even though plan.md focuses more heavily on generic extraction and search.
- Keep documentation updates user-facing and non-technical per repository guidance.
