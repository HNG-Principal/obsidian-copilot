# Implementation Plan: Document Conversion Service

**Branch**: `001-doc-conversion-service` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-doc-conversion-service/spec.md`

## Summary

Self-hosted document conversion service that converts PDF, EPUB, DOCX, PPTX, XLSX, images, and other file types into structured markdown for chat context and vault indexing. Replaces the Brevilabs cloud dependency with local-only processing. Extends the existing `FileParserManager` with new parser implementations per format, reuses the `PDFCache` caching layer, and integrates via the existing chat context attachment UI (`ContextProcessor`). Converted output optionally saved to vault via the existing `saveConvertedDocOutput()` utility.

## Technical Context

**Language/Version**: TypeScript (strict mode) targeting ES2018+
**Primary Dependencies**: React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API, pdf-parse (or similar WASM PDF lib), mammoth (DOCX), xlsx (spreadsheets), epub.js or similar
**Storage**: Conversion cache in `.copilot/pdf-cache/` (existing), converted output in user-configurable `convertedDocOutputFolder`
**Testing**: Jest + unit tests adjacent to implementation
**Target Platform**: Obsidian desktop plugin (Electron)
**Project Type**: Obsidian plugin (single-bundle, esbuild)
**Performance Goals**: Conversion within 30 seconds for documents up to 100 pages (SC-001), table accuracy ≥90% (SC-002)
**Constraints**: Offline-capable (no third-party services except user's own LLM for OCR fallback via vision API), single-bundle plugin (libraries must be bundleable or WASM-compatible)
**Scale/Scope**: 5+ file formats at launch, ~8 new source files, 3 new parser implementations

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                          | Status   | Notes                                                                                                                                                                                                      |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Generalizable Solutions         | **PASS** | Format routing based on MIME type detection — no hardcoded folder names or file patterns. Parser registry dispatches generically.                                                                          |
| II. Clean Architecture             | **PASS** | `FileParserManager` (existing) is the single coordination point. Each format parser is a standalone `FileParser` implementation. `ConversionResult` as unified output type.                                |
| III. Prompt Integrity              | **PASS** | No existing prompts modified. OCR fallback uses vision API with a new, dedicated prompt in its own module.                                                                                                 |
| IV. Type Safety                    | **PASS** | `ConversionRequest`, `ConversionResult`, `ConvertedDocument` types defined in `conversionTypes.ts`. Each parser returns typed `ConversionResult`.                                                          |
| V. Structured Logging              | **PASS** | All logging via `logInfo/logWarn/logError`.                                                                                                                                                                |
| VI. Testable by Design             | **PASS** | Each parser is a pure-ish function: file buffer in → markdown string out. No singleton dependencies in parser modules. `FileParserManager` receives parsers via registration.                              |
| VII. Simplicity & Minimal Overhead | **PASS** | Extends existing `FileParserManager` pattern. Reuses `PDFCache`, `saveConvertedDocOutput()`, and `ContextProcessor` XML wrapping. No new backend service — all processing in-plugin via bundled libraries. |
| VIII. Documentation Discipline     | **PASS** | Will update `docs/` when user-facing behavior ships. JSDoc on all new functions.                                                                                                                           |

**Gate result: PASS — all principles confirmed.**

## Project Structure

### Documentation (this feature)

```text
specs/001-doc-conversion-service/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── tools/
│   ├── FileParserManager.ts           # MODIFIED — register new parsers, add MIME routing
│   ├── parsers/
│   │   ├── conversionTypes.ts         # NEW — ConversionRequest, ConversionResult, ConvertedDocument types
│   │   ├── DocxParser.ts              # NEW — DOCX → markdown via mammoth
│   │   ├── DocxParser.test.ts         # NEW — unit tests
│   │   ├── PptxParser.ts             # NEW — PPTX → markdown (slide-separated)
│   │   ├── PptxParser.test.ts        # NEW — unit tests
│   │   ├── XlsxParser.ts             # NEW — XLSX/CSV → markdown tables
│   │   ├── XlsxParser.test.ts        # NEW — unit tests
│   │   ├── EpubParser.ts             # NEW — EPUB → markdown with chapter headings
│   │   ├── EpubParser.test.ts        # NEW — unit tests
│   │   ├── OcrFallbackParser.ts       # NEW — vision API OCR for scanned docs/images
│   │   └── OcrFallbackParser.test.ts  # NEW — unit tests
├── utils/
│   └── convertedDocOutput.ts          # EXISTING — reused for save-to-vault
├── cache/
│   └── pdfCache.ts                    # EXISTING — extended cache key to support all formats
├── contextProcessor.ts                # MODIFIED — route non-markdown files through parsers
└── settings/
    └── model.ts                       # MODIFIED — add maxFileSizeMB setting
```

**Structure Decision**: New parsers live in `src/tools/parsers/` subdirectory to keep format-specific logic separated from the orchestrator. Extends existing `FileParserManager` rather than replacing it. Each parser is independently testable with no cross-dependencies.

## Complexity Tracking

> No constitution violations detected. Table left empty.
