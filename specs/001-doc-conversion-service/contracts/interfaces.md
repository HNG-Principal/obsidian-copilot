# Interface Contracts: Document Conversion Service

**Feature**: `001-doc-conversion-service` | **Date**: 2026-04-08

---

## Core Interfaces

### FileParser

Each format parser implements this interface. Registered with `FileParserManager`.

```typescript
interface FileParser {
  /** Unique format identifier */
  readonly formatId: SupportedFormat;

  /** MIME types this parser handles */
  readonly supportedMimeTypes: string[];

  /** Human-readable format name for UI display */
  readonly displayName: string;

  /**
   * Convert a file to markdown.
   * @param fileBuffer - Raw file content as ArrayBuffer
   * @param filename - Original filename (for metadata)
   * @param options - Conversion options
   * @returns ConversionResult with status, content, and metadata
   */
  parse(
    fileBuffer: ArrayBuffer,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Quick check if this parser can handle the given MIME type.
   */
  canHandle(mimeType: string): boolean;
}
```

### FileParserManager (existing — extended)

```typescript
interface IFileParserManager {
  /**
   * Register a parser for one or more MIME types.
   */
  registerParser(parser: FileParser): void;

  /**
   * Parse a file by detecting its MIME type and routing to the correct parser.
   * Falls back to OCR if primary parser returns minimal content.
   */
  parseFile(file: TFile, vault: Vault, options?: ConversionOptions): Promise<ConversionResult>;

  /**
   * List all supported format identifiers.
   */
  getSupportedFormats(): SupportedFormat[];
}
```

---

## Parser Implementations (pure function signatures)

### LocalPdfParser

```typescript
type ParsePdf = (
  fileBuffer: ArrayBuffer,
  filename: string,
  options: ConversionOptions
) => Promise<ConversionResult>;
```

### DocxParser

```typescript
type ParseDocx = (
  fileBuffer: ArrayBuffer,
  filename: string,
  options: ConversionOptions
) => Promise<ConversionResult>;
```

### PptxParser

```typescript
type ParsePptx = (
  fileBuffer: ArrayBuffer,
  filename: string,
  options: ConversionOptions
) => Promise<ConversionResult>;
```

### XlsxParser

```typescript
type ParseXlsx = (
  fileBuffer: ArrayBuffer,
  filename: string,
  options: ConversionOptions
) => Promise<ConversionResult>;
```

### EpubParser

```typescript
type ParseEpub = (
  fileBuffer: ArrayBuffer,
  filename: string,
  options: ConversionOptions
) => Promise<ConversionResult>;
```

### OcrFallbackParser

```typescript
type OcrFallback = (
  imageBuffers: ArrayBuffer[],
  filename: string,
  llmVisionApi: (image: ArrayBuffer, prompt: string) => Promise<string>
) => Promise<ConversionResult>;
```

---

## Settings Contract

New settings added to `CopilotSettings`:

| Setting         | Type     | Default | Range | Description                      |
| --------------- | -------- | ------- | ----- | -------------------------------- |
| `maxFileSizeMB` | `number` | `50`    | 1–200 | Maximum file size for conversion |

Existing settings reused:

- `convertedDocOutputFolder` — output folder for saved conversions
- `enableMiyo` — self-host mode toggle

---

## Context Integration Contract

### ContextProcessor Extension

```xml
<!-- Converted document injected into context -->
<converted-document source="meeting-notes.docx" type="docx" pages="12" words="3400">
  [Converted markdown content here]
</converted-document>
```

The `ContextProcessor` detects non-markdown file attachments and routes them through `FileParserManager.parseFile()`. The result is wrapped in `<converted-document>` XML tags with metadata attributes.

---

## Error Contract

All user-facing errors are surfaced via the existing chat error display mechanism. Error messages follow this pattern:

```typescript
type UserFacingError = {
  title: string; // e.g., "Document Conversion Failed"
  message: string; // e.g., "The file appears to be password-protected."
  suggestion: string; // e.g., "Try removing the password and re-adding the file."
};
```

---

## Event Hooks

| Hook                     | Trigger                                      | Handler                                              |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------- |
| File attached to context | User adds file via @-mention or +Add Context | `ContextProcessor` → `FileParserManager.parseFile()` |
| Save to vault requested  | User clicks save button                      | `saveConvertedDocOutput()`                           |
| Cache miss               | File not in cache or hash changed            | Parser invoked, result cached                        |
| OCR fallback triggered   | Primary parser returns <50 chars             | `OcrFallbackParser` invoked with vision LLM          |
