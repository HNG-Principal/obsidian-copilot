import {
  formatCanonicalYouTubeUrl,
  parseYouTubeStartTime,
  parseYouTubeUrl,
} from "@/services/youtubeUrlParser";

describe("youtubeUrlParser", () => {
  it("parses standard watch URLs", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      originalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
      startTimeSeconds: undefined,
      sourceKind: "watch",
    });
  });

  it("normalizes youtu.be URLs with timestamps", () => {
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=1m30s")).toEqual({
      originalUrl: "https://youtu.be/dQw4w9WgXcQ?t=1m30s",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90",
      videoId: "dQw4w9WgXcQ",
      startTimeSeconds: 90,
      sourceKind: "shortlink",
    });
  });

  it("supports shorts and embed URLs", () => {
    expect(parseYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({
      videoId: "dQw4w9WgXcQ",
      sourceKind: "short",
    });
    expect(parseYouTubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toMatchObject({
      videoId: "dQw4w9WgXcQ",
      sourceKind: "embed",
    });
  });

  it("rejects invalid or non-YouTube URLs", () => {
    expect(parseYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeUndefined();
    expect(parseYouTubeUrl("not a url")).toBeUndefined();
  });

  it("parses start times and formats canonical URLs", () => {
    expect(parseYouTubeStartTime("75")).toBe(75);
    expect(parseYouTubeStartTime("1h2m3s")).toBe(3723);
    expect(formatCanonicalYouTubeUrl("dQw4w9WgXcQ", 75)).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75"
    );
  });
});
