# Quickstart: Document Conversion Service

**Feature**: `001-doc-conversion-service` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: Types and Interfaces

Create `src/tools/parsers/conversionTypes.ts` with all types:

- `SupportedFormat`, `ConversionErrorCode`, `ConversionOptions`
- `ConversionResult`, `ConversionMetadata`, `ConversionError`, `ConvertedDocument`
- `FileParser` interface

### Step 2: LocalPdfParser

Create `src/tools/parsers/LocalPdfParser.ts`:

- Implement `FileParser` interface for PDF format
- Use `pdf-parse` for text extraction
- Heuristic table detection (column alignment)
- Return `ConversionResult` with metadata (page count, word count)
- Test with sample PDFs (text, tables, empty/scanned)

### Step 3: DocxParser

Create `src/tools/parsers/DocxParser.ts`:

- Use `mammoth` library with custom style mapping
- Map DOCX headings → markdown headings, lists → markdown lists
- Preserve bold/italic formatting
- Test with DOCX files containing headings, lists, tables

### Step 4: PptxParser and XlsxParser

Create `src/tools/parsers/PptxParser.ts`:

- Parse PPTX ZIP → extract slide XML
- Convert text runs to markdown with `## Slide N` separators
- Handle speaker notes as blockquotes

Create `src/tools/parsers/XlsxParser.ts`:

- Use `xlsx` library to read workbook
- Convert each sheet to markdown table
- Handle multiple sheets with `## Sheet: Name` separators

### Step 5: EpubParser and OcrFallbackParser

Create `src/tools/parsers/EpubParser.ts`:

- Parse EPUB structure (ZIP of XHTML)
- Extract chapter headings and content
- Strip HTML artifacts

Create `src/tools/parsers/OcrFallbackParser.ts`:

- Accept image buffers from failed text extraction
- Send to user's vision-capable LLM
- Parse structured markdown from LLM response

### Step 6: Wire FileParserManager

Modify `src/tools/FileParserManager.ts`:

- Register all new parsers on initialization
- Add MIME type detection routing
- Add file size validation against `maxFileSizeMB`
- Integrate OCR fallback logic (trigger when content < 50 chars)

### Step 7: Context Pipeline Integration

Modify `src/contextProcessor.ts`:

- Detect non-markdown file attachments
- Route through `FileParserManager.parseFile()`
- Wrap result in `<converted-document>` XML tags
- Extend cache to support all format keys

### Step 8: Settings and UI

Modify `src/settings/model.ts`:

- Add `maxFileSizeMB` setting with default and range validation

---

## Prerequisites

- Install `pdf-parse`, `mammoth`, `xlsx` as dependencies
- Verify each library bundles with esbuild (no native Node.js modules)
- Ensure EPUB parsing library is compatible with Electron

---

## Verification Checklist

- [ ] PDF with text extracts to readable markdown
- [ ] PDF with tables produces markdown tables
- [ ] Scanned PDF triggers OCR fallback and extracts text
- [ ] DOCX preserves heading hierarchy, lists, bold/italic
- [ ] PPTX separates slides with headings
- [ ] XLSX produces markdown tables
- [ ] EPUB preserves chapter structure
- [ ] File size limit rejects oversized files with clear error
- [ ] Password-protected files return informative error
- [ ] Corrupt files return informative error (not crash)
- [ ] Conversion cache prevents redundant processing
- [ ] Save to vault creates markdown file with frontmatter
- [ ] Context processor wraps converted content in XML tags
- [ ] All parsers have passing unit tests

---

## Key Files Reference

| File                                     | Purpose                                 |
| ---------------------------------------- | --------------------------------------- |
| `src/tools/parsers/conversionTypes.ts`   | All type definitions                    |
| `src/tools/parsers/LocalPdfParser.ts`    | PDF → markdown                          |
| `src/tools/parsers/DocxParser.ts`        | DOCX → markdown                         |
| `src/tools/parsers/PptxParser.ts`        | PPTX → markdown                         |
| `src/tools/parsers/XlsxParser.ts`        | XLSX → markdown tables                  |
| `src/tools/parsers/EpubParser.ts`        | EPUB → markdown                         |
| `src/tools/parsers/OcrFallbackParser.ts` | Vision LLM OCR fallback                 |
| `src/tools/FileParserManager.ts`         | Parser orchestration (modified)         |
| `src/contextProcessor.ts`                | Context pipeline integration (modified) |
| `src/settings/model.ts`                  | Settings (modified)                     |
