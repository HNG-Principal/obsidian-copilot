import { Button } from "@/components/ui/button";
import { App, Modal } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";

function ConfirmModalContent({
  content,
  onConfirm,
  onCancel,
  onAlternate,
  confirmButtonText,
  alternateButtonText,
  cancelButtonText,
}: {
  content: string;
  onConfirm: () => void;
  onCancel: () => void;
  onAlternate?: () => void;
  confirmButtonText: string;
  alternateButtonText?: string;
  cancelButtonText: string;
}) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-5">
      <div className="tw-whitespace-pre-wrap">{content}</div>
      <div className="tw-flex tw-justify-end tw-gap-2">
        {cancelButtonText && (
          <Button variant="secondary" onClick={onCancel}>
            {cancelButtonText}
          </Button>
        )}
        {alternateButtonText && onAlternate && (
          <Button variant="secondary" onClick={onAlternate}>
            {alternateButtonText}
          </Button>
        )}
        {confirmButtonText && (
          <Button variant="default" onClick={onConfirm}>
            {confirmButtonText}
          </Button>
        )}
      </div>
    </div>
  );
}

export class ConfirmModal extends Modal {
  private root: Root;
  private confirmed = false;

  constructor(
    app: App,
    private onConfirm: () => void,
    private content: string,
    title: string,
    private confirmButtonText: string = "Continue",
    private cancelButtonText: string = "Cancel",
    private onCancel?: () => void,
    private alternateButtonText?: string,
    private onAlternate?: () => void
  ) {
    super(app);
    // https://docs.obsidian.md/Reference/TypeScript+API/Modal/setTitle
    // @ts-ignore
    this.setTitle(title);
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);

    const handleConfirm = () => {
      this.confirmed = true;
      this.onConfirm();
      this.close();
    };

    const handleCancel = () => {
      this.close();
    };

    const handleAlternate = () => {
      this.confirmed = true;
      this.onAlternate?.();
      this.close();
    };

    this.root.render(
      <ConfirmModalContent
        content={this.content}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        onAlternate={handleAlternate}
        confirmButtonText={this.confirmButtonText}
        alternateButtonText={this.alternateButtonText}
        cancelButtonText={this.cancelButtonText}
      />
    );
  }

  onClose() {
    if (!this.confirmed) {
      this.onCancel?.();
    }
    this.root.unmount();
  }
}
