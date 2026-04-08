import { TFile } from "obsidian";

export interface WikiWriterOpenSaveDialogOptions {
  defaultDomain?: string;
  defaultPageType?: "entity" | "concept" | "comparison" | "synthesis";
  openAfterCreation?: boolean;
  showSuccessNotice?: boolean;
}

export interface WikiWriterApi {
  openSaveDialog(text: string, options?: WikiWriterOpenSaveDialogOptions): Promise<TFile | null>;
}
