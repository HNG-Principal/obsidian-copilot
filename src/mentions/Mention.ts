import { ImageProcessor } from "@/imageProcessing/imageProcessor";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { selfHostYoutube4llm } from "@/LLMProviders/selfHostServices";
import { buildWebContentContextBlock } from "@/contextProcessor";
import { err2String, isTwitterUrl, isYoutubeUrl } from "@/utils";
import { logError } from "@/logger";
import { isSelfHostModeValid } from "@/plusUtils";
import { SocialMediaExtractor } from "@/services/socialMediaExtractor";
import { WebExtractor } from "@/services/webExtractor";
import type { ParsedURL } from "@/services/webContextTypes";
import { getSettings } from "@/settings/model";

export interface MentionData {
  type: string;
  original: string;
  processed?: string;
  error?: string;
  parsedUrl?: ParsedURL;
}

export class Mention {
  private static instance: Mention;
  private mentions: Map<string, MentionData>;
  private brevilabsClient: BrevilabsClient;
  private webExtractor: WebExtractor;
  private socialMediaExtractor: SocialMediaExtractor;

  private constructor() {
    this.mentions = new Map();
    this.brevilabsClient = BrevilabsClient.getInstance();
    this.webExtractor = WebExtractor.getInstance();
    this.socialMediaExtractor = SocialMediaExtractor.getInstance();
  }

  static getInstance(): Mention {
    if (!Mention.instance) {
      Mention.instance = new Mention();
    }
    return Mention.instance;
  }

  extractAllUrls(text: string): string[] {
    // Match URLs and trim any trailing commas
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    return (text.match(urlRegex) || [])
      .map((url) => url.replace(/,+$/, "")) // Remove trailing commas
      .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates
  }

  extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    return (text.match(urlRegex) || [])
      .map((url) => url.replace(/,+$/, ""))
      .filter((url, index, self) => self.indexOf(url) === index);
  }

  async processUrl(url: string): Promise<ParsedURL> {
    try {
      return await this.webExtractor.extractUrlContent(url);
    } catch (error) {
      const msg = err2String(error);
      logError(`Error processing URL ${url}: ${msg}`);
      return {
        url,
        content: "",
        status: "failed",
        error: { code: "network_error", message: msg },
        extractedAt: Date.now(),
        byteLength: 0,
      };
    }
  }

  async processYoutubeUrl(url: string): Promise<{ transcript: string; error?: string }> {
    try {
      const response =
        isSelfHostModeValid() && getSettings().supadataApiKey
          ? await selfHostYoutube4llm(url)
          : await this.brevilabsClient.youtube4llm(url);
      return { transcript: response.response.transcript };
    } catch (error) {
      const msg = err2String(error);
      logError(`Error processing YouTube URL ${url}: ${msg}`);
      return { transcript: "", error: msg };
    }
  }

  async processTwitterUrl(url: string): Promise<ParsedURL> {
    try {
      const parsed = await this.socialMediaExtractor.extractSocialPost(url);
      if (!parsed) {
        return await this.webExtractor.extractUrlContent(url);
      }

      return parsed;
    } catch (error) {
      const msg = err2String(error);
      logError(`Error processing Twitter URL ${url}: ${msg}`);
      return {
        url,
        content: "",
        status: "failed",
        error: { code: "network_error", message: msg },
        extractedAt: Date.now(),
        byteLength: 0,
      };
    }
  }

  /**
   * Process a list of URLs directly (both regular and YouTube URLs).
   *
   * @param urls Array of URLs to process
   * @returns Processed URL context and any errors
   */
  async processUrlList(urls: string[]): Promise<{
    urlContext: string;
    imageUrls: string[];
    processedErrorUrls: Record<string, string>;
  }> {
    let urlContext = "";
    const imageUrls: string[] = [];
    const processedErrorUrls: Record<string, string> = {};

    // Return empty string if no URLs to process
    if (urls.length === 0) {
      return { urlContext, imageUrls, processedErrorUrls };
    }

    // Process all URLs concurrently
    const processPromises = urls.map(async (url) => {
      // Check if it's an image URL
      if (await ImageProcessor.isImageUrl(url, app.vault)) {
        imageUrls.push(url);
        return { type: "image", url };
      }

      // Check if it's a YouTube URL
      if (isYoutubeUrl(url)) {
        const cached = this.mentions.get(url);
        // Retry if not cached or if the previous attempt failed
        if (!cached || cached.error) {
          const processed = await this.processYoutubeUrl(url);
          this.mentions.set(url, {
            type: "youtube",
            original: url,
            processed: processed.transcript,
            error: processed.error,
          });
        }
        return { type: "youtube", data: this.mentions.get(url) };
      }

      // Check if it's a Twitter/X URL
      if (isTwitterUrl(url)) {
        const cached = this.mentions.get(url);
        if (!cached || cached.error) {
          const processed = await this.processTwitterUrl(url);
          this.mentions.set(url, {
            type: "twitter",
            original: url,
            processed: [
              processed.author ? `Author: ${processed.author}` : null,
              processed.publicationDate ? `Date: ${processed.publicationDate}` : null,
              processed.content,
            ]
              .filter(Boolean)
              .join("\n"),
            error: processed.error?.message,
            parsedUrl: processed,
          });
        }
        return { type: "twitter", data: this.mentions.get(url) };
      }

      // Regular URL
      const cachedUrl = this.mentions.get(url);
      if (!cachedUrl || cachedUrl.error) {
        const processed = await this.processUrl(url);
        this.mentions.set(url, {
          type: "url",
          original: url,
          processed: buildWebContentContextBlock(processed),
          error: processed.error?.message,
          parsedUrl: processed,
        });
      }
      return { type: "url", data: this.mentions.get(url) };
    });

    const processedUrls = await Promise.all(processPromises);

    // Append all processed content
    processedUrls.forEach((result) => {
      if (result.type === "image") {
        // Already added to imageUrls
        return;
      }

      const urlData = result.data;
      if (!urlData) return;

      if (urlData.processed) {
        if (result.type === "youtube") {
          urlContext += `\n\n<youtube_video_context>\n<url>${urlData.original}</url>\n<content>\n${urlData.processed}\n</content>\n</youtube_video_context>`;
        } else if (result.type === "twitter") {
          urlContext += `\n\n<twitter_content>\n<url>${urlData.original}</url>\n<content>\n${urlData.processed}\n</content>\n</twitter_content>`;
        } else {
          urlContext += urlData.processed;
        }
      }

      if (urlData.error) {
        processedErrorUrls[urlData.original] = urlData.error;
      } else if (urlData.parsedUrl?.status === "partial" && urlData.parsedUrl.error) {
        processedErrorUrls[urlData.original] = urlData.parsedUrl.error.message;
      }
    });

    return { urlContext, imageUrls, processedErrorUrls };
  }

  /**
   * Process URLs from user input text (both regular and YouTube URLs).
   *
   * IMPORTANT: This method should ONLY be called with the user's direct chat input,
   * NOT with content from context notes.
   *
   * @param text The user's chat input text
   * @returns Processed URL context and any errors
   */
  async processUrls(text: string): Promise<{
    urlContext: string;
    imageUrls: string[];
    processedErrorUrls: Record<string, string>;
  }> {
    const urls = this.extractUrls(text);
    return this.processUrlList(urls);
  }

  getMentions(): Map<string, MentionData> {
    return this.mentions;
  }

  clearMentions(): void {
    this.mentions.clear();
  }
}
