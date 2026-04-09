import {
  buildPlainTextTranscript,
  estimateTranscriptTokens,
  formatTranscriptMarkdown,
  formatYouTubeTimestamp,
  parseFormattedTimestamp,
  parseYouTubeChapters,
} from "@/services/youtubeTranscriptFormatter";
import type { TranscriptSegment } from "@/services/youtubeContextTypes";

const segments: TranscriptSegment[] = [
  { text: "Intro starts here.", startTimeSeconds: 0 },
  { text: "We explain the setup.", startTimeSeconds: 4 },
  { text: "Now we move into the main topic", startTimeSeconds: 62 },
  { text: "and add more detail.", startTimeSeconds: 65 },
];

describe("youtubeTranscriptFormatter", () => {
  it("formats timestamps and parses them back", () => {
    expect(formatYouTubeTimestamp(65)).toBe("01:05");
    expect(formatYouTubeTimestamp(3723)).toBe("01:02:03");
    expect(parseFormattedTimestamp("01:05")).toBe(65);
    expect(parseFormattedTimestamp("01:02:03")).toBe(3723);
  });

  it("parses chapters from a YouTube description", () => {
    expect(parseYouTubeChapters("00:00 Intro\n01:02 Main Topic\n05:10 Summary")).toEqual([
      { title: "Intro", startTimeSeconds: 0, endTimeSeconds: 62 },
      { title: "Main Topic", startTimeSeconds: 62, endTimeSeconds: 310 },
      { title: "Summary", startTimeSeconds: 310, endTimeSeconds: undefined },
    ]);
  });

  it("builds plain text and estimates tokens", () => {
    const plainText = buildPlainTextTranscript(segments);
    expect(plainText).toContain("Intro starts here.");
    expect(estimateTranscriptTokens(plainText)).toBeGreaterThan(0);
  });

  it("formats transcript markdown with chapters and timestamps", () => {
    const formatted = formatTranscriptMarkdown(
      { segments },
      parseYouTubeChapters("00:00 Intro\n01:02 Main Topic"),
      { includeTimestamps: true, includeChapters: true }
    );

    expect(formatted).toContain("## Intro [00:00]");
    expect(formatted).toContain("[00:00] Intro starts here.");
    expect(formatted).toContain("## Main Topic [01:02]");
    expect(formatted).toContain("[01:02] Now we move into the main topic");
  });
});
