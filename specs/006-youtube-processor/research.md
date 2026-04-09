# Research Decisions: YouTube Processor

**Feature**: `006-youtube-processor` | **Date**: 2026-04-08

---

## 1. Transcript Extraction Architecture

**Decision**: Build a `YouTubeExtractor` facade with pluggable providers instead of wiring transcript fetching directly into tools or mentions.

**Rationale**: The repo already has three relevant transcript paths: Brevilabs URL-based extraction, self-hosted Supadata polling in `selfHostServices.ts`, and DOM-based transcript extraction for active YouTube tabs in `webViewerServiceActions.ts`. A provider facade lets feature 006 reuse those paths immediately, keep settings configurable, and avoid deepening duplication.

**Alternatives Considered**:

- **Keep direct Brevilabs and Supadata calls in `YoutubeTools.ts` and `Mention.ts`**: Rejected because it hardcodes orchestration into multiple call sites and makes testing brittle.
- **Adopt a new public-caption library as the only primary path**: Rejected for the initial implementation plan because the repo already has working extraction paths and the bundling/runtime risk is still unverified.
- **Use only the Web Viewer DOM path**: Rejected because command and agent flows must also work from pasted URLs without an active viewer tab.

**Implementation Approach**:

- Introduce `src/services/youtubeExtractor.ts` as the single orchestration entry point.
- Introduce `src/services/youtubeTranscriptProvider.ts` to choose among caption providers.
- Reuse existing Web Viewer transcript extraction when a matching active tab is available.
- Reuse existing Brevilabs and Supadata integrations for URL-only extraction.
- Keep room for a future public-caption provider behind the same provider contract.

---

## 2. Canonical URL Parsing and Video Identity

**Decision**: Replace ad hoc YouTube parsing with one shared pure parser that returns a canonical video identity object.

**Rationale**: The codebase currently has YouTube parsing in both `src/utils.ts` and `src/services/webViewerService/webViewerServiceActions.ts`. Feature 006 should converge those rules into a single leaf utility so caching, tool flows, save-to-vault naming, and Web Viewer matching all resolve the same `videoId`, canonical URL, and optional start time.

**Alternatives Considered**:

- **Leave multiple parsers in place**: Rejected because it risks cache misses and inconsistent handling of short URLs, embeds, and timestamp parameters.
- **Treat the raw URL string as the cache key**: Rejected because the same video can appear in multiple valid URL formats.

**Implementation Approach**:

- Add a shared parser that normalizes `watch`, `youtu.be`, `shorts`, `embed`, and timestamp-bearing URLs.
- Return a `ParsedYouTubeUrl` structure with `videoId`, canonical URL, original URL, and optional `startTimeSeconds`.
- Use `videoId + language + provider` as the stable identity for cache entries.

---

## 3. Transcript Normalization and Timestamped Output

**Decision**: Normalize provider output into ordered transcript segments, then format those segments into paragraph-level markdown with timestamp markers and optional chapter headings.

**Rationale**: Current transcript consumers only receive a flat text blob. The feature spec requires better summarization and follow-up Q&A grounding, which depends on stable timestamps and readable sections rather than raw segment streams.

**Alternatives Considered**:

- **Store only one large transcript string**: Rejected because timestamp-aware Q&A and save-to-vault formatting need structured segments.
- **Expose raw provider segments directly to every caller**: Rejected because each provider returns slightly different shapes and would leak provider complexity upward.

**Implementation Approach**:

- Add a pure formatter module such as `src/services/youtubeTranscriptFormatter.ts`.
- Normalize all providers into a shared `TranscriptSegment` type.
- Merge short consecutive segments into readable paragraphs.
- Emit timestamps in `[MM:SS]` or `[HH:MM:SS]` form depending on duration.
- Preserve source metadata such as language, provider, and whether captions were auto-generated.

---

## 4. Chapter Detection Strategy

**Decision**: Parse chapters from the video description when available and treat them as optional structure hints rather than a required dependency.

**Rationale**: Existing Web Viewer extraction already returns `description`, and provider responses may also expose it. Description-based chapter parsing is cheap, deterministic, and does not require a separate API key. It improves long-video summarization without creating a hard failure mode when descriptions are sparse.

**Alternatives Considered**:

- **Skip chapter support**: Rejected because long videos are explicitly called out in the spec and benefit from structural headings.
- **Infer chapters with model prompts**: Rejected because it is nondeterministic and unnecessarily expensive for a formatting concern.

**Implementation Approach**:

