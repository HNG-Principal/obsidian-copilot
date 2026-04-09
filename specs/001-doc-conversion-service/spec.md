# Feature Specification: Document Conversion Service

**Feature Branch**: `001-doc-conversion-service`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "Self-hosted document conversion service that converts PDF, EPUB, DOCX, PPTX, images, and other file types into markdown for chat context and vault indexing, replacing the Brevilabs backend dependency"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - PDF to Chat Context (Priority: P1)

A user is reading a research paper (PDF) and wants to ask questions about it without leaving Obsidian. They add the PDF to their chat context using the existing @-mention or +Add Context button. The system converts the PDF into structured markdown and injects it into the chat window so the user can immediately ask questions about the paper's content.

**Why this priority**: PDFs are by far the most common non-markdown file type users work with. This story validates the entire conversion pipeline end-to-end and delivers immediate, standalone value.

**Independent Test**: Upload a multi-page PDF with text, tables, and images via the chat UI. Verify the converted markdown appears in the chat context and the LLM can answer content-specific questions.

**Acceptance Scenarios**:

1. **Given** a user has a PDF file in their vault, **When** they add it as chat context, **Then** the PDF is converted to structured markdown and available for the LLM to reference within 30 seconds for documents up to 100 pages.
2. **Given** a PDF contains tables, **When** it is converted, **Then** the tables appear as markdown tables (not flattened text).
3. **Given** a scanned PDF with no selectable text, **When** it is converted, **Then** OCR extracts the text with at least 90% accuracy.

---

### User Story 2 - Office Documents to Chat Context (Priority: P2)

A user wants to discuss the contents of a Word document, PowerPoint presentation, or Excel spreadsheet within the Obsidian chat. They add the file as context and the system converts it to markdown, preserving structure (headings for DOCX, slide boundaries for PPTX, table structure for XLSX).

**Why this priority**: Office formats are the second most common file type after PDFs. Supporting them dramatically broadens the set of knowledge users can bring into their AI-assisted workflow.

**Independent Test**: Add a DOCX with headings/lists, a PPTX with multiple slides, and an XLSX with a data table as separate chat contexts. Verify each renders as readable, structured markdown.

**Acceptance Scenarios**:

1. **Given** a DOCX file with headings, lists, and bold/italic text, **When** it is converted, **Then** the markdown preserves heading hierarchy and basic formatting.
2. **Given** a PPTX file with 10 slides, **When** it is converted, **Then** each slide's content is separated by a heading indicating the slide number or title.
3. **Given** an XLSX file with a data table, **When** it is converted, **Then** the data appears as a markdown table.

---

### User Story 3 - EPUB Books to Chat Context (Priority: P3)

A user is reading an EPUB book and wants to discuss or take notes on specific chapters. They add the EPUB as context. The system extracts content while preserving chapter structure as markdown headings, allowing the user to have a focused conversation about the book.

**Why this priority**: EPUB is a niche but high-value use case for academic and avid-reader users. It rounds out the file format coverage.

**Independent Test**: Add an EPUB with multiple chapters as chat context. Verify chapters appear as separate sections with appropriate heading levels.

**Acceptance Scenarios**:

1. **Given** an EPUB file with chapter structure, **When** it is converted, **Then** chapters appear as top-level headings with content underneath.
2. **Given** an EPUB file, **When** it is converted, **Then** the full text is extracted without HTML artifacts or encoding issues.

---

### User Story 4 - Save Conversion to Vault (Priority: P4)

A user wants to persist a converted document as a markdown note in their vault so it can be indexed by vault search and referenced later. After conversion, they opt to save the result. The system writes the markdown to a configurable output folder with appropriate metadata.

**Why this priority**: Persistence is a secondary workflow that builds on the core conversion. It enables long-term reuse but is not required for the primary chat-context use case.

**Independent Test**: Convert a PDF and check the "save to vault" option. Verify a .md file appears in the configured output folder with the document's content and metadata (title, source filename, conversion date).

