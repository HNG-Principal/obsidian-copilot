# Tasks: Document Conversion Service

**Input**: Design documents from `/specs/001-doc-conversion-service/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included — plan.md explicitly allocates test files for each parser in the project structure.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/` at repository root (Obsidian plugin, single-bundle esbuild)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies, create shared types, and verify bundleability in the Obsidian plugin build

- [x] T001 Install npm dependencies: `pdf-parse`, `mammoth`, `xlsx` and verify they are added to package.json
- [x] T002 [P] Create all shared types and interfaces (`SupportedFormat`, `ConversionErrorCode`, `ConversionOptions`, `ConversionResult`, `ConversionMetadata`, `ConversionError`, `ConvertedDocument`, new `FileParser` interface with `parse(fileBuffer, filename, options)` signature) in src/tools/parsers/conversionTypes.ts — this is the new typed contract; the existing `FileParser` interface in FileParserManager.ts is the legacy contract
- [x] T003 [P] Verify bundleability of new dependencies with esbuild — run `npm run build` and confirm no native module errors

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend existing infrastructure so all parsers can register and route correctly

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Add adapter layer in `FileParserManager` to bridge legacy `FileParser` interface (`parseFile(TFile, Vault): Promise<string>`) with new typed contract (`parse(ArrayBuffer, string, ConversionOptions): Promise<ConversionResult>`). The adapter reads the buffer via `vault.readBinary()`, delegates to `parse()`, and extracts `content` from `ConversionResult`. Add extension-to-MIME mapping table, `getSupportedFormats()`, and OCR fallback trigger logic (content < 50 chars) in src/tools/FileParserManager.ts
- [x] T005 [P] Add `maxFileSizeMB` setting (default 50, range 1–200) to `CopilotSettings` in src/settings/model.ts
- [x] T006 Add file size validation to `FileParserManager.parseFile()` — reject files exceeding `maxFileSizeMB` with a typed `ConversionError` (`file_too_large`) in src/tools/FileParserManager.ts

**Checkpoint**: Foundation ready — parser registration, MIME routing, size validation, and settings in place. User story implementation can now begin.

---

## Phase 3: User Story 1 — PDF to Chat Context (Priority: P1) 🎯 MVP

**Goal**: Users can add a PDF file as chat context. The system converts it to structured markdown (with table detection and OCR fallback for scanned PDFs) and injects it into the LLM context window within 30 seconds for documents up to 100 pages.

**Independent Test**: Upload a multi-page PDF with text, tables, and images via the chat UI. Verify the converted markdown appears in the chat context and the LLM can answer content-specific questions.

### Implementation for User Story 1

- [x] T007 [P] [US1] Create `LocalPdfParser` implementing `FileParser` interface — use `pdf-parse` for text extraction, heuristic column-alignment table detection, return `ConversionResult` with metadata (page count, word count, title) in src/tools/parsers/LocalPdfParser.ts
- [x] T008 [P] [US1] Create `OcrFallbackParser` — accept image buffers and a vision LLM callback, send pages sequentially with a dedicated OCR prompt, return structured markdown `ConversionResult` in src/tools/parsers/OcrFallbackParser.ts
- [x] T009 [US1] Register `LocalPdfParser` in `FileParserManager` for the `"pdf"` extension, **replacing** the existing `PDFParser` (Brevilabs cloud) in non-project mode. Retain Miyo self-host fallback logic inside `LocalPdfParser`. Wire OCR fallback trigger (when primary parser returns < 50 chars for multi-page document). `Docs4LLMParser` (project mode) remains untouched. In src/tools/FileParserManager.ts
- [x] T009a [P] [US1] Create `ImageParser` implementing `FileParser` — register for image extensions (`jpg`, `jpeg`, `png`, `gif`, `bmp`, `tiff`, `webp`), route directly to `OcrFallbackParser` with the user's vision LLM callback, return `ConversionResult` in src/tools/parsers/ImageParser.ts
- [x] T010 [US1] Modify `ContextProcessor` to detect non-markdown file attachments, route through `FileParserManager.parseFile()`, and wrap converted content in `<converted-document source="..." type="..." pages="..." words="...">` XML tags in src/contextProcessor.ts
- [x] T011 [US1] Extend `PDFCache` in-place (no rename) to support multi-format cache keys — change cache key from PDF-only hash to `{fileHash}:{formatId}` composite key, supporting all `SupportedFormat` values. Add invalidation on file hash change. In src/cache/pdfCache.ts

### Tests for User Story 1

- [x] T012 [P] [US1] Unit tests for `LocalPdfParser` — text extraction, table detection, empty/scanned PDF handling, metadata accuracy in src/tools/parsers/LocalPdfParser.test.ts
- [x] T013 [P] [US1] Unit tests for `OcrFallbackParser` — mock vision LLM callback, verify structured markdown output, error handling for LLM failures in src/tools/parsers/OcrFallbackParser.test.ts

**Checkpoint**: PDF-to-chat-context works end-to-end. Scanned PDFs trigger OCR. Results are cached. This is the MVP.

---

