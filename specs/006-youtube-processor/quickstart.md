# Quickstart: YouTube Processor

**Feature**: `006-youtube-processor` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: Types and Video ID Parser

Define types in `youtubeExtractor.ts` (or a separate types file):

- `YouTubeVideo`, `VideoChapter`, `VideoTranscript`, `TranscriptSegment`, `YouTubeCacheEntry`
- `parseVideoId(url)`: extract video ID from all YouTube URL formats
- Unit tests for URL parsing (standard, short, shorts, embed, with params)

### Step 2: Transcript Processor (Pure Logic)

Create `src/services/transcriptProcessor.ts`:

- `mergeSegmentsToSentences(segments)`: combine short segments into sentences
- `parseChapters(description)`: regex-based chapter extraction from description
- `formatTranscript(segments, chapters, options)`: full formatting pipeline
  - Group into paragraphs (pause detection)
  - Insert chapter headings
  - Add timestamp markers at paragraph breaks
  - Return clean markdown
- Unit tests with sample transcript data

### Step 3: YouTube Cache

Create `src/cache/youtubeCache.ts`:

- Follow `pdfCache.ts` pattern
- Key: `{videoId}_{language}`
- Storage: `.copilot/youtube-cache/`
- TTL: 7 days by default
- `get()`, `set()`, `cleanup()` methods

### Step 4: YouTube Extractor

Create `src/services/youtubeExtractor.ts`:

- `extractTranscript(url, options): Promise<{video, transcript}>`
- Primary: use `youtube-transcript` library for public caption fetching
- Fallback: Supadata API when `supadataApiKey` configured
- Fetch available languages, select based on user preference
- Parse video metadata (title, channel) from page data
- Cache successful extractions

### Step 5: Wire YouTube Tools

Modify `src/tools/YoutubeTools.ts`:

- Delegate `youtubeTranscriptionTool` to `youtubeExtractor.extractTranscript()`
- Replace Brevilabs `youtube4llm()` calls
- Format tool result for LLM consumption

### Step 6: Wire Mention Processing

Modify `src/mentions/Mention.ts`:

- Route `processYoutubeUrl()` through `youtubeExtractor.extractTranscript()`
- Handle extraction errors gracefully (show inline error)

### Step 7: Context Integration and Settings

Modify `src/contextProcessor.ts`:

- Wrap transcripts in `<youtube-transcript>` XML tags with metadata attributes

Modify `src/settings/model.ts`:

- Add `preferredTranscriptLanguage`, `youtubeTranscriptTimestamps`

---

## Prerequisites

- Install `youtube-transcript` (or equivalent) as dependency
- Verify library bundles with esbuild
- Existing `YoutubeTools.ts` and `Mention.ts` functional

---

## Verification Checklist

- [ ] Standard YouTube URL extracts transcript
- [ ] Short URL (youtu.be) extracts transcript
- [ ] Auto-generated captions extracted and formatted
- [ ] Manual captions preferred over auto-generated
- [ ] Chapter detection from video description works
- [ ] Chapters appear as headings in formatted transcript
- [ ] Timestamps appear at paragraph breaks
- [ ] Language preference selects correct transcript
- [ ] Fallback to available language when preferred not available
- [ ] Cache prevents redundant fetches
- [ ] Expired cache triggers fresh fetch
- [ ] Video without captions returns clear error
- [ ] @mention YouTube URL shows transcript in context
- [ ] YouTube tool in agent mode returns transcript
- [ ] All pure functions have passing unit tests

---

## Key Files Reference

| File                                  | Purpose                             |
| ------------------------------------- | ----------------------------------- |
| `src/services/youtubeExtractor.ts`    | Transcript fetching (new)           |
| `src/services/transcriptProcessor.ts` | Transcript formatting (new)         |
| `src/cache/youtubeCache.ts`           | Transcript caching (new)            |
| `src/tools/YoutubeTools.ts`           | YouTube tool integration (modified) |
| `src/mentions/Mention.ts`             | @mention URL processing (modified)  |
| `src/contextProcessor.ts`             | Context XML wrapping (modified)     |
| `src/settings/model.ts`               | YouTube settings (modified)         |
