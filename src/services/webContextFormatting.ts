import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import { ParsedURL, WebSearchResponse } from "@/services/webContextTypes";

/**
 * Format extracted URL content for prompt context injection.
 */
export function formatWebContentContext(parsedUrl: ParsedURL): string {
  const attributes = [
    `url="${escapeXml(parsedUrl.url)}"`,
    parsedUrl.title ? `title="${escapeXml(parsedUrl.title)}"` : null,
    parsedUrl.author ? `author="${escapeXml(parsedUrl.author)}"` : null,
    parsedUrl.publicationDate ? `published="${escapeXml(parsedUrl.publicationDate)}"` : null,
    `fetched="${new Date(parsedUrl.extractedAt).toISOString()}"`,
    `status="${parsedUrl.status}"`,
  ].filter(Boolean);

  if (parsedUrl.error && parsedUrl.status === "failed") {
    return `\n\n<web-content ${attributes.join(" ")}><error code="${escapeXml(parsedUrl.error.code)}">${escapeXml(parsedUrl.error.message)}</error></web-content>`;
  }

  const warning = parsedUrl.error
    ? `\n<warning code="${escapeXml(parsedUrl.error.code)}">${escapeXml(parsedUrl.error.message)}</warning>`
    : "";

  return `\n\n<web-content ${attributes.join(" ")}>${warning}\n${escapeXml(parsedUrl.content)}\n</web-content>`;
}

/**
 * Format web search results for prompt context injection.
 */
export function formatWebSearchContext(response: WebSearchResponse): string {
  const resultBlocks = response.results
    .map(
      (result) =>
        `<result url="${escapeXml(result.url)}" title="${escapeXml(result.title)}" rank="${result.rank.toString()}" source="${escapeXml(result.source)}">${escapeXml(result.content || result.snippet)}</result>`
    )
    .join("\n");

  return `\n\n<web-search query="${escapeXml(response.query)}" provider="${escapeXml(response.provider)}">\n${resultBlocks}\n</web-search>`;
}
