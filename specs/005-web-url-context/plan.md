# Implementation Plan: Web & URL Context

**Branch**: `005-web-url-context` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-web-url-context/spec.md`

## Summary

Self-hosted web content extraction and live web search pipeline that converts URLs and web search results into structured LLM context. Replaces `BrevilabsClient.url4llm()` and `BrevilabsClient.webSearch()` cloud dependencies with local extraction (Readability algorithm) and configurable search backends (Firecrawl, Perplexity Sonar, or SearXNG). Extends the existing `@mention` URL processing, web viewer service, and web search tool infrastructure.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API, `@mozilla/readability` (article extraction), `linkedom` or similar (DOM parsing without browser)
**Storage**: URL content cache in `.copilot/url-cache/` (new), web search results in memory (per-conversation)
**Testing**: Jest + unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: URL extraction <10s (SC-001), web search <5s (SC-002)
**Constraints**: Self-hosted extraction (no Brevilabs), configurable search provider (BYOK API keys), offline graceful degradation
**Scale/Scope**: ~6 modified/new files, extends existing URL and web search infrastructure

## Constitution Check

| Principle                          | Status   | Notes                                                                                                                                                                     |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | URL extraction uses standard Readability algorithm — works for any website. Search provider is configurable, not hardcoded. No URL-pattern-specific logic.                |
| II. Clean Architecture             | **PASS** | `WebExtractor` (extraction) → `WebSearchProvider` (search) → `ContextProcessor` (context injection). Clean separation between fetching, parsing, and context integration. |
| III. Prompt Integrity              | **PASS** | No existing prompts modified. Web content injected as context, not as prompt changes.                                                                                     |
| IV. Type Safety                    | **PASS** | `ParsedURL`, `WebSearchResult`, `WebExtractionResult` types cover all outputs.                                                                                            |
| V. Structured Logging              | **PASS** | All logging via `logInfo/logWarn/logError`.                                                                                                                               |
| VI. Testable by Design             | **PASS** | HTML → markdown extraction is pure (HTML string → markdown string). URL normalization is pure. Search provider abstraction allows mock testing.                           |
| VII. Simplicity & Minimal Overhead | **PASS** | Replaces cloud API calls with local Readability + fetch. Reuses existing `Mention.processUrl()` pipeline. No new backend services.                                        |
| VIII. Documentation Discipline     | **PASS** | Will update relevant docs. JSDoc on all new functions.                                                                                                                    |

**Gate result: PASS — all principles confirmed.**

## Project Structure

### Documentation (this feature)

```text
specs/005-web-url-context/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── webExtractor.ts                  # NEW — URL → markdown extraction using Readability
│   ├── webExtractor.test.ts             # NEW — unit tests
│   ├── webSearchProvider.ts             # NEW — pluggable web search backends
│   ├── webSearchProvider.test.ts        # NEW — unit tests
│   └── webViewerService/               # EXISTING — web viewer integration
├── mentions/
│   └── Mention.ts                       # MODIFIED — route URL processing through webExtractor
├── tools/
│   └── SearchTools.ts                   # MODIFIED — webSearchTool uses webSearchProvider
├── cache/
│   └── urlCache.ts                      # NEW — URL content caching with TTL
├── contextProcessor.ts                  # MODIFIED — integrate web content with XML tags
├── utils/
│   └── urlNormalization.ts              # EXISTING — reused for URL normalization
└── settings/
    └── model.ts                         # MODIFIED — add web search provider, URL cache TTL settings
```

**Structure Decision**: `webExtractor.ts` and `webSearchProvider.ts` are new, focused modules in `services/` alongside the existing `webViewerService/`. The cache module follows the existing `pdfCache.ts` pattern. URL processing in `Mention.ts` delegates to the new extractor.

## Complexity Tracking

> No constitution violations detected. Table left empty.