**Acceptance Scenarios**:

1. **Given** a user converts a document, **When** they choose to save it to the vault, **Then** a .md file is created in the user-configured output folder.
2. **Given** a saved conversion, **When** the user opens the .md file, **Then** it contains the full converted content plus frontmatter with source filename and conversion date.
3. **Given** no output folder is configured, **When** the user opts to save, **Then** the system uses a sensible default location (e.g., a "Converted Documents" folder in the vault root).

---

### Edge Cases

- What happens when a file exceeds reasonable size limits (e.g., a 500-page PDF or a 100 MB file)?
- How does the system handle password-protected or DRM-encrypted files?
- What happens when a file's MIME type does not match its extension (e.g., a .pdf that is actually a renamed .jpg)?
- How does the system handle corrupt or truncated files?
- What happens when the conversion service is unreachable (network error, service down)?
- How are files with mixed languages handled during OCR?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST accept files via the existing chat context interface (@-mention, +Add Context) and route them to the conversion service based on MIME type.
- **FR-002**: System MUST convert PDF files to structured markdown, preserving headings, paragraphs, lists, and tables.
- **FR-003**: System MUST apply OCR to scanned PDFs and image files to extract text content.
- **FR-004**: System MUST convert DOCX files to markdown, preserving heading hierarchy, lists, and basic formatting (bold, italic).
- **FR-005**: System MUST convert PPTX files to markdown, with each slide's content clearly separated.
- **FR-006**: System MUST convert XLSX/CSV files to markdown tables.
- **FR-007**: System MUST convert EPUB files to markdown, preserving chapter structure as headings.
- **FR-008**: System MUST return conversion results as structured markdown that can be injected directly into the LLM context window.
- **FR-009**: System MUST support optional persistence of converted markdown to the user's vault in a configurable output folder.
- **FR-010**: System MUST return meaningful error messages when conversion fails (unsupported format, corrupt file, timeout).
- **FR-011**: System MUST enforce a maximum file size limit to prevent resource exhaustion, with a clear error message when exceeded.
- **FR-012**: System MUST operate entirely on self-hosted infrastructure with no data sent to third-party services (except the user's own configured LLM provider for OCR fallback via vision API).

### Key Entities

- **ConversionRequest**: Represents a user's request to convert a file. Key attributes: source file reference, target format (always markdown), options (OCR toggle, save-to-vault flag, output folder).
- **ConversionResult**: The output of a conversion. Key attributes: markdown content, metadata (page count, word count, title, source filename), status (success/failure), error details if failed.
- **ConvertedDocument**: A persisted conversion saved to the vault. Key attributes: markdown file path, source filename, conversion date, original file type.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can add a PDF as chat context and ask content-specific questions within 30 seconds of initiating conversion (for documents up to 100 pages).
- **SC-002**: Table structures in PDFs and DOCX files are correctly rendered as markdown tables in 90%+ of cases.
- **SC-003**: OCR on scanned documents achieves 90%+ text accuracy for clearly printed English text.
- **SC-004**: The conversion service handles at least 5 supported file formats (PDF, DOCX, PPTX, XLSX, EPUB) at launch.
- **SC-005**: Users report zero data leaving the self-hosted infrastructure during conversion (verified by network audit).
- **SC-006**: Conversion errors surface a user-friendly message within 5 seconds (not a silent failure or generic error).

## Assumptions

- Users have a running self-hosted backend service accessible from their Obsidian instance (localhost or LAN).
- The Obsidian plugin's existing file-picker and context-attachment UI will be reused; this feature only adds the backend conversion capability and the plugin-side routing to it.
- OCR for non-Latin scripts is out of scope for v1; initial OCR targets English and major Latin-script languages.
- Password-protected and DRM-encrypted files will return an informative error rather than attempting decryption.
- The conversion service runs on a machine with sufficient resources for document processing (at least 2 GB RAM available for the service).
- Image extraction from documents (e.g., figures in PDFs) is out of scope for v1; only text and table content is converted.
