# Research Decisions: YouTube Processor

**Feature**: `006-youtube-processor` | **Date**: 2026-04-08

---

## 1. Transcript Fetching Strategy

**Decision**: Use a lightweight library (`youtube-transcript` or similar) that fetches publicly available captions without requiring a YouTube Data API v3 key.

**Rationale**: YouTube's caption endpoints are publicly accessible for videos with captions enabled. Using a library that wraps these endpoints avoids the complexity of API key management and quota limits. The existing `selfHostYoutube4llm()` uses Supadata API as a premium option — we keep that as fallback.

**Alternatives Considered**:

- **Keep Brevilabs `youtube4llm()`**: Rejected — violates self-hosted requirement.
- **YouTube Data API v3**: Rejected — requires API key, OAuth for some operations, and quota management. Overkill for caption fetching.
- **Supadata API only**: Rejected — requires paid API key. Should work without any API key for basic transcript fetching.
- **yt-dlp subprocess**: Rejected — requires external binary installation, not bundleable in plugin.

**Implementation Approach**:

- Primary: `youtube-transcript` library for public caption fetching
- Fallback 1: Supadata API when `supadataApiKey` is configured (for higher reliability)
- Fallback 2: Brevilabs (for backwards compatibility during migration)
- Auto-detect available captions (manual vs auto-generated)
- Language preference: user setting with fallback to video's default language

---

## 2. Transcript Chunking Strategy

**Decision**: Timestamp-aligned paragraph chunking that groups consecutive transcript segments into coherent paragraphs, optionally aligned to chapter boundaries.

**Rationale**: Raw transcripts (especially auto-generated) are a stream of short segments (1-5 words each with timestamps). These need to be grouped into readable paragraphs. Chapter boundaries (from video description) provide natural break points.

**Alternatives Considered**:

- **No chunking (raw segments)**: Rejected — results in fragmented, unreadable text.
- **Fixed-time chunks (e.g., every 5 minutes)**: Rejected — may break mid-sentence.
- **Sentence-level chunking only**: Considered — viable but misses chapter structure.

**Implementation Approach**:

- `TranscriptProcessor.formatTranscript(segments, chapters?)`
- Step 1: Merge consecutive segments into sentences (using punctuation and pause detection)
- Step 2: Group sentences into paragraphs (natural breaks at ≥2s pauses)
- Step 3: If chapters available, align paragraph breaks to chapter boundaries
- Output options: full text (for context injection), timestamped text (for reference)
- Include timestamp markers at paragraph boundaries: `[00:05:23]`

---

## 3. Chapter Detection

**Decision**: Parse chapter information from video description using the standard YouTube chapter format (timestamp + title lines).

**Rationale**: YouTube auto-detects chapters from description timestamps in `MM:SS` or `HH:MM:SS` format. Parsing these is straightforward and provides valuable structural information. No API call needed — the description is fetched alongside video metadata.

**Alternatives Considered**:

- **YouTube API chapters endpoint**: Rejected — requires API key. Description parsing is sufficient.
- **ML-based chapter detection from audio**: Overkill for v1.
- **No chapter support**: Rejected — chapters significantly improve transcript readability and are trivial to parse.

**Implementation Approach**:

- Regex pattern: lines matching `(?:(\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)` in description
- Parse timestamps, extract titles
- Map chapters to transcript segments by timestamp ranges
- Insert chapter headings in formatted output: `## Chapter: {title} [HH:MM:SS]`

---

## 4. Language Support

**Decision**: Allow user to specify preferred language for transcripts with automatic fallback to available languages.

**Rationale**: Many YouTube videos have transcripts in multiple languages (manual + auto-generated). Users should be able to specify their preferred language. When the preferred language isn't available, fall back to whatever is available.

**Alternatives Considered**:

- **Always use video's primary language**: Rejected — users may prefer a translation.
- **Auto-detect user's language**: Considered — but explicit preference is more reliable.
- **Language-specific processing**: Rejected — violates Constitution I.

**Implementation Approach**:

- Setting: `preferredTranscriptLanguage` (default: `'en'`)
- Fetch available language list from video
- Priority: user preference → manual in any language → auto-generated in user preference → auto-generated in any language
- Return language code in `VideoTranscript` metadata so user knows what they got

---

## 5. Caching Strategy

**Decision**: Disk-based cache keyed by video ID + language, with long TTL (7 days by default).

**Rationale**: YouTube transcripts rarely change once published. Caching for 7 days prevents redundant fetches for videos referenced multiple times. Video ID is stable and unique.

**Alternatives Considered**:

- **No cache**: Rejected — same video referenced in multiple conversations would re-fetch.
- **Memory-only cache**: Rejected — lost on restart.
- **Infinite cache**: Considered — transcripts almost never change. But some videos do get caption updates, so a long TTL is safer than infinite.

**Implementation Approach**:

- `youtubeCache.ts` following `pdfCache.ts` pattern
- Key: `{videoId}_{language}`
- Storage: `.copilot/youtube-cache/` directory
- TTL: 7 days (configurable)
- Store: raw segments + formatted text + metadata
