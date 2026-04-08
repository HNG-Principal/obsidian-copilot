# Interface Contracts: YouTube Processor

**Feature**: `006-youtube-processor` | **Date**: 2026-04-08

---

## Core Interfaces

### IYouTubeExtractor

```typescript
interface IYouTubeExtractor {
  /**
   * Fetch and process a YouTube video's transcript.
   * @param url - YouTube video URL
   * @param options - Extraction options
   * @returns Video metadata + formatted transcript
   */
  extractTranscript(
    url: string,
    options?: YouTubeExtractionOptions
  ): Promise<{
    video: YouTubeVideo;
    transcript: VideoTranscript;
  }>;
}

interface YouTubeExtractionOptions {
  /** Preferred language code (ISO 639-1) */
  preferredLanguage?: string;
  /** Skip cache */
  bypassCache?: boolean;
  /** Include timestamps in formatted output */
  includeTimestamps?: boolean;
}
```

### ITranscriptProcessor

```typescript
interface ITranscriptProcessor {
  /**
   * Format raw transcript segments into readable markdown.
   * Pure function: no side effects.
   */
  formatTranscript(
    segments: TranscriptSegment[],
    chapters?: VideoChapter[],
    options?: FormatOptions
  ): string;

  /**
   * Parse chapter information from video description.
   * Pure function: description string → chapters.
   */
  parseChapters(description: string): VideoChapter[];
}

interface FormatOptions {
  /** Include [MM:SS] timestamps at paragraph breaks */
  includeTimestamps: boolean;
  /** Insert chapter headings */
  includeChapters: boolean;
}
```

### IYouTubeCache

```typescript
interface IYouTubeCache {
  /**
   * Get cached transcript. Returns undefined if not cached or expired.
   */
  get(videoId: string, language: string): Promise<YouTubeCacheEntry | undefined>;

  /**
   * Store transcript in cache.
   */
  set(entry: YouTubeCacheEntry): Promise<void>;

  /**
   * Remove expired entries.
   */
  cleanup(): Promise<void>;
}
```

---

## Pure Function Type Contracts

### Parse Video ID

```typescript
/**
 * Extract YouTube video ID from various URL formats.
 * Handles: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, etc.
 * Returns undefined if not a valid YouTube URL.
 */
type ParseVideoId = (url: string) => string | undefined;
```

### Merge Segments to Sentences

```typescript
/**
 * Merge consecutive short transcript segments into complete sentences.
 * Uses punctuation and pause detection to determine sentence boundaries.
 */
type MergeSegmentsToSentences = (
  segments: TranscriptSegment[]
) => Array<{ text: string; startTime: number; endTime: number }>;
```

### Format Timestamp

```typescript
/**
 * Format seconds into [MM:SS] or [HH:MM:SS] display string.
 */
type FormatTimestamp = (seconds: number) => string;
```

---

## Settings Contract

New settings in `CopilotSettings`:

| Setting                       | Type      | Default | Range | Description                                |
| ----------------------------- | --------- | ------- | ----- | ------------------------------------------ |
| `preferredTranscriptLanguage` | `string`  | `'en'`  | —     | Preferred language for YouTube transcripts |
| `youtubeTranscriptTimestamps` | `boolean` | `true`  | —     | Include timestamps in transcripts          |

Existing settings reused:

- `supadataApiKey` — for Supadata premium transcript backend

---

## Context Integration Contract

```xml
<!-- YouTube transcript injected into context -->
<youtube-transcript videoId="dQw4w9WgXcQ" title="Video Title" language="en" auto-generated="true">
  ## Chapter: Introduction [00:00]

  Welcome to this video about...

  [02:15] The main topic we'll discuss today is...

  ## Chapter: Deep Dive [05:30]

  Let's explore this in detail...
</youtube-transcript>
```

---

## Event Hooks

| Hook                  | Trigger                               | Handler                                                                           |
| --------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| YouTube URL mentioned | User @-mentions or pastes YouTube URL | `Mention.processYoutubeUrl()` → `IYouTubeExtractor.extractTranscript()`           |
| YouTube tool called   | Agent uses transcript tool            | `YoutubeTools.youtubeTranscriptionTool` → `IYouTubeExtractor.extractTranscript()` |
| Transcript cached     | Successful extraction                 | `IYouTubeCache.set()`                                                             |
| Context injection     | Message with YouTube context          | `ContextProcessor` wraps in `<youtube-transcript>` tags                           |
