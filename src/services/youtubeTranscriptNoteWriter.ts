import { DEFAULT_YOUTUBE_TRANSCRIPT_OUTPUT_FOLDER } from "@/constants";
import { logError, logInfo, logWarn } from "@/logger";
import type {
  SaveTranscriptOptions,
  SavedTranscriptNote,
  VideoTranscript,
  YouTubeVideo,
} from "@/services/youtubeContextTypes";
import { sanitizeFilePath } from "@/utils";

/**
 * Persist processed YouTube transcripts as markdown notes in the vault.
 */
export class YouTubeTranscriptNoteWriter {
  private static instance: YouTubeTranscriptNoteWriter;

  /**
   * Return the shared transcript note writer instance.
   */
  static getInstance(): YouTubeTranscriptNoteWriter {
    if (!YouTubeTranscriptNoteWriter.instance) {
      YouTubeTranscriptNoteWriter.instance = new YouTubeTranscriptNoteWriter();
    }
    return YouTubeTranscriptNoteWriter.instance;
  }

  /**
   * Save a transcript as a markdown note.
   *
   * @param video - Video metadata.
   * @param transcript - Processed transcript payload.
   * @param options - Save options.
   * @returns Saved note metadata.
   */
  async save(
    video: YouTubeVideo,
    transcript: VideoTranscript,
    options: SaveTranscriptOptions
  ): Promise<SavedTranscriptNote> {
    const outputFolder = this.normalizeFolderPath(
      options.outputFolder.trim() || DEFAULT_YOUTUBE_TRANSCRIPT_OUTPUT_FOLDER
    );
    await this.ensureFolderExists(outputFolder);

    const baseName = this.buildBaseName(video.title, video.videoId);
    const preferredPath = sanitizeFilePath(`${outputFolder}/${baseName}.md`);
    const noteContent = this.buildNoteContent(video, transcript, options.includeSummary);
    const targetPath = await this.resolveTargetPath(
      preferredPath,
      noteContent,
      video,
      Boolean(options.overwriteExisting)
    );

    if (await app.vault.adapter.exists(targetPath)) {
      await app.vault.adapter.write(targetPath, noteContent);
    } else {
      await app.vault.create(targetPath, noteContent);
    }

    logInfo(`[YouTubeTranscriptNoteWriter] Saved transcript note to ${targetPath}`);

    return {
      path: targetPath,
      videoId: video.videoId,
      sourceUrl: video.url,
      savedAt: Date.now(),
      includedSummary: Boolean(options.includeSummary?.trim()),
    };
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const parts = folderPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = app.vault.getAbstractFileByPath(currentPath);
      if (existing) {
        if (!("children" in (existing as Record<string, unknown>))) {
          throw new Error(`Path conflict: ${currentPath} exists as a file.`);
        }
        continue;
      }

      await app.vault.adapter.mkdir(currentPath);
    }
  }

  private async resolveTargetPath(
    preferredPath: string,
    noteContent: string,
    video: YouTubeVideo,
    overwriteExisting: boolean
  ): Promise<string> {
    if (!(await app.vault.adapter.exists(preferredPath))) {
      return preferredPath;
    }

    const existingContent = await app.vault.adapter.read(preferredPath);
    const sourceMarker = this.buildSourceMarker(video.url);
    if (
      overwriteExisting ||
      existingContent.includes(sourceMarker) ||
      existingContent === noteContent
    ) {
      return preferredPath;
    }

    const fallbackPath = sanitizeFilePath(preferredPath.replace(/\.md$/i, `-${video.videoId}.md`));
    if (fallbackPath !== preferredPath && !(await app.vault.adapter.exists(fallbackPath))) {
      return fallbackPath;
    }

    logWarn(
      `[YouTubeTranscriptNoteWriter] Reusing ${preferredPath} because a unique fallback path was unavailable`
    );
    return preferredPath;
  }

  private buildBaseName(title: string, videoId: string): string {
    const sanitizedTitle = title
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 120)
      .trim();
    return sanitizedTitle ? `${sanitizedTitle} - ${videoId}` : `YouTube Transcript - ${videoId}`;
  }

  private normalizeFolderPath(folderPath: string): string {
    return folderPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  }

  private buildNoteContent(
    video: YouTubeVideo,
    transcript: VideoTranscript,
    summary?: string
  ): string {
    try {
      const frontmatterLines = [
        "---",
        `title: "${this.escapeYaml(video.title)}"`,
        `videoId: "${this.escapeYaml(video.videoId)}"`,
        `sourceUrl: "${this.escapeYaml(video.url)}"`,
        ...(video.channelName ? [`channel: "${this.escapeYaml(video.channelName)}"`] : []),
        ...(video.publicationDate
          ? [`publicationDate: "${this.escapeYaml(video.publicationDate)}"`]
          : []),
        `provider: "${this.escapeYaml(transcript.provider)}"`,
        `language: "${this.escapeYaml(transcript.language)}"`,
        `extractionMethod: "${this.escapeYaml(transcript.extractionMethod)}"`,
        `savedAt: "${new Date().toISOString()}"`,
        "---",
        "",
      ];

      const sections = [
        `# ${video.title}`,
        "",
        `Source: ${video.url}`,
        ...(video.channelName ? [`Channel: ${video.channelName}`] : []),
        ...(video.publicationDate ? [`Published: ${video.publicationDate}`] : []),
        "",
      ];

      if (summary?.trim()) {
        sections.push("## Summary", "", summary.trim(), "");
      }

      sections.push("## Transcript", "", transcript.formattedMarkdown || transcript.plainText, "");

      return `${frontmatterLines.join("\n")}${this.buildSourceMarker(video.url)}\n${sections.join("\n")}`;
    } catch (error) {
      logError("[YouTubeTranscriptNoteWriter] Failed to build note content:", error);
      throw error;
    }
  }

  private buildSourceMarker(url: string): string {
    return `<!-- source: ${url} -->`;
  }

  private escapeYaml(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}
