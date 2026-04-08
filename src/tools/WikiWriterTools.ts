import { z } from "zod";
import { createLangChainTool } from "./createLangChainTool";
import { getWikiWriterApi } from "@/utils/wikiWriter";

const saveToWikiSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      "(Required) The note body or response content to send to Wiki Writer for durable capture."
    ),
  defaultDomain: z
    .string()
    .optional()
    .describe("(Optional) Suggested wiki domain to prefill in the Wiki Writer dialog."),
  defaultPageType: z
    .enum(["entity", "concept", "comparison", "synthesis"])
    .optional()
    .describe("(Optional) Suggested wiki page type to prefill in the Wiki Writer dialog."),
});

export const saveToWikiTool = createLangChainTool({
  name: "saveToWiki",
  description:
    "Open the Wiki Writer save dialog to capture generated content as a durable wiki page in the current vault.",
  schema: saveToWikiSchema,
  func: async ({ content, defaultDomain, defaultPageType }) => {
    const wikiWriterApi = getWikiWriterApi(app);
    if (!wikiWriterApi) {
      return {
        status: "unavailable",
        message:
          'Wiki Writer is not installed or does not expose its public API. Install or enable the "wiki-writer" plugin first.',
      };
    }

    const file = await wikiWriterApi.openSaveDialog(content, {
      defaultDomain,
      defaultPageType,
      showSuccessNotice: true,
    });

    if (!file) {
      return {
        status: "cancelled",
        message: "The Wiki Writer dialog was closed before saving.",
      };
    }

    return {
      status: "saved",
      path: file.path,
      message: `Saved to ${file.path}`,
    };
  },
});
