# Quickstart: YouTube Processor

**Feature**: `006-youtube-processor` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: Consolidate Shared Types and URL Parsing

Create a shared YouTube types module and a single pure URL parser.

- Add `ParsedYouTubeUrl`, `YouTubeVideo`, `VideoTranscript`, `TranscriptSegment`, and cache types.
- Replace duplicated URL parsing logic with a shared `parseYouTubeUrl()` helper.
- Add targeted tests for standard watch URLs, short URLs, embed URLs, shorts URLs, and timestamp parameters.

### Step 2: Add Transcript Provider and Cache Layers

Create the orchestration surface that every caller will use.

- Add `src/services/youtubeTranscriptProvider.ts` for provider selection.
- Add `src/cache/youtubeCache.ts` following the `pdfCache.ts` and `urlCache.ts` patterns.
- Reuse existing Brevilabs and Supadata code paths behind the provider contract.
- Reuse the Web Viewer DOM transcript extractor when a matching active YouTube tab is available.

### Step 3: Add Pure Transcript Formatting and Chapter Parsing

Create a pure formatter module for readable transcript output.

- Add `parseYouTubeChapters(description)`.
- Add timestamp formatting helpers.
- Add paragraph grouping and chapter insertion.
- Return both `plainText` and `formattedMarkdown` outputs for different consumers.

### Step 4: Wire Tool, Mention, and Project Context Flows

Replace direct transcript calls with the shared extractor.

- Update `src/tools/YoutubeTools.ts` to call `YouTubeExtractor.extractTranscript()`.
- Update `src/mentions/Mention.ts` to route `processYoutubeUrl()` through the extractor.
- Update `src/LLMProviders/projectManager.ts` to stop bypassing the shared service.
- Preserve `youtube_video_context` compatibility for context compaction and recovery.

### Step 5: Add Save-to-Vault Note Output

Implement transcript-specific note export.

- Add a note writer service for transcript markdown.
- Add a configurable transcript output folder setting.
- Support overwrite or disambiguated file naming.
- Update the existing YouTube transcript modal or command flow to use the new writer.

### Step 6: Add Configurable Audio Fallback Path

Introduce the abstraction for no-caption scenarios.

- Add `audioTranscriptionProvider` setting and contract.
- Attempt audio fallback only when enabled and configured.
- Return progress/error messaging appropriate for longer-running transcription.
- Keep the implementation remote-provider-based; do not add bundled binaries.

### Step 7: Finish Tests and Docs

- Add extractor, formatter, cache, and integration tests.
- Update user docs for YouTube URL mentions, tool behavior, and provider configuration.
- Run `npm run lint`, `npm run test`, and `npm run build` before completion.

---

## Prerequisites

- Existing YouTube entry points remain available in `Mention`, `YoutubeTools`, and project context loading.
- Existing provider credentials may be present for Brevilabs and Supadata.
- The implementation must stay compatible with the Obsidian plugin runtime and existing context block tags.

---

## Verification Checklist

- [ ] Standard watch URLs extract transcripts correctly.
- [ ] `youtu.be`, `shorts`, and embed URLs normalize to the same video identity.
- [ ] Cache hits return previously formatted transcripts without a new provider call.
- [ ] Transcript formatting includes stable timestamps and readable paragraphs.
- [ ] Description-based chapters become transcript headings when available.
- [ ] Mention processing injects a recoverable `youtube_video_context` block.
- [ ] Agent tool execution returns transcript output without using direct provider calls in the tool body.
- [ ] Project YouTube context loading uses the shared extractor service.
- [ ] Transcript note export creates a markdown file in the configured output folder.
- [ ] Duplicate saves either overwrite intentionally or create a disambiguated path.
- [ ] No-caption videos produce either a configured fallback transcription or a clear error.
- [ ] Non-English videos respect preferred language selection when a provider supports it.

---

## Key Files Reference

| File                                               | Purpose                                        |
| -------------------------------------------------- | ---------------------------------------------- |
| `src/services/youtubeExtractor.ts`                 | Shared extraction facade                       |
| `src/services/youtubeTranscriptProvider.ts`        | Provider selection and normalization           |
| `src/services/youtubeTranscriptFormatter.ts`       | Pure transcript formatting and chapter parsing |
| `src/cache/youtubeCache.ts`                        | Disk cache for transcript payloads             |
| `src/tools/YoutubeTools.ts`                        | Tool integration                               |
| `src/mentions/Mention.ts`                          | Mention and pasted-URL integration             |
| `src/LLMProviders/projectManager.ts`               | Project context loading integration            |
| `src/contextProcessor.ts`                          | YouTube context block formatting               |
| `src/components/modals/YoutubeTranscriptModal.tsx` | User-facing export flow                        |
| `src/settings/model.ts`                            | YouTube settings additions                     |
