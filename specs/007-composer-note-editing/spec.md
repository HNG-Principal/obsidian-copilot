# Feature Specification: Composer (In-Chat Note Editing)

**Feature Branch**: `007-composer-note-editing`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "Composer in-chat note editing that enables users to edit vault notes from the chat interface using natural language, with diff preview, targeted edits, full rewrites, frontmatter updates, and single-action undo"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Natural Language Note Editing with Diff Preview (Priority: P1)

A user has a messy meeting notes file and asks the AI in chat to "clean up and organize my meeting notes from today, add proper headings and action items." The AI reads the note, generates proposed edits, and shows a diff preview in the chat (additions in green, removals in red). The user reviews the changes and clicks "Apply" to update the note.

**Why this priority**: The review-then-apply flow is the core interaction pattern. It ensures user trust and control — no changes happen without explicit approval. This is the minimum viable Composer experience.

**Independent Test**: Open a note, give a natural language editing instruction in chat, verify a diff preview appears, click Apply, verify the note is updated correctly.

**Acceptance Scenarios**:

1. **Given** a user references a note and provides an editing instruction, **When** the AI processes the request, **Then** a diff preview showing proposed changes is displayed in the chat within 10 seconds.
2. **Given** a diff preview is displayed, **When** the user clicks "Apply", **Then** the changes are applied to the note and the note content matches the preview exactly.
3. **Given** a diff preview is displayed, **When** the user clicks "Reject", **Then** no changes are made to the note and the user can refine their instruction.
4. **Given** the AI proposes changes, **When** the diff is displayed, **Then** unchanged content is preserved exactly (no unintended modifications).

---

### User Story 2 - Undo Applied Changes (Priority: P2)

After applying Composer edits, the user realizes the changes aren't quite right. They click an "Undo" button (available in the chat message where the edit was applied), and the note is restored to its exact pre-edit state.

**Why this priority**: Undo is the safety net that makes users comfortable using Composer. Without easy undo, users will be reluctant to apply AI-generated edits to their notes.

**Independent Test**: Apply a Composer edit, verify the note changed, click Undo, verify the note is restored to its exact previous state.

**Acceptance Scenarios**:

1. **Given** a Composer edit has been applied, **When** the user clicks "Undo", **Then** the note is restored to its exact content before the edit was applied.
2. **Given** multiple sequential Composer edits have been applied, **When** the user clicks "Undo" on the most recent edit, **Then** only that edit is undone (previous edits remain).
3. **Given** the user has manually edited the note after a Composer edit, **When** they click "Undo" on the Composer edit, **Then** the system warns that manual changes may be lost.

---

### User Story 3 - Insert New Content at a Specific Location (Priority: P3)

A user asks the AI to "add a Resources section with links after the Conclusion heading in my project plan." The AI identifies the target location, generates the new content, and shows a preview of the insertion. The user can see exactly where the content will be added before approving.

**Why this priority**: Content insertion is a distinct operation from editing existing text. Users frequently want to add sections, paragraphs, or lists to existing notes without modifying what's already there.

**Independent Test**: Reference a note with multiple headings. Ask to insert content after a specific heading. Verify the content is added at the correct location without modifying surrounding content.

**Acceptance Scenarios**:

1. **Given** a note with defined headings, **When** the user asks to insert content after a specific heading, **Then** the new content is inserted at the correct location.
2. **Given** the requested insertion point is ambiguous, **When** the AI cannot determine the exact location, **Then** the preview shows where it plans to insert and the user can correct it.

---

### User Story 4 - Frontmatter Updates (Priority: P4)

A user asks the AI to "add tags for 'project-management' and 'quarterly-review' to this note" or "update the status to 'completed' in the frontmatter." The AI modifies only the YAML frontmatter, preserving its formatting and all existing fields, and shows the changes in the diff preview.

**Why this priority**: Frontmatter manipulation (tags, status, categories) is a common request. It requires special handling to preserve YAML formatting, making it a separate concern from body text editing.

**Independent Test**: Edit frontmatter via Composer — add a tag, update a field. Verify the YAML remains valid and all existing fields are preserved.

**Acceptance Scenarios**:

1. **Given** a note with existing YAML frontmatter, **When** the user asks to add a tag, **Then** the tag is added and the YAML formatting remains valid.
2. **Given** a note without frontmatter, **When** the user asks to add frontmatter fields, **Then** valid YAML frontmatter is created at the top of the note.
3. **Given** a frontmatter edit, **When** the diff is displayed, **Then** only the frontmatter section shows changes — the body content is untouched.

---

### Edge Cases

- What happens when the referenced note doesn't exist or the path is wrong?
- How does the system handle concurrent edits (user editing the same note in the editor while Composer applies changes)?
- What happens when the AI's proposed edit creates invalid markdown or broken links?
- How are very large notes (>50KB) handled — can the AI process the entire note content?
- What happens when the user's edit instruction is too vague (e.g., "make it better")?
- How does the system handle notes with complex formatting (tables, embedded images, code blocks)?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST support targeted text edits (replace specific sections of a note while preserving all other content).
- **FR-002**: System MUST support full note rewrites (replace the entire note body when the user requests a complete reorganization).
- **FR-003**: System MUST support content insertion at specific locations within a note (after a heading, at the beginning, at the end).
- **FR-004**: System MUST support YAML frontmatter edits (add/update/remove fields) while preserving valid YAML formatting.
- **FR-005**: System MUST display a visual diff preview (additions highlighted, removals highlighted) in the chat before any changes are applied.
- **FR-006**: System MUST support explicit Accept/Reject actions for proposed changes — no edits are applied without user confirmation.
- **FR-007**: System MUST support single-action undo that restores the note to its exact pre-edit state.
- **FR-008**: System MUST preserve all unchanged content exactly — no unintended whitespace changes, formatting shifts, or content modifications.
- **FR-009**: System MUST support referencing notes by title, path, or active editor context.

### Key Entities

- **EditOperation**: A proposed change to a note. Key attributes: target note (path), operation type (targeted edit / full rewrite / insert / frontmatter edit), original content snapshot, proposed content, diff representation.
- **UndoSnapshot**: A saved state for undo purposes. Key attributes: target note path, content before edit, timestamp, associated chat message ID.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Diff previews accurately reflect all proposed changes — what the user sees in the preview is exactly what gets applied.
- **SC-002**: Targeted edits preserve unchanged content with zero unintended modifications (verified against a test set of 20 notes with varied formatting).
- **SC-003**: Undo restores notes to their exact pre-edit state 100% of the time.
- **SC-004**: Frontmatter edits produce valid YAML that can be parsed by Obsidian without errors.
- **SC-005**: Users can complete an edit flow (instruction → preview → apply) in under 15 seconds for typical editing requests.

## Assumptions

- The Composer operates on one note at a time — batch editing across multiple notes is out of scope for v1.
- The user must reference a specific note (by title, path, or having it open in the editor) — the Composer does not guess which note to edit.
- Undo snapshots are stored in memory for the current session. They do not persist across Obsidian restarts.
- The diff preview format follows standard red/green diff conventions and is rendered in the chat message area.
- The AI can read the full content of notes up to a reasonable size limit (the embedding context window limit of the configured LLM).
