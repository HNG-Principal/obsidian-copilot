# Research Decisions: Document Conversion Service

**Feature**: `001-doc-conversion-service` | **Date**: 2026-04-08

---

## 1. PDF Parsing Strategy (Self-Hosted)

**Decision**: Use a bundleable JavaScript PDF library (e.g., `pdf-parse` or `pdfjs-dist`) for text extraction, with the existing `SelfHostPdfParser` path as a migration bridge.

**Rationale**: The current system relies on `BrevilabsClient.pdf4llm()` (cloud) with `SelfHostPdfParser` (Miyo) as fallback. For a fully self-hosted solution, we need an in-plugin PDF parser that works without any external service. `pdf-parse` wraps Mozilla's `pdf.js` and runs in Node.js/Electron.

**Alternatives Considered**:

- **Keep Brevilabs cloud API**: Rejected — violates the self-hosted requirement (FR-012).
- **Require Miyo backend always**: Rejected — adds infrastructure burden. Users shouldn't need a separate server for basic PDF conversion.
- **WASM-based parser (e.g., mupdf-wasm)**: Considered — better table extraction but adds significant bundle size. Deferred to v2 if `pdf-parse` table quality is insufficient.

**Implementation Approach**:

- Create `LocalPdfParser` implementing `FileParser` interface
- Use `pdf-parse` for text + basic structure extraction
- For table detection: post-process text blocks using heuristic column alignment detection
- OCR fallback: if extracted text is empty/minimal, route to `OcrFallbackParser` which uses the user's vision-capable LLM

---

## 2. Office Document Libraries

**Decision**: Use `mammoth` for DOCX, a lightweight PPTX XML parser for presentations, and `xlsx` (SheetJS) for spreadsheets.

**Rationale**: These are mature, well-maintained JavaScript libraries that run in Node.js/Electron without external dependencies. `mammoth` is specifically designed for DOCX → HTML/markdown conversion with semantic structure preservation.

**Alternatives Considered**:

- **LibreOffice headless**: Rejected — requires system-level installation, not bundleable in an Obsidian plugin.
- **Unified pandoc-like converter**: Rejected — pandoc is a binary, not bundleable. No pure-JS equivalent covers all formats well.
- **Custom XML parsing for all formats**: Rejected — reinventing the wheel. Libraries handle edge cases.

**Implementation Approach**:

- `DocxParser`: `mammoth.convertToMarkdown()` with custom style mapping for headings, lists, bold/italic
- `PptxParser`: Parse PPTX (ZIP of XML) — extract slide XML, convert text runs to markdown with `## Slide N` separators
- `XlsxParser`: `xlsx.read()` → iterate sheets → convert each to markdown table using `|` pipe syntax
- Each parser: buffer in → markdown string out, with error wrapping

---

## 3. OCR Strategy

**Decision**: Use the user's configured vision-capable LLM (e.g., GPT-4o, Claude) for OCR as a fallback when text extraction yields minimal content.

**Rationale**: Bundling a full OCR engine (Tesseract) adds ~30MB to the plugin and requires WASM complexity. Most users already have a vision-capable LLM configured. Using it for OCR leverages existing infrastructure without new dependencies.

**Alternatives Considered**:

- **Tesseract.js (WASM)**: Rejected for v1 — large bundle size, complex initialization, slower than LLM vision API for most documents. Reconsider for v2 if offline OCR is needed.
- **Miyo OCR endpoint**: Rejected — adds backend dependency, contradicts self-hosted simplicity.
- **No OCR in v1**: Considered — but scanned PDFs are common enough that omitting OCR significantly reduces usefulness. Vision API approach is low-effort.

**Implementation Approach**:

- `OcrFallbackParser`: accepts image buffer or PDF page image, sends to user's LLM via vision API
- Trigger: when primary parser returns <50 characters for a multi-page document
- Prompt: dedicated OCR extraction prompt requesting structured markdown output
- Rate: process pages sequentially to avoid rate limits, with progress callback

---

## 4. File Size Limits and Chunking

**Decision**: Enforce a configurable maximum file size (default 50MB) with per-format page/sheet limits, and chunk large documents for context injection.

