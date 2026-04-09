import { getWebViewerService } from "@/services/webViewerService/webViewerServiceSingleton";

/**
 * Interface for fetching fully rendered page HTML when raw HTTP fetches are too thin.
 */
export interface IRenderedPageProvider {
  renderPage(url: string, timeoutMs: number): Promise<string>;
}

/**
 * Best-effort rendered page provider backed by an already-open Web Viewer tab.
 */
export class RenderedPageProvider implements IRenderedPageProvider {
  private static instance: RenderedPageProvider;

  /**
   * Get the shared rendered page provider.
   */
  static getInstance(): RenderedPageProvider {
    if (!RenderedPageProvider.instance) {
      RenderedPageProvider.instance = new RenderedPageProvider();
    }
    return RenderedPageProvider.instance;
  }

  /**
   * Return fully rendered HTML for a matching open Web Viewer tab.
   */
  async renderPage(url: string, timeoutMs: number): Promise<string> {
    const service = getWebViewerService(app);
    const leaf = service.findLeafByUrl(url);
    if (!leaf) {
      throw new Error(
        "Rendered fallback is unavailable because the page is not open in Web Viewer"
      );
    }

    return Promise.race([
      service.getHtml(leaf, true),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("Rendered fallback timed out")), timeoutMs);
      }),
    ]);
  }
}
