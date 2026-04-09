# Implementation Plan: YouTube Content Processor

**Branch**: `006-youtube-processor` | **Date**: 2026-04-08 | **Spec**: `/Users/thiago/Dev/obsidian-copilot/specs/006-youtube-processor/spec.md`
**Input**: Feature specification from `/Users/thiago/Dev/obsidian-copilot/specs/006-youtube-processor/spec.md`

## Summary

Build a provider-based YouTube transcript pipeline that normalizes video captions into timestamped markdown, caches them on disk, injects them through the existing `youtube_video_context` flow for summaries and follow-up Q&A, and adds configurable transcript note export plus an optional remote audio fallback for videos without captions.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+  
**Primary Dependencies**: Obsidian Plugin API, React 18, LangChain tool framework, existing `BrevilabsClient`, existing self-host Supadata integration, existing Web Viewer transcript extraction, Jotai settings state  
**Storage**: Vault markdown notes for saved transcripts + JSON cache files under `.copilot/youtube-cache/`  
**Testing**: Jest with adjacent `.test.ts` files, `@testing-library/react` for modal/UI updates, repository lint/build gates  
**Target Platform**: Obsidian plugin runtime, desktop-first for Web Viewer enhancements, URL-based transcript extraction usable from normal plugin flows  
**Project Type**: Single-project Obsidian desktop plugin  
**Performance Goals**: Caption-backed extraction for public videos up to 2 hours should meet the spec target of <=10s under healthy provider conditions; cache hits should be effectively instantaneous; long-running audio fallback must expose progress instead of pretending to be fast  
**Constraints**: No bundled subprocess tools or binaries, preserve existing `youtube_video_context` compatibility, no prompt changes, use logging utilities instead of `console.*`, keep providers and folders configurable, remain testable with pure leaf modules  
**Scale/Scope**: One feature spanning services, cache, tools, mentions, project context, modal export, settings, tests, and user docs; expected to handle repeated transcript reuse across chats and project loads

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Pre-Phase 0

- **PASS - Generalizable Solutions**: Provider selection, language preference, cache TTL, and output folder are all planned as settings rather than hardcoded for a single backend or folder.
- **PASS - Clean Architecture**: The design centers on a shared extractor, pure formatting helpers, and thin tool/mention/UI adapters.
- **PASS - Prompt Integrity**: No prompt or system prompt edits are part of this feature.
- **PASS - Type Safety / Testable by Design**: URL parsing, chapter parsing, formatting, and cache-key generation will live in small testable modules; provider and vault calls remain at the orchestration edges.
- **PASS - Structured Logging / Documentation Discipline**: Implementation scope explicitly includes replacing direct console usage in touched YouTube code and updating user-facing docs for settings and behavior changes.

### Post-Phase 1 Re-check

- **PASS - No justified violations**: The design reuses the existing `youtube_video_context` tag and current plugin structure instead of adding a parallel context system.
- **PASS - Complexity remains bounded**: One extractor facade plus provider/cache/formatter leaf modules is the minimal structure that avoids duplicating logic across tools, mentions, project loading, and modal export.

## Project Structure

### Documentation (this feature)

```text
specs/006-youtube-processor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── interfaces.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── cache/
│   └── youtubeCache.ts
├── components/
│   └── modals/
│       └── YoutubeTranscriptModal.tsx
├── context/
├── LLMProviders/
│   ├── projectManager.ts
│   └── selfHostServices.ts
├── mentions/
│   └── Mention.ts
├── services/
│   ├── youtubeExtractor.ts
│   ├── youtubeTranscriptFormatter.ts
│   ├── youtubeTranscriptProvider.ts
│   └── youtubeContextTypes.ts
├── settings/
│   ├── model.ts
│   └── v2/components/
├── tools/
│   └── YoutubeTools.ts
└── utils/

docs/
├── context-and-mentions.md
├── agent-mode-and-tools.md
├── copilot-plus-and-self-host.md
└── chat-interface.md
```

**Structure Decision**: Use the existing single-project plugin layout. Keep pure feature logic in `src/services/` and `src/cache/`, then adapt existing entry points in `src/tools/`, `src/mentions/`, `src/LLMProviders/`, and the existing YouTube modal. Tests stay adjacent to the feature files they cover.

## Phase 0: Research Output

- Completed in `research.md`.
- Resolved the main unknowns around provider selection, context compatibility, cache strategy, save-to-vault behavior, and no-captions fallback.

## Phase 1: Design Output

- Completed in `data-model.md`.
- Completed in `contracts/interfaces.md`.
- Completed in `quickstart.md`.

## Complexity Tracking

No constitution violations currently require justification.
