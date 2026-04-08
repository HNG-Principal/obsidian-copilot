import { getConversionErrorChatMessage, isConversionErrorLike } from "./conversionErrorMessages";
import type { ConversionErrorCode } from "./conversionTypes";

describe("conversionErrorMessages", () => {
  it("detects conversion-style errors", () => {
    expect(
      isConversionErrorLike({
        code: "parse_error",
        message: "Failed to parse document",
      })
    ).toBe(true);
    expect(isConversionErrorLike(new Error("plain error"))).toBe(false);
  });

  it.each<[ConversionErrorCode, string]>([
    ["unsupported_format", "format is not supported"],
    ["file_too_large", "too large to add as chat context"],
    ["password_protected", "appears to be password protected"],
    ["corrupt_file", "appears to be corrupted or incomplete"],
    ["ocr_failed", "could not extract readable text"],
    ["timeout", "took too long to convert"],
    ["parse_error", "could not extract readable content"],
  ])("formats a friendly chat message for %s", (code, expectedSnippet) => {
    const chatMessage = getConversionErrorChatMessage({
      code,
      message: "Low-level parser detail",
      sourceFilename: "example.pdf",
      page: 3,
    });

    expect(chatMessage).toContain("Document Conversion Failed");
    expect(chatMessage).toContain('"example.pdf"');
    expect(chatMessage).toContain(expectedSnippet);
    expect(chatMessage).toContain("Details: Low-level parser detail");
  });

  it("returns null for non-conversion errors", () => {
    expect(getConversionErrorChatMessage(new Error("Something else failed"))).toBeNull();
  });
});
