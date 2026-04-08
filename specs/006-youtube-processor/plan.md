# Implementation Plan: YouTube Processor

**Branch**: `006-youtube-processor` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-youtube-processor/spec.md`

## Summary

Self-hosted YouTube video transcript extraction and processing pipeline that converts YouTube URLs into structured LLM context. Replaces `BrevilabsClient.youtube4llm()` cloud dependency with direct transcript fetching (YouTube captions API or `youtube-transcript` library) and optional timestamp-aligned chunking. Extends the existing `YoutubeTools` and `Mention.processYoutubeUrl()` infrastructure. Supports multiple languages and auto-generated captions.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API, `youtube-transcript` or similar library for caption fetching
**Storage**: Transcript cache in `.copilot/youtube-cache/` (new)
**Testing**: Jest + unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: Transcript extraction <10s (SC-001), chapter detection <2s (SC-002)
**Constraints**: Self-hosted (no Brevilabs), no YouTube Data API v3 key required for basic transcripts (public captions), Supadata API as optional premium backend
**Scale/Scope**: ~5 modified/new files, extends existing YouTube tools

## Constitution Check

| Principle                          | Status   | Notes                                                                                                                                                                     |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | Works for any YouTube URL. Language selection based on user preference, not hardcoded. Chapter detection uses standard YouTube description pattern parsing.               |
| II. Clean Architecture             | **PASS** | `YouTubeExtractor` (transcript fetch) → `TranscriptProcessor` (chunking/formatting) → `ContextProcessor` (context injection).                                             |
| III. Prompt Integrity              | **PASS** | No existing prompts modified.                                                                                                                                             |
| IV. Type Safety                    | **PASS** | `YouTubeVideo`, `VideoTranscript`, `TranscriptSegment` types cover all data.                                                                                              |
| V. Structured Logging              | **PASS** | All logging via `logInfo/logWarn/logError`.                                                                                                                               |
| VI. Testable by Design             | **PASS** | Transcript parsing is pure (raw caption data → structured segments). Chapter detection is pure (description text → chapters). URL extraction is pure (string → video ID). |
| VII. Simplicity & Minimal Overhead | **PASS** | Minimal new code — extends existing `YoutubeTools.ts`. Library handles caption fetching. No complex infrastructure.                                                       |
| VIII. Documentation Discipline     | **PASS** | JSDoc on all new functions.                                                                                                                                               |

**Gate result: PASS — all principles confirmed.**

## Project Structure

### Documentation (this feature)

```text
specs/006-youtube-processor/
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
│   ├── youtubeExtractor.ts               # NEW — YouTube transcript fetching and processing
│   ├── youtubeExtractor.test.ts          # NEW — unit tests
│   └── transcriptProcessor.ts            # NEW — timestamp chunking, chapter detection
│   └── transcriptProcessor.test.ts       # NEW — unit tests
├── tools/
│   └── YoutubeTools.ts                    # MODIFIED — delegate to youtubeExtractor
├── mentions/
│   └── Mention.ts                         # MODIFIED — route YouTube URLs through new extractor
├── cache/
│   └── youtubeCache.ts                    # NEW — transcript caching
├── contextProcessor.ts                    # MODIFIED — YouTube content XML wrapping
└── settings/
    └── model.ts                           # MODIFIED — add preferred transcript language
```

**Structure Decision**: `youtubeExtractor.ts` handles fetching (network layer), `transcriptProcessor.ts` handles formatting (pure logic). This separation allows `transcriptProcessor` to be fully testable without network mocking.

## Complexity Tracking

> No constitution violations detected. Table left empty.