## Phase 4: User Story 2 — Office Documents to Chat Context (Priority: P2)

**Goal**: Users can add DOCX, PPTX, and XLSX files as chat context. Each format preserves its native structure (heading hierarchy, slide boundaries, table layout) in the converted markdown.

**Independent Test**: Add a DOCX with headings/lists, a PPTX with multiple slides, and an XLSX with a data table as separate chat contexts. Verify each renders as readable, structured markdown.

### Implementation for User Story 2

- [x] T014 [P] [US2] Create `DocxParser` implementing `FileParser` — use `mammoth` with custom style mapping for headings → markdown headings, lists → markdown lists, bold/italic → markdown formatting, return `ConversionResult` in src/tools/parsers/DocxParser.ts
- [x] T015 [P] [US2] Create `PptxParser` implementing `FileParser` — parse PPTX ZIP, extract slide XML, convert text runs to markdown with `## Slide N` separators, handle speaker notes as blockquotes, return `ConversionResult` in src/tools/parsers/PptxParser.ts
- [x] T016 [P] [US2] Create `XlsxParser` implementing `FileParser` — use `xlsx` library to read workbook, convert each sheet to markdown table with `## Sheet: Name` separators, return `ConversionResult`. Also handle `.csv` and `.tsv` files via the same parser (SheetJS reads these natively). In src/tools/parsers/XlsxParser.ts
- [x] T017 [US2] Register `DocxParser`, `PptxParser`, and `XlsxParser` in `FileParserManager` with their respective extension mappings: `docx`/`doc` → DocxParser, `pptx`/`ppt` → PptxParser, `xlsx`/`xls`/`csv`/`tsv` → XlsxParser. In src/tools/FileParserManager.ts

### Tests for User Story 2

- [x] T018 [P] [US2] Unit tests for `DocxParser` — heading hierarchy preservation, list formatting, bold/italic, empty document handling in src/tools/parsers/DocxParser.test.ts
- [x] T019 [P] [US2] Unit tests for `PptxParser` — multi-slide extraction, slide title detection, speaker notes, empty slides in src/tools/parsers/PptxParser.test.ts
- [x] T020 [P] [US2] Unit tests for `XlsxParser` — single/multi-sheet handling, markdown table formatting, CSV input support, TSV input support, empty spreadsheet in src/tools/parsers/XlsxParser.test.ts

**Checkpoint**: DOCX, PPTX, and XLSX files convert to structured markdown and appear in chat context alongside PDF support.

---

## Phase 5: User Story 3 — EPUB Books to Chat Context (Priority: P3)

**Goal**: Users can add an EPUB book as chat context. Chapter structure is preserved as markdown headings, allowing focused conversation about book content.

**Independent Test**: Add an EPUB with multiple chapters as chat context. Verify chapters appear as separate sections with appropriate heading levels and no HTML artifacts.

### Implementation for User Story 3

- [x] T021 [P] [US3] Create `EpubParser` implementing `FileParser` — parse EPUB ZIP structure, extract chapter headings and content as markdown, strip HTML artifacts and encoding issues, return `ConversionResult` in src/tools/parsers/EpubParser.ts
- [x] T022 [US3] Register `EpubParser` in `FileParserManager` with MIME type mapping for `application/epub+zip` in src/tools/FileParserManager.ts

### Tests for User Story 3

- [x] T023 [P] [US3] Unit tests for `EpubParser` — chapter structure extraction, HTML stripping, encoding handling, empty EPUB handling in src/tools/parsers/EpubParser.test.ts

**Checkpoint**: EPUB books convert to structured markdown with chapter headings. All 5 supported formats (PDF, DOCX, PPTX, XLSX, EPUB) now work.

---

## Phase 6: User Story 4 — Save Conversion to Vault (Priority: P4)

**Goal**: Users can persist a converted document as a markdown note in their vault with frontmatter metadata, stored in a configurable output folder for later search and reference.

**Independent Test**: Convert a PDF, opt to save to vault. Verify a .md file appears in the configured output folder with the document's content and frontmatter (title, source filename, conversion date, format).

### Implementation for User Story 4

- [x] T024 [US4] Extend `saveConvertedDocOutput()` to accept `ConversionMetadata` and generate frontmatter (source filename, source format, conversion date, page count, word count, OCR used) in src/utils/convertedDocOutput.ts
- [x] T025 [US4] Add default output folder handling — when no `convertedDocOutputFolder` is configured, use `Converted Documents/` at vault root in src/utils/convertedDocOutput.ts
- [x] T026 [US4] Wire save-to-vault trigger from `ContextProcessor` or chat UI when user opts in, passing `ConversionResult.metadata` to the save function in src/contextProcessor.ts

**Checkpoint**: Converted documents can be saved to vault with full frontmatter metadata. All 4 user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, error handling refinement, and validation across all user stories

