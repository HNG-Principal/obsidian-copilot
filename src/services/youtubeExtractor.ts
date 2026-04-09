import { YouTubeCache } from "@/cache/youtubeCache";
import { resolveAudioTranscriptionProvider } from "@/services/audioTranscriptionProvider";
import type {
  ProviderTranscriptResult,
  TranscriptFormattingOptions,
  VideoTranscript,
  YouTubeExtractionOptions,
  YouTubeExtractionResult,
} from "@/services/youtubeContextTypes";
import { parseYouTubeUrl } from "@/services/youtubeUrlParser";
import {
  buildPlainTextTranscript,
  estimateTranscriptTokens,
  formatTranscriptMarkdown,
  parseYouTubeChapters,
} from "@/services/youtubeTranscriptFormatter";
import { YouTubeTranscriptProvider } from "@/services/youtubeTranscriptProvider";
import { getSettings } from "@/settings/model";

/**
 * Shared orchestration entry point for all YouTube transcript flows.
 */
export class YouTubeExtractor {
  private static instance: YouTubeExtractor;

  constructor(
    private readonly cache = YouTubeCache.getInstance(),
    private readonly transcriptProvider = new YouTubeTranscriptProvider()
  ) {}

  /**
   * Return the shared YouTube extractor.
   */
  static getInstance(): YouTubeExtractor {
    if (!YouTubeExtractor.instance) {
      YouTubeExtractor.instance = new YouTubeExtractor();
    }
    return YouTubeExtractor.instance;
  }

  /**
   * Extract, normalize, and optionally cache transcript content for a YouTube URL.
   *
   * @param url - User-supplied YouTube URL.
   * @param options - Optional extraction overrides.
   * @returns Normalized extraction result.
   */
  async extractTranscript(
    url: string,
    options: YouTubeExtractionOptions = {}
  ): Promise<YouTubeExtractionResult> {
    const parsedUrl = parseYouTubeUrl(url);
    if (!parsedUrl) {
      throw new Error("Invalid YouTube URL");
    }

    const mergedOptions = this.resolveOptions(options);
    const cacheKey = this.cache.getLookupKey(parsedUrl.videoId, mergedOptions.preferredLanguage);

    if (!mergedOptions.bypassCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        const hydrated = this.applyFormatting(cached.video, cached.transcript, mergedOptions);
        return {
          parsedUrl,
          video: hydrated.video,
          transcript: hydrated.transcript,
          cacheStatus: "hit",
        };
      }
    }

    let result: ProviderTranscriptResult;
    try {
      result = await this.transcriptProvider.fetchTranscript({
        parsedUrl,
        preferredLanguage: mergedOptions.preferredLanguage,
      });
    } catch (error) {
      if (!mergedOptions.allowAudioFallback) {
        throw error;
      }

      const fallbackProvider = resolveAudioTranscriptionProvider();
      if (!fallbackProvider || !(await fallbackProvider.canHandle({ parsedUrl }))) {
        throw error;
      }

      result = await fallbackProvider.transcribeVideo({
        parsedUrl,
        preferredLanguage: mergedOptions.preferredLanguage,
      });
    }

    const hydrated = this.applyFormatting(result.video, result.transcript, mergedOptions);
    await this.cache.set({
      cacheKey,
      video: hydrated.video,
      transcript: hydrated.transcript,
    });

    return {
      parsedUrl,
      video: hydrated.video,
      transcript: hydrated.transcript,
      cacheStatus: mergedOptions.bypassCache ? "refresh" : "miss",
    };
  }

  private applyFormatting(
    video: ProviderTranscriptResult["video"],
    transcript: VideoTranscript,
    options: Required<YouTubeExtractionOptions>
  ): { video: ProviderTranscriptResult["video"]; transcript: VideoTranscript } {
    const chapters = parseYouTubeChapters(video.description);
    const formattedOptions: TranscriptFormattingOptions = {
      includeTimestamps: options.includeTimestamps,
      includeChapters: options.includeChapters,
    };
    const plainText = buildPlainTextTranscript(transcript.segments);
    const formattedMarkdown = formatTranscriptMarkdown(
      { segments: transcript.segments },
      chapters,
      formattedOptions
    );
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;

    return {
      video: {
        ...video,
        chapters,
      },
      transcript: {
        ...transcript,
        plainText,
        formattedMarkdown,
        wordCount,
        tokenEstimate: estimateTranscriptTokens(plainText),
      },
    };
  }

  private resolveOptions(options: YouTubeExtractionOptions): Required<YouTubeExtractionOptions> {
    const settings = getSettings();
    return {
      preferredLanguage: options.preferredLanguage || settings.preferredTranscriptLanguage,
      bypassCache: options.bypassCache === true,
      includeTimestamps: options.includeTimestamps ?? settings.youtubeTranscriptTimestamps,
      includeChapters: options.includeChapters ?? true,
      allowAudioFallback:
        options.allowAudioFallback ?? settings.audioTranscriptionProvider !== "disabled",
    };
  }
}