- Parse standard timestamp-prefixed description lines.
- Map parsed chapter start times onto transcript segments.
- Insert chapter headings into formatted markdown only when the chapter parse is valid.

---

## 5. Context Injection Compatibility

**Decision**: Continue using the existing `youtube_video_context` XML tag rather than introducing a new context tag.

**Rationale**: The repo already has context compaction, parsing, recovery, and tests built around `youtube_video_context`. Reusing that tag minimizes churn and keeps history compaction and existing commands working while still allowing richer inner metadata fields.

**Alternatives Considered**:

- **Introduce `<youtube-transcript>` as a brand-new tag**: Rejected because it would force parallel changes across context parsing, compaction, tests, and commands with no product benefit.
- **Reuse generic web-content blocks**: Rejected because YouTube needs transcript-specific metadata and timestamp-aware formatting.

**Implementation Approach**:

- Extend `buildYouTubeBlock()` or a dedicated helper to include `video_id`, `channel`, `upload_date`, `duration`, transcript content, and error states.
- Keep output compatible with the current `YOUTUBE_VIDEO_CONTEXT_TAG` constant.

---

## 6. Save-to-Vault Output Strategy

**Decision**: Use a dedicated transcript note writer that follows the same folder-resolution and collision-handling principles as converted document output.

**Rationale**: `saveAsMarkdown()` from the Web Viewer saves the page, not a transcript note shaped for knowledge capture. The feature spec needs markdown files with title, URL, timestamps, and transcript content, plus configurable output folders and collision handling.

**Alternatives Considered**:

- **Reuse `saveAsMarkdown()` directly**: Rejected because it saves page content, not the structured transcript artifact required by the spec.
- **Always insert the transcript at cursor**: Rejected because the spec explicitly requires permanent vault notes and duplicate handling.

**Implementation Approach**:

- Add a note writer service that mirrors the collision-handling patterns in `src/utils/convertedDocOutput.ts`.
- Make the transcript output folder configurable.
- Support overwrite prompt or disambiguated naming as a caller-level choice.

---

## 7. Cache Strategy

**Decision**: Add a disk-backed `youtubeCache` with TTL and bounded entry count.

**Rationale**: Transcript fetches are relatively expensive and the same video may be referenced repeatedly across chats, mentions, and project context loads. Existing `pdfCache` and `urlCache` patterns make this a low-risk fit.

**Alternatives Considered**:

- **No cache**: Rejected because it would repeat remote calls and slow common flows.
- **Memory-only cache**: Rejected because it disappears on restart and does not help project context reloads.

**Implementation Approach**:

- Add `src/cache/youtubeCache.ts`.
- Use a key of `videoId + language + provider + formatting version`.
- Store normalized transcript data plus formatted output.
- Expose TTL and maximum-entry settings.

---

## 8. No-Captions Fallback

**Decision**: Plan audio fallback as an optional remote transcription provider, not a bundled local binary pipeline.

**Rationale**: The plugin environment cannot realistically bundle `yt-dlp`, `ffmpeg`, or a local Whisper runtime. The repo already uses provider-based APIs for OCR and document conversion, so the realistic extension point is a remote speech-to-text provider gated by settings.

**Alternatives Considered**:

- **Bundle `yt-dlp` + Whisper**: Rejected because Obsidian plugins cannot rely on subprocess binaries and the bundle/runtime cost is too high.
- **Skip fallback completely**: Rejected because FR-002 explicitly requires a no-captions path.
- **Treat Brevilabs/Supadata caption failures as hard failures**: Rejected because the feature spec expects an automatic or at least configurable fallback path.

**Implementation Approach**:

- Define an `AudioTranscriptionProvider` contract now.
- Add settings for an optional audio transcription provider and progress messaging.
- Implement the first provider only if an existing remote backend is available during implementation; otherwise ship the abstraction and clear user-facing configuration/error flow.

---

## 9. Documentation and UX Scope

**Decision**: Treat YouTube processing as a user-facing feature that requires settings and docs updates alongside code.

**Rationale**: This feature changes chat behavior, mention behavior, tool behavior, and adds transcript output settings. The constitution requires non-technical docs to stay in sync.

**Alternatives Considered**:

- **Document only the command modal**: Rejected because the feature also affects mentions, agent tools, and self-host/provider configuration.

**Implementation Approach**:

- Update `docs/context-and-mentions.md` for pasted and mentioned YouTube URLs.
- Update `docs/agent-mode-and-tools.md` if a tool contract changes.
- Update `docs/copilot-plus-and-self-host.md` or `docs/chat-interface.md` if settings or provider behavior is exposed there.