- [x] T027 [P] Update user-facing documentation for document conversion feature (supported formats, settings, usage) in docs/
- [x] T028 [P] Validate error contract — verify all `ConversionErrorCode` cases (`unsupported_format`, `file_too_large`, `password_protected`, `corrupt_file`, `ocr_failed`, `timeout`, `parse_error`) surface user-friendly messages via chat error display
- [x] T029 Run quickstart.md verification checklist — confirm all 14 verification items pass end-to-end
- [x] T030 Performance and accuracy validation — measure: (a) conversion time for 100-page PDF (target: < 30s per SC-001), (b) table accuracy spot-check (target: ≥ 90% per SC-002), (c) OCR accuracy on sample scanned English documents (target: ≥ 90% per SC-003)
- [x] T031 [P] Network audit for self-hosted guarantee (SC-005) — run local-only conversions (all formats) while monitoring outbound network traffic, verify zero third-party API calls during conversion (only user-configured LLM endpoint permitted for OCR)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Phase 2 completion
- **User Story 2 (Phase 4)**: Depends on Phase 2 completion — can run in parallel with US1
- **User Story 3 (Phase 5)**: Depends on Phase 2 completion — can run in parallel with US1/US2
- **User Story 4 (Phase 6)**: Depends on at least one parser being complete (Phase 3 recommended)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Independent after Phase 2 — no dependencies on other stories. **Recommended MVP scope.**
- **US2 (P2)**: Independent after Phase 2 — no dependencies on US1. Parsers are standalone.
- **US3 (P3)**: Independent after Phase 2 — no dependencies on US1/US2.
- **US4 (P4)**: Requires at least one parser to produce `ConversionResult` with metadata. Best after US1.

### Within Each User Story

- Parser implementation before FileParserManager registration
- Registration before ContextProcessor integration (US1 only — subsequent stories reuse the pipeline)
- Core implementation before tests (tests validate the implementation)
- Commit after each task or logical group

### Parallel Opportunities

**Phase 1**: T002 and T003 can run in parallel (after T001)
**Phase 2**: T005 runs in parallel with T004/T006
**Phase 3**: T007 and T008 run in parallel; T012 and T013 run in parallel
**Phase 4**: T014, T015, T016 all run in parallel; T018, T019, T020 all run in parallel
**Phase 5**: T021 and T023 run in parallel (parser + tests for same format)
**Cross-story**: Once Phase 2 is complete, US1, US2, and US3 can all proceed in parallel

---

## Parallel Example: User Story 2

```bash
# Launch all three parsers in parallel (different files, no dependencies):
Task T014: "Create DocxParser in src/tools/parsers/DocxParser.ts"
Task T015: "Create PptxParser in src/tools/parsers/PptxParser.ts"
Task T016: "Create XlsxParser in src/tools/parsers/XlsxParser.ts"

# After all three complete, register them:
Task T017: "Register parsers in FileParserManager"

# Launch all three test files in parallel:
Task T018: "Unit tests for DocxParser"
Task T019: "Unit tests for PptxParser"
Task T020: "Unit tests for XlsxParser"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (install deps, create types)
2. Complete Phase 2: Foundational (extend FileParserManager, add settings)
3. Complete Phase 3: User Story 1 (LocalPdfParser + OCR + context integration)
4. **STOP and VALIDATE**: Test PDF conversion end-to-end via chat UI
5. Deploy if ready — PDF support alone delivers significant value

### Incremental Delivery

1. Setup + Foundational → Infrastructure ready
2. Add US1 (PDF) → Test independently → **MVP!** (SC-001, SC-003, SC-005)
3. Add US2 (Office) → Test independently → SC-004 achieved (5 formats)
4. Add US3 (EPUB) → Test independently → Full format coverage
5. Add US4 (Save to vault) → Test independently → Persistence workflow complete
6. Polish → Docs, error messages, performance validation

### Key Files Summary

| File                                     | Action   | Phase      |
| ---------------------------------------- | -------- | ---------- |
| `src/tools/parsers/conversionTypes.ts`   | NEW      | 1          |
| `src/tools/FileParserManager.ts`         | MODIFIED | 2, 3, 4, 5 |
| `src/settings/model.ts`                  | MODIFIED | 2          |
| `src/tools/parsers/LocalPdfParser.ts`    | NEW      | 3          |
| `src/tools/parsers/OcrFallbackParser.ts` | NEW      | 3          |
| `src/tools/parsers/ImageParser.ts`       | NEW      | 3          |
| `src/contextProcessor.ts`                | MODIFIED | 3, 6       |
| `src/cache/pdfCache.ts`                  | MODIFIED | 3          |
| `src/tools/parsers/DocxParser.ts`        | NEW      | 4          |
| `src/tools/parsers/PptxParser.ts`        | NEW      | 4          |
| `src/tools/parsers/XlsxParser.ts`        | NEW      | 4          |
| `src/tools/parsers/EpubParser.ts`        | NEW      | 5          |
| `src/utils/convertedDocOutput.ts`        | MODIFIED | 6          |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable after Phase 2
- The existing `Docs4LLMParser` (cloud/Brevilabs) remains untouched in project mode — `LocalPdfParser` replaces `PDFParser` in non-project mode only
- OCR fallback uses the user's existing vision-capable LLM — no new Tesseract dependency
- All new parsers follow the "buffer in → markdown out" pattern for testability (no singleton dependencies)
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
