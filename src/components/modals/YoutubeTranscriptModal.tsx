import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logError } from "@/logger";
import type { YouTubeExtractionResult } from "@/services/youtubeContextTypes";
import { YouTubeExtractor } from "@/services/youtubeExtractor";
import { YouTubeTranscriptNoteWriter } from "@/services/youtubeTranscriptNoteWriter";
import { getSettings } from "@/settings/model";
import { insertIntoEditor, validateYoutubeUrl } from "@/utils";
import { App, Modal, Notice } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";

interface TranscriptData {
  extraction: YouTubeExtractionResult;
}

export function YoutubeTranscriptModalContent({ onClose }: { onClose: () => void }) {
  const [currentView, setCurrentView] = React.useState<"input" | "display">("input");
  const [url, setUrl] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [isValidUrl, setIsValidUrl] = React.useState(false);
  const [transcriptData, setTranscriptData] = React.useState<TranscriptData | null>(null);

  const validateInput = (inputUrl: string, updateState = true) => {
    if (!inputUrl.trim()) {
      if (updateState) {
        setError("");
        setIsValidUrl(false);
      }
      return { isValid: false };
    }

    const validation = validateYoutubeUrl(inputUrl);
    if (validation.isValid) {
      if (updateState) {
        setError("");
        setIsValidUrl(true);
      }
      return { isValid: true, videoId: validation.videoId };
    } else {
      if (updateState) {
        setError(validation.error || "Invalid URL");
        setIsValidUrl(false);
      }
      return { isValid: false };
    }
  };

  const handleUrlChange = (value: string) => {
    setUrl(value);
    validateInput(value, true);
  };

  const handleDownload = async () => {
    if (isLoading) return;

    const validation = validateInput(url);
    if (!validation.isValid) return;

    setIsLoading(true);
    setError("");

    try {
      const extraction = await YouTubeExtractor.getInstance().extractTranscript(url);
      const newTranscriptData: TranscriptData = {
        extraction,
      };

      setTranscriptData(newTranscriptData);
      setCurrentView("display");
    } catch (error) {
      logError("Error downloading YouTube transcript:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An error occurred while downloading the transcript";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyToClipboard = async () => {
    if (!transcriptData) return;

    try {
      const textToCopy = buildTranscriptText(transcriptData);
      await navigator.clipboard.writeText(textToCopy);
      new Notice("Transcript copied to clipboard!");
    } catch (error) {
      logError("Failed to copy to clipboard:", error);
      new Notice("Failed to copy to clipboard");
    }
  };

  const handleInsertToNote = async () => {
    if (!transcriptData) return;

    try {
      const textToInsert = buildTranscriptText(transcriptData);
      await insertIntoEditor(textToInsert, false);
      onClose();
    } catch (error) {
      logError("Failed to insert to note:", error);
      new Notice("Failed to insert to note");
    }
  };

  const handleSaveToVault = async () => {
    if (!transcriptData) return;

    try {
      const saved = await YouTubeTranscriptNoteWriter.getInstance().save(
        transcriptData.extraction.video,
        transcriptData.extraction.transcript,
        {
          outputFolder: getSettings().youtubeTranscriptOutputFolder,
        }
      );
      new Notice(`Transcript saved to ${saved.path}`);
      onClose();
    } catch (error) {
      logError("Failed to save transcript to vault:", error);
      new Notice("Failed to save transcript to vault");
    }
  };

  const handleDownloadAnother = () => {
    setCurrentView("input");
    setUrl("");
    setError("");
    setTranscriptData(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading && isValidUrl) {
      handleDownload();
    }
  };

  if (currentView === "display" && transcriptData) {
    const { extraction } = transcriptData;
    return (
      <div className="tw-flex tw-flex-col tw-gap-4">
        {/* Video info section */}
        <div className="tw-rounded tw-bg-secondary tw-p-3">
          <div className="tw-mb-1 tw-text-sm tw-font-semibold">{extraction.video.title}</div>
          {extraction.video.channelName && (
            <div className="tw-mb-1 tw-text-xs tw-text-muted">{extraction.video.channelName}</div>
          )}
          <a
            href={extraction.video.url}
            className="tw-text-sm tw-text-muted hover:tw-text-normal"
            target="_blank"
            rel="noopener noreferrer"
          >
            {extraction.video.url}
          </a>
          <div className="tw-mt-2 tw-text-xs tw-text-muted">
            {extraction.transcript.provider} • {extraction.transcript.extractionMethod} •{" "}
            {extraction.cacheStatus}
          </div>
        </div>

        {/* Transcript content */}
        <div className="tw-max-h-96 tw-overflow-y-auto tw-rounded tw-border tw-border-border tw-bg-primary tw-p-4">
          <div className="tw-whitespace-pre-wrap tw-text-sm tw-leading-relaxed">
            {extraction.transcript.formattedMarkdown || extraction.transcript.plainText}
          </div>
        </div>

        {/* Buttons */}
        <div className="tw-flex tw-justify-end tw-gap-2">
          <Button variant="ghost" onClick={handleDownloadAnother}>
            Download Another
          </Button>
          <Button variant="default" onClick={handleCopyToClipboard}>
            Copy to Clipboard
          </Button>
          <Button variant="default" onClick={handleInsertToNote}>
            Insert at Cursor
          </Button>
          <Button variant="default" onClick={handleSaveToVault}>
            Save to Vault
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {/* URL input section */}
      <div className="tw-flex tw-flex-col tw-gap-2">
        <div className="tw-text-sm tw-text-muted">Enter a valid YouTube video URL</div>
        <Input
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        {error && <div className="tw-text-sm tw-text-error">{error}</div>}
      </div>

      {/* Buttons */}
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button variant="default" onClick={handleDownload} disabled={isLoading || !isValidUrl}>
          {isLoading ? "Downloading..." : "Download Transcript"}
        </Button>
      </div>
    </div>
  );
}

export class YoutubeTranscriptModal extends Modal {
  private root: Root;

  constructor(app: App) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle("Download YouTube Script (plus)");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleClose = () => {
      this.close();
    };

    this.root.render(<YoutubeTranscriptModalContent onClose={handleClose} />);
  }

  onClose() {
    this.root.unmount();
  }
}

/**
 * Build clipboard/editor text for a processed transcript.
 *
 * @param transcriptData - Processed transcript payload.
 * @returns Markdown text for copy/insert actions.
 */
export function buildTranscriptText(transcriptData: TranscriptData): string {
  const { extraction } = transcriptData;
  const sections = [
    `# ${extraction.video.title}`,
    "",
    `Source: ${extraction.video.url}`,
    ...(extraction.video.channelName ? [`Channel: ${extraction.video.channelName}`] : []),
    "",
    extraction.transcript.formattedMarkdown || extraction.transcript.plainText,
  ];

  return sections.join("\n");
}