**Rationale**: Large documents can exhaust memory in the Electron process and exceed LLM context windows. Size limits prevent resource exhaustion while remaining generous enough for typical use cases.

**Alternatives Considered**:

- **No limits**: Rejected — a 500-page PDF could crash the plugin or produce an unusable context.
- **Hard-coded limits**: Rejected — violates Constitution I (Generalizable Solutions). Users should configure limits.
- **Streaming conversion**: Overkill for v1 — standard in-memory conversion handles 100+ page documents fine.

**Implementation Approach**:

- `maxFileSizeMB` setting (default 50, range 1-200)
- Per-format page limits surfaced as warnings (not hard blocks): >100 pages for PDF, >50 slides for PPTX
- For context injection: if converted markdown exceeds LLM context budget, truncate with `[Content truncated — {remaining} characters omitted]` marker
- Cache invalidation: based on file hash (existing `PDFCache` pattern)

---

## 5. Integration with Existing Context Pipeline

**Decision**: Route file attachments through `FileParserManager` during context processing in `ContextProcessor`, wrapping results in existing XML tags.

**Rationale**: The existing `ContextProcessor.processEmbeddedPDFs()` already handles PDF-to-context conversion. Extending this to support all file types via `FileParserManager` is the minimal-change approach that reuses the established pipeline.

**Alternatives Considered**:

- **New context processing pipeline**: Rejected — unnecessary when the existing pipeline can be extended.
- **Tool-based conversion only**: Rejected — file context should work via the @-mention / +Add Context UI, not just as a tool call.

**Implementation Approach**:

- In `ContextProcessor`: detect non-markdown file types, route to `FileParserManager.parseFile()`
- Wrap converted content in `<converted-document source="filename.pdf" type="pdf">` XML tags
- Reuse existing `PDFCache` pattern — extend to `DocumentCache` supporting all format keys
- Save-to-vault: trigger `saveConvertedDocOutput()` when user opts in

---

## 6. Error Handling Strategy

**Decision**: Each parser returns a typed `ConversionResult` with status (success/partial/failure), content, and error details. Errors surface to the user via existing chat error display.

**Rationale**: Different failure modes require different user messages: unsupported format, corrupt file, password-protected, timeout, file too large. A structured result type handles all cases uniformly.

**Alternatives Considered**:

- **Throw exceptions**: Rejected — doesn't support partial results (e.g., 90% of slides converted, 1 failed).
- **Silent fallback**: Rejected — users need to know when conversion is incomplete.

**Implementation Approach**:

- `ConversionResult`: `{ status: 'success' | 'partial' | 'failure', content: string, metadata: ConversionMetadata, errors: ConversionError[] }`
- Partial results: return what was converted + error array listing what failed
- Password-protected files: detect early and return informative error (FR-010)
- Timeout: configurable per-parser timeout (default 30s), returns partial result if available

---

## 7. EPUB Parsing Library

**Decision**: Use `epub2` (or `epubjs` if bundleable) for EPUB parsing. If neither bundles cleanly in esbuild, fall back to manual ZIP + HTML extraction via `jszip` (already implicitly available through PPTX parsing).

**Rationale**: EPUB files are ZIP archives containing XHTML chapters. A dedicated library simplifies chapter ordering and metadata extraction. However, many EPUB libraries assume browser or full Node.js environments and may not bundle in Electron/esbuild.

**Alternatives Considered**:

- **epub.js**: Designed for browser-based reading \u2014 heavy on rendering, not ideal for text-only extraction.
- **Manual ZIP parsing only**: Viable as fallback \u2014 `jszip` extracts the XHTML files, then strip HTML tags. Loses chapter ordering metadata.
- **@nicolo-ribaudo/epub**: Lightweight option but low npm downloads / maintenance risk.

**Implementation Approach**:

- **Phase 1 (T001)**: Evaluate `epub2` bundleability alongside other dependencies during the esbuild verification step (T003). If it fails, switch to `jszip` + manual XHTML parsing.
- `EpubParser`: Extract OPF spine for chapter ordering \u2192 iterate chapters \u2192 strip HTML \u2192 emit `## Chapter: Title` markdown separators.
- Metadata: extract title, author, publisher, ISBN from OPF metadata block.
