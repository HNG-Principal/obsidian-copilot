# Data Model: Document Conversion Service

**Feature**: `001-doc-conversion-service` | **Date**: 2026-04-08

---

## Entities

### ConversionRequest

Represents a user's request to convert a file to markdown.

| Field        | Type                | Description                                  |
| ------------ | ------------------- | -------------------------------------------- |
| `sourceFile` | `TFile`             | Obsidian file reference                      |
| `mimeType`   | `string`            | Detected MIME type (e.g., `application/pdf`) |
| `options`    | `ConversionOptions` | User-configurable options                    |

### ConversionOptions

| Field          | Type                  | Default       | Description                                    |
| -------------- | --------------------- | ------------- | ---------------------------------------------- |
| `enableOcr`    | `boolean`             | `true`        | Whether to attempt OCR on scanned documents    |
| `saveToVault`  | `boolean`             | `false`       | Whether to persist converted markdown to vault |
| `outputFolder` | `string \| undefined` | from settings | Override output folder for saved conversion    |
| `maxPages`     | `number \| undefined` | `undefined`   | Limit number of pages/slides to process        |

### ConversionResult

The output of a conversion operation.

| Field      | Type                                  | Description                                                 |
| ---------- | ------------------------------------- | ----------------------------------------------------------- |
| `status`   | `'success' \| 'partial' \| 'failure'` | Conversion outcome                                          |
| `content`  | `string`                              | Converted markdown content                                  |
| `metadata` | `ConversionMetadata`                  | Document metadata extracted during conversion               |
| `errors`   | `ConversionError[]`                   | Array of errors (may be non-empty even on `partial` status) |

### ConversionMetadata

| Field            | Type                  | Description                     |
| ---------------- | --------------------- | ------------------------------- |
| `title`          | `string \| undefined` | Extracted document title        |
| `sourceFilename` | `string`              | Original filename               |
| `sourceFormat`   | `SupportedFormat`     | Detected format                 |
| `pageCount`      | `number \| undefined` | Number of pages/slides/sheets   |
| `wordCount`      | `number`              | Word count of converted content |
| `conversionDate` | `string`              | ISO 8601 timestamp              |
| `ocrUsed`        | `boolean`             | Whether OCR was applied         |

### ConversionError

| Field     | Type                  | Description                            |
| --------- | --------------------- | -------------------------------------- |
| `code`    | `ConversionErrorCode` | Error category                         |
| `message` | `string`              | Human-readable error message           |
| `page`    | `number \| undefined` | Page/slide number where error occurred |

### ConversionErrorCode (union type)

```typescript
type ConversionErrorCode =
  | "unsupported_format"
  | "file_too_large"
  | "password_protected"
  | "corrupt_file"
  | "ocr_failed"
  | "timeout"
  | "parse_error"
  | "unknown";
```

### SupportedFormat (union type)

```typescript
type SupportedFormat = "pdf" | "docx" | "pptx" | "xlsx" | "csv" | "epub" | "image";
```

### ConvertedDocument

A persisted conversion saved to the vault.

| Field            | Type              | Description                       |
| ---------------- | ----------------- | --------------------------------- |
| `markdownPath`   | `string`          | Vault path of saved markdown file |
| `sourceFilename` | `string`          | Original filename                 |
| `sourceFormat`   | `SupportedFormat` | Original format                   |
| `conversionDate` | `string`          | ISO 8601 timestamp                |

---

## Relationships

```
ConversionRequest 1──1 ConversionOptions
ConversionRequest 1──1 ConversionResult (output)
ConversionResult  1──1 ConversionMetadata
ConversionResult  1──* ConversionError
ConversionResult  1──0..1 ConvertedDocument (if saved to vault)
```

---

## Validation Rules

1. **File size**: `sourceFile.stat.size` ≤ `maxFileSizeMB * 1024 * 1024` (from settings)
2. **MIME type**: Must map to a registered parser in `FileParserManager`
3. **Content non-empty**: `ConversionResult.content.length > 0` for `status: 'success'`
4. **Metadata consistency**: `sourceFormat` must match the parser that produced the result
5. **Output folder**: If `saveToVault` is true, output folder must be a valid vault path

---

## State Transitions

### Conversion Lifecycle

```
Requested → Parsing → (OCR Fallback) → Completed
                                      → Partial (some pages failed)
                                      → Failed (entire conversion failed)
```

### Cache Lifecycle

```
Miss → Converting → Cached (success/partial)
                  → Uncached (failure — not stored)
Cached → Invalidated (file hash changed)
```

---

## Access Patterns

| Operation                       | Frequency              | Method                                    |
| ------------------------------- | ---------------------- | ----------------------------------------- |
| Convert file for chat context   | Per user action        | `FileParserManager.parseFile()`           |
| Convert file for vault indexing | Per index rebuild      | `FileParserManager.parseFile()`           |
| Check conversion cache          | Per conversion request | `PDFCache.get()` (extended)               |
| Save converted output           | Per user opt-in        | `saveConvertedDocOutput()`                |
| List supported formats          | Rare (UI display)      | `FileParserManager.getSupportedFormats()` |
