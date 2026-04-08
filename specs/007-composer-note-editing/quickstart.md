# Quickstart: Composer & Note Editing

**Feature**: `007-composer-note-editing` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: Edit Types and Pure Logic

Define types and pure functions:

- `EditOperation` discriminated union (replace, insert, delete, create, rename)
- `EditPlan`, `EditPlanStatus`, `EditResult`, `UndoSnapshot`
- `applyOperation(content, operation): string` — pure function for single operation application
- `groupOperationsByFile(operations): Map<string, EditOperation[]>`
- Unit tests for each operation kind (replace matches text, insert at position, delete removes text)

### Step 2: Edit Planner

Create `src/core/editPlanner.ts`:

- `validatePlan(plan)`: check file existence, oldText matching, path validity
- `computeDiffs(plan)`: apply operations to current file content, produce FileDiff[]
- Each FileDiff contains originalContent, newContent, and the operations
- Unit tests with mock file content

### Step 3: Undo Manager

Create `src/core/undoManager.ts`:

- Stack-based snapshot storage (in-memory)
- `createSnapshot(plan)`: read affected files, store content
- `undo()`: restore files from top snapshot
- `canUndo()` / `peekDescription()`: stack inspection
- `clear()`: empty the stack
- Configurable `maxUndoSnapshots` limit (drop oldest when exceeded)
- Unit tests with mock vault operations

### Step 4: Edit Executor

Create `src/core/editExecutor.ts`:

- `applyPlan(plan)`: atomic multi-file edit application
  1. Validate plan via EditPlanner
  2. Create undo snapshot via UndoManager
  3. Apply operations sequentially per file
  4. On failure: restore from snapshot (rollback)
  5. Return EditResult with status
- Uses Obsidian `app.vault.modify()` / `app.vault.create()` / `app.vault.rename()`
- Unit tests with mock vault

### Step 5: Wire Composer Tools

Modify `src/tools/ComposerTools.ts`:

- `editFileTool`: wrap into single-operation EditPlan, route through EditPlanner
- `writeFileTool`: wrap into create/replace EditPlan
- Multi-operation support: LLM can generate multiple edit tool calls forming one plan
- Preserve existing tool signatures for backwards compatibility

### Step 6: Multi-File Diff Preview

Modify `src/components/composer/ApplyViewRoot.tsx`:

- File tabs/list when edit plan affects multiple files
- Per-file diff view (reuse existing DiffView)
- Accept/Reject per file or all-at-once
- Streaming: show diffs as operations arrive
- Undo button in the accept toolbar

### Step 7: Settings and Integration

Modify `src/settings/model.ts`:

- Add `maxUndoSnapshots` setting

Wire undo to keyboard shortcut or command palette:

- Register Obsidian command: "Undo last Copilot edit"

---

## Prerequisites

- Existing `ComposerTools.ts` with `editFileTool` and `writeFileTool` functional
- Existing `ApplyViewRoot.tsx` and `DiffView.tsx` rendering correctly
- Existing editor integration (`chatSelectionHighlightController`) functional
- No new external dependencies required

---

## Verification Checklist

- [ ] Replace operation finds and replaces text correctly
- [ ] Insert operation places text at beginning/end/after anchor
- [ ] Delete operation removes exact text
- [ ] Create operation creates new file with content
- [ ] Rename operation renames file in vault
- [ ] Validation catches missing oldText (replace on nonexistent text)
- [ ] Validation catches nonexistent file paths
- [ ] Diff preview shows correct additions/deletions
- [ ] Multi-file edit shows file tabs in preview
- [ ] Accept applies all operations atomically
- [ ] Reject discards plan without file changes
- [ ] Failed operation triggers rollback of entire plan
- [ ] Undo restores files to pre-edit state
- [ ] Undo stack respects max depth setting
- [ ] Edit from selected text scopes to selection region
- [ ] Existing editFileTool backwards compatible
- [ ] Streaming shows progressive diffs
- [ ] All pure functions have passing unit tests

---

## Key Files Reference

| File                                             | Purpose                                    |
| ------------------------------------------------ | ------------------------------------------ |
| `src/core/editPlanner.ts`                        | Edit validation and diff computation (new) |
| `src/core/editExecutor.ts`                       | Atomic edit application (new)              |
| `src/core/undoManager.ts`                        | Undo snapshot management (new)             |
| `src/tools/ComposerTools.ts`                     | Edit/write tool integration (modified)     |
| `src/components/composer/ApplyViewRoot.tsx`      | Multi-file diff preview UI (modified)      |
| `src/components/composer/DiffView.tsx`           | Diff rendering (existing, reused)          |
| `src/editor/chatSelectionHighlightController.ts` | Selection highlighting (existing)          |
| `src/settings/model.ts`                          | Undo settings (modified)                   |
