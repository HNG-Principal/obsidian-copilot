import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { selfHostYoutube4llm } from "@/LLMProviders/selfHostServices";
import { isSelfHostModeValid } from "@/plusUtils";
import {
  createTranscriptFromPlainText,
  fetchYouTubeMetadata,
} from "@/services/youtubeTranscriptProvider";
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionProviderId,
  IAudioTranscriptionProvider,
  ProviderTranscriptResult,
} from "@/services/youtubeContextTypes";
import { getSettings } from "@/settings/model";

/**
 * Audio fallback provider that relies on the configured remote transcript endpoint.
 */
class RemoteAudioTranscriptionProvider implements IAudioTranscriptionProvider {
  readonly id: AudioTranscriptionProviderId;

  constructor(
    id: AudioTranscriptionProviderId,
    private readonly fetchTranscript: (url: string) => Promise<string>
  ) {
    this.id = id;
  }

  /**
   * Check whether this provider is currently configured and usable.
   *
   * @param _request - Audio transcription request.
   * @returns True when the backing provider is enabled.
   */
  async canHandle(_request: AudioTranscriptionRequest): Promise<boolean> {
    if (this.id === "supadata") {
      return Boolean(isSelfHostModeValid() && getSettings().supadataApiKey);
    }

    if (this.id === "brevilabs") {
      return true;
    }

    return false;
  }

  /**
   * Perform remote fallback transcription for a YouTube URL.
   *
   * @param request - Audio transcription request.
   * @returns Normalized transcript payload.
   */
  async transcribeVideo(request: AudioTranscriptionRequest): Promise<ProviderTranscriptResult> {
    const transcriptText = await this.fetchTranscript(request.parsedUrl.canonicalUrl);
    const video = await fetchYouTubeMetadata(request.parsedUrl);
    const transcript = createTranscriptFromPlainText(
      request.parsedUrl.videoId,
      transcriptText,
      this.id,
      request.preferredLanguage || "unknown",
      "audio"
    );
    return { video, transcript };
  }
}

/**
 * Resolve the configured audio transcription fallback provider.
 *
 * @returns Remote provider instance, or undefined when fallback is disabled.
 */
export function resolveAudioTranscriptionProvider(): IAudioTranscriptionProvider | undefined {
  const providerId = getSettings().audioTranscriptionProvider;
  if (providerId === "supadata") {
    return new RemoteAudioTranscriptionProvider("supadata", async (url) => {
      const response = await selfHostYoutube4llm(url);
      return response.response.transcript;
    });
  }

  if (providerId === "brevilabs") {
    return new RemoteAudioTranscriptionProvider("brevilabs", async (url) => {
      const response = await BrevilabsClient.getInstance().youtube4llm(url);
      return response.response.transcript;
    });
  }

  return undefined;
}
