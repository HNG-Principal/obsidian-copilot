# Research Decisions: Composer & Note Editing

**Feature**: `007-composer-note-editing` | **Date**: 2026-04-08

---

## 1. Edit Representation Format

**Decision**: Discriminated union of edit operations — `replace`, `insert`, `delete`, `create`, `rename`. Each operation targets a specific file and location.

**Rationale**: The LLM needs a structured way to express edits. A discriminated union gives type safety and clear semantics for each operation kind. This aligns with how existing `editFileTool` works (old text → new text replacement) while extending it with additional operation types.

**Alternatives Considered**:

- **Unified diff format**: Rejected — difficult for LLMs to generate correctly. Format is fragile with exact line counting.
- **Line-number based edits**: Considered — simpler but brittle (line numbers shift as edits are applied). Better for sequential application.
- **Full file replacement**: Rejected — wasteful for small edits, makes diff preview meaningless for large files.
- **AST-level edits**: Rejected — requires language-specific parsers. Content-agnostic approach is more generalizable.

**Implementation Approach**:

- `EditOperation` discriminated union with `kind` field
- `replace`: `{ kind: 'replace', filePath: string, oldText: string, newText: string }`
- `insert`: `{ kind: 'insert', filePath: string, position: 'beginning' | 'end' | { after: string }, text: string }`
- `delete`: `{ kind: 'delete', filePath: string, text: string }`
- `create`: `{ kind: 'create', filePath: string, content: string }`
- `rename`: `{ kind: 'rename', oldPath: string, newPath: string }`
- `EditPlan`: `{ operations: EditOperation[], description: string }`

---

## 2. Diff Preview Strategy

**Decision**: Extend existing `ApplyView` and `DiffView` components to support multi-file edit plans with a file-by-file diff preview.

**Rationale**: The existing composer already has a working diff preview for single-file edits. Multi-file support is a natural extension with a file selector/tabs. Reusing existing components avoids reinventing the diff engine.

**Alternatives Considered**:

- **Build new diff UI from scratch**: Rejected — existing ApplyView is functional and tested.
- **Monaco diff editor**: Rejected — too heavy, would significantly increase bundle size.
- **Text-only diff (no visual preview)**: Rejected — visual diff is essential for user trust.
- **Side-by-side diff**: Considered for v2 — inline diff (existing) is sufficient for v1.

**Implementation Approach**:

- `ApplyViewRoot.tsx`: Add file list/tabs when edit plan has multiple files
- Each file shows its own diff view
- Accept/Reject per file or all-at-once
- Streaming: show diffs as they arrive (per-file completion)
- File status badges: pending, previewing, accepted, rejected

---

## 3. Undo Strategy

**Decision**: Snapshot-based undo with in-memory storage for the current session. Each edit plan creates a snapshot of all affected files before applying changes.

**Rationale**: Full-file snapshots are simple and reliable. They guarantee exact restoration regardless of the edit complexity. In-memory storage is sufficient because undo is primarily a session-level concern. Obsidian's own undo stack handles character-level edits within the editor.

**Alternatives Considered**:

- **Reverse operation computation**: Rejected — complex to compute reliably for all edit types (especially deletes where content must be preserved).
- **Obsidian-native undo only**: Insufficient — Obsidian's undo stack doesn't track multi-file atomic operations.
- **Git-style diff storage**: Overkill — snapshot storage is simpler and files are typically small (KB-range markdown).
- **Persistent undo (disk)**: Deferred to v2 — useful but not essential for v1.

**Implementation Approach**:

- `UndoManager` stores snapshots in memory: `Stack<UndoSnapshot>`
- `UndoSnapshot`: `{ id, timestamp, description, files: Map<filePath, originalContent> }`
- Before applying an edit plan: `undoManager.createSnapshot(editPlan)`
- Undo: restore all files from snapshot
- Stack depth limit: configurable (default 20 snapshots)
- Memory efficient: only stores affected files, not entire vault

---

## 4. Multi-File Atomic Edits

**Decision**: Apply all operations in an edit plan atomically — if one file operation fails, roll back all changes.

**Rationale**: Partial edits (some files changed, others not) leave the vault in an inconsistent state. The LLM's edit plan assumes all changes are applied together. Rollback on failure ensures consistency.

**Alternatives Considered**:

- **Best-effort (apply what succeeds)**: Rejected — inconsistent state is worse than no changes.
- **Per-file confirmation**: Rejected for default — slows down the workflow. Available as optional mode.
- **Two-phase commit**: Overkill — writing to local files is fast enough for sequential apply + rollback.

**Implementation Approach**:

- `editExecutor.applyPlan(plan)`:
  1. Create undo snapshot of all affected files
  2. Apply operations sequentially
  3. If any operation fails: restore from snapshot
  4. Return success/failure result with details
- File operations via Obsidian's `app.vault.modify()` and `app.vault.create()`

---

## 5. Streaming Edit Preview

**Decision**: Stream edit operations to the preview as the LLM generates them, showing progressive diffs.

**Rationale**: Long edit plans may take several seconds to generate. Showing diffs as they arrive improves perceived performance and lets users start reviewing early.

**Alternatives Considered**:

- **Wait for complete plan**: Simplest — but poor UX for multi-file edits.
- **Show progress indicator only**: Rejected — wastes the time the user could be reviewing.
- **Stream character-by-character**: Rejected — too noisy. Per-operation granularity is the right level.

**Implementation Approach**:

- LLM streams tool calls with edit operations
- Each complete operation is parsed and a diff computed immediately
- `ApplyView` renders completed diffs while remaining operations stream
- Final "Apply All" button enabled only after all operations arrive
- Per-file "Preview Ready" indicator

---

## 6. Selection-Based Editing

**Decision**: Reuse existing `chatSelectionHighlightController` to capture selected text, send as context to LLM, and scope edits to the selection region.

**Rationale**: The existing selection highlighting infrastructure (`src/editor/`) already captures user selections and sends them to the chat. Extending this to scope edit operations to the selection is a natural evolution.

**Alternatives Considered**:

- **New selection mechanism**: Rejected — existing mechanism is functional and tested.
- **Full-file edits only (no selection)**: Rejected — users expect to be able to say "edit this paragraph."
- **Line-range scoping**: Considered — but content-based matching (existing editFileTool pattern) is more robust across minor content changes.

**Implementation Approach**:

- Selected text included in context as `<selected-text>` content
- LLM generates `replace` operations targeting the selected text
- `editPlanner` validates that `oldText` in replace operations exists in the file
- Selection highlight cleared after edit applied/rejected
