import type {
  TranscriptFormattingOptions,
  TranscriptSegment,
  VideoChapter,
  VideoTranscript,
} from "@/services/youtubeContextTypes";

interface ParagraphSegment {
  text: string;
  startTimeSeconds: number;
}

const CHAPTER_PATTERN = /^(?:(\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/;

/**
 * Format seconds into a human-readable YouTube transcript timestamp.
 *
 * @param totalSeconds - Timestamp offset in seconds.
 * @returns Formatted timestamp string.
 */
export function formatYouTubeTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Parse a formatted timestamp such as "01:23" or "01:02:03" into seconds.
 *
 * @param value - Timestamp string.
 * @returns Timestamp in seconds, or undefined when the value is invalid.
 */
export function parseFormattedTimestamp(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return undefined;
}

/**
 * Parse chapter lines from a YouTube description.
 *
 * @param description - Raw description text.
 * @returns Parsed chapter list ordered by timestamp.
 */
export function parseYouTubeChapters(description?: string): VideoChapter[] {
  if (!description?.trim()) {
    return [];
  }

  const candidates = description
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(CHAPTER_PATTERN))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      timestamp: match[1]
        ? `${match[1]}${match[0].slice(match[1].length).split(/\s+/, 1)[0]}`
        : match[0].split(/\s+/, 1)[0],
      title: match[2].trim(),
    }))
    .map(({ timestamp, title }) => ({
      title,
      startTimeSeconds: parseFormattedTimestamp(timestamp) ?? -1,
    }))
    .filter((chapter) => chapter.startTimeSeconds >= 0)
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);

  return candidates.map((chapter, index) => ({
    ...chapter,
    endTimeSeconds: candidates[index + 1]?.startTimeSeconds,
  }));
}

/**
 * Build a plain-text transcript view from normalized segments.
 *
 * @param segments - Transcript segments in ascending order.
 * @returns Flattened transcript text.
 */
export function buildPlainTextTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Estimate token count from word count using a conservative heuristic.
 *
 * @param transcriptText - Plain transcript text.
 * @returns Approximate token count.
 */
export function estimateTranscriptTokens(transcriptText: string): number {
  const wordCount = transcriptText.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.35);
}

/**
 * Format a transcript into timestamped markdown paragraphs.
 *
 * @param transcript - Transcript payload to format.
 * @param chapters - Parsed chapter boundaries.
 * @param options - Formatting options.
 * @returns Readable markdown transcript.
 */
export function formatTranscriptMarkdown(
  transcript: Pick<VideoTranscript, "segments">,
  chapters: VideoChapter[],
  options: TranscriptFormattingOptions
): string {
  const paragraphs = mergeSegmentsIntoParagraphs(transcript.segments);
  if (paragraphs.length === 0) {
    return "";
  }

  const output: string[] = [];
  let chapterIndex = 0;

  for (const paragraph of paragraphs) {
    while (
      options.includeChapters &&
      chapterIndex < chapters.length &&
      chapters[chapterIndex].startTimeSeconds <= paragraph.startTimeSeconds
    ) {
      const chapter = chapters[chapterIndex];
      output.push(`## ${chapter.title} [${formatYouTubeTimestamp(chapter.startTimeSeconds)}]`);
      output.push("");
      chapterIndex += 1;
    }

    const prefix = options.includeTimestamps
      ? `[${formatYouTubeTimestamp(paragraph.startTimeSeconds)}] `
      : "";
    output.push(`${prefix}${paragraph.text}`);
    output.push("");
  }

  return output.join("\n").trim();
}

/**
 * Group transcript segments into readable paragraph blocks.
 *
 * @param segments - Normalized transcript segments.
 * @returns Paragraph-level transcript chunks.
 */
export function mergeSegmentsIntoParagraphs(segments: TranscriptSegment[]): ParagraphSegment[] {
  const normalizedSegments = [...segments]
    .filter((segment) => segment.text.trim())
    .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);

  if (normalizedSegments.length === 0) {
    return [];
  }

  const paragraphs: ParagraphSegment[] = [];
  let currentText: string[] = [];
  let currentStart = normalizedSegments[0].startTimeSeconds;
  let previousSegment: TranscriptSegment | undefined;

  const flush = () => {
    const text = currentText.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      paragraphs.push({ text, startTimeSeconds: currentStart });
    }
    currentText = [];
  };

  for (const segment of normalizedSegments) {
    const trimmedText = segment.text.trim();
    if (!currentText.length) {
      currentStart = segment.startTimeSeconds;
    }

    if (previousSegment) {
      const previousText = previousSegment.text.trim();
      const gapSeconds = segment.startTimeSeconds - previousSegment.startTimeSeconds;
      const shouldBreak =
        gapSeconds >= 4 ||
        previousText.endsWith(".") ||
        previousText.endsWith("?") ||
        previousText.endsWith("!") ||
        currentText.join(" ").split(/\s+/).filter(Boolean).length >= 80;

      if (shouldBreak) {
        flush();
        currentStart = segment.startTimeSeconds;
      }
    }

    currentText.push(trimmedText);
    previousSegment = segment;
  }

  flush();
  return paragraphs;
}
