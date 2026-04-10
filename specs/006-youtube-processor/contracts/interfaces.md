# Interface Contracts: YouTube Processor

**Feature**: `006-youtube-processor` | **Date**: 2026-04-08

---

## Core Interfaces

### IYouTubeExtractor

```typescript
interface IYouTubeExtractor {
  /**
   * Resolve a YouTube URL into normalized metadata and transcript content.
   */
  extractTranscript(
    url: string,
    options?: YouTubeExtractionOptions
  ): Promise<YouTubeExtractionResult>;
}

interface YouTubeExtractionOptions {
  preferredLanguage?: string;
  bypassCache?: boolean;
  includeTimestamps?: boolean;
  includeChapters?: boolean;
  allowAudioFallback?: boolean;
}

interface YouTubeExtractionResult {
  parsedUrl: ParsedYouTubeUrl;
  video: YouTubeVideo;
  transcript: VideoTranscript;
  cacheStatus: "hit" | "miss" | "refresh";
}
```

### IYouTubeTranscriptProvider

```typescript
interface IYouTubeTranscriptProvider {
  readonly id: string;

  /**
   * Returns true when this provider can attempt extraction in the current environment.
   */
  canHandle(request: YouTubeProviderRequest): Promise<boolean>;

  /**
   * Fetch captions and metadata for a YouTube video.
   */
  fetchTranscript(request: YouTubeProviderRequest): Promise<ProviderTranscriptResult>;
}

interface YouTubeProviderRequest {
  parsedUrl: ParsedYouTubeUrl;
  preferredLanguage?: string;
}

interface ProviderTranscriptResult {
  video: YouTubeVideo;
  transcript: VideoTranscript;
}
```

### IAudioTranscriptionProvider

```typescript
interface IAudioTranscriptionProvider {
  readonly id: string;

  /**
   * Attempt transcription when no usable captions are available.
   */
  transcribeVideo(request: AudioTranscriptionRequest): Promise<ProviderTranscriptResult>;
}

interface AudioTranscriptionRequest {
  parsedUrl: ParsedYouTubeUrl;
  preferredLanguage?: string;
}
```

### IYouTubeTranscriptFormatter

```typescript
interface IYouTubeTranscriptFormatter {
  formatTranscript(
    transcript: VideoTranscript,
    chapters: VideoChapter[],
    options: TranscriptFormattingOptions
  ): string;

  parseChapters(description?: string): VideoChapter[];
}

interface TranscriptFormattingOptions {
  includeTimestamps: boolean;
  includeChapters: boolean;
}
```

### IYouTubeCache

```typescript
interface IYouTubeCache {
  get(cacheKey: string): Promise<YouTubeTranscriptCacheEntry | undefined>;
  set(entry: YouTubeTranscriptCacheEntry): Promise<void>;
  cleanup(): Promise<void>;
}
```

### IYouTubeTranscriptNoteWriter

```typescript
interface IYouTubeTranscriptNoteWriter {
  save(
    video: YouTubeVideo,
    transcript: VideoTranscript,
    options: SaveTranscriptOptions
  ): Promise<SavedTranscriptNote>;
}

interface SaveTranscriptOptions {
  outputFolder: string;
  includeSummary?: string;
  overwriteExisting?: boolean;
}
```

---

## Pure Function Contracts

### Parse YouTube URL

```typescript
type ParseYouTubeUrl = (url: string) => ParsedYouTubeUrl | undefined;
```

### Format Timestamp

```typescript
type FormatTimestamp = (seconds: number) => string;
```

### Merge Transcript Segments

```typescript
type MergeTranscriptSegments = (
  segments: TranscriptSegment[]
) => Array<{ text: string; startTimeSeconds: number; endTimeSeconds: number | undefined }>;
```

---

## Settings Contract

New settings expected in `CopilotSettings`:

| Setting                          | Type                   | Default                 | Description                                          |
| -------------------------------- | ---------------------- | ----------------------- | ---------------------------------------------------- |
| `preferredTranscriptLanguage`    | `string`               | `"en"`                  | Preferred language code for transcript extraction    |
| `youtubeTranscriptTimestamps`    | `boolean`              | `true`                  | Include timestamps in transcript output              |
| `youtubeTranscriptOutputFolder`  | `string`               | `"YouTube Transcripts"` | Folder used when saving transcript notes             |
| `youtubeTranscriptCacheTTLHours` | `number`               | `168`                   | Cache TTL for YouTube transcript entries             |
| `audioTranscriptionProvider`     | `"disabled" \| string` | `"disabled"`            | Optional provider used when captions are unavailable |

Existing settings reused:

- `supadataApiKey`
- `enableSelfHostMode`
- `plusLicenseKey`

---

## Context Integration Contract

Feature 006 should preserve the existing top-level tag:

```xml
<youtube_video_context>
  <title>Video Title</title>
  <url>https://www.youtube.com/watch?v=dQw4w9WgXcQ</url>
  <video_id>dQw4w9WgXcQ</video_id>
  <channel>Channel Name</channel>
  <upload_date>2026-04-01</upload_date>
  <duration>01:12:30</duration>
  <content>
  ## Introduction [00:00]

  [00:42] Opening paragraph...
  </content>
</youtube_video_context>
```

Rules:

1. Inner values must be XML-escaped before insertion.
2. Transcript markdown belongs inside `<content>`.
3. Errors must be represented as `<error>...</error>` and omitted when the extraction succeeds.
4. Existing context compactor and registry logic must continue to recognize the block as recoverable YouTube context.

---

## Event Hooks

| Hook                            | Trigger                                     | Handler                                                                  |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| YouTube URL pasted or mentioned | Chat input and mention processing           | `Mention.processYoutubeUrl()` -> `IYouTubeExtractor.extractTranscript()` |
| YouTube tool invoked            | Agent tool execution                        | `youtubeTranscriptionTool` -> `IYouTubeExtractor.extractTranscript()`    |
| Project context load            | Project YouTube URLs configured in settings | `ProjectManager.processYoutubeUrlContext()` -> extractor service         |
| Transcript saved to cache       | Successful extraction                       | `IYouTubeCache.set()`                                                    |
| Transcript saved to vault       | Explicit user action or command             | `IYouTubeTranscriptNoteWriter.save()`                                    |
