import { App } from "obsidian";
import { WikiWriterApi } from "@/types/wikiWriter";

interface AppWithPlugins extends App {
  plugins?: {
    getPlugin(pluginId: string): unknown;
  };
}

/**
 * Returns the public Wiki Writer API when the plugin is installed and enabled.
 */
export function getWikiWriterApi(app: App): WikiWriterApi | null {
  const pluginHost = (app as AppWithPlugins).plugins;
  if (!pluginHost?.getPlugin) {
    return null;
  }

  const plugin = pluginHost.getPlugin("wiki-writer") as { api?: unknown } | null | undefined;
  const api = plugin?.api;

  if (!api || typeof api !== "object") {
    return null;
  }

  if (typeof (api as WikiWriterApi).openSaveDialog !== "function") {
    return null;
  }

  return api as WikiWriterApi;
}

/**
 * Checks whether Wiki Writer integration is available in the current vault.
 */
export function hasWikiWriterApi(app: App): boolean {
  return getWikiWriterApi(app) !== null;
}
