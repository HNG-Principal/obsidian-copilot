# Interface Contracts: Composer & Note Editing

**Feature**: `007-composer-note-editing` | **Date**: 2026-04-08

---

## Core Interfaces

### IEditPlanner

```typescript
interface IEditPlanner {
  /**
   * Validate that all operations in a plan can be applied.
   * Checks file existence, oldText matching, etc.
   */
  validatePlan(plan: EditPlan): Promise<ValidationResult>;

  /**
   * Compute the diff preview for each file in the plan.
   * Pure computation — does not modify files.
   */
  computeDiffs(plan: EditPlan): Promise<FileDiff[]>;
}

interface ValidationResult {
  valid: boolean;
  errors: Array<{ operationIndex: number; message: string }>;
}

interface FileDiff {
  filePath: string;
  originalContent: string;
  newContent: string;
  operations: EditOperation[];
}
```

### IEditExecutor

```typescript
interface IEditExecutor {
  /**
   * Apply an edit plan to the vault.
   * Creates undo snapshot before applying.
   * Rolls back all changes if any operation fails.
   */
  applyPlan(plan: EditPlan): Promise<EditResult>;
}
```

### IUndoManager

```typescript
interface IUndoManager {
  /**
   * Create a snapshot of all files affected by the plan.
   */
  createSnapshot(plan: EditPlan, description: string): Promise<UndoSnapshot>;

  /**
   * Undo the most recent edit by restoring from snapshot.
   */
  undo(): Promise<UndoSnapshot | undefined>;

  /**
   * Check if there are any snapshots available to undo.
   */
  canUndo(): boolean;

  /**
   * Get the description of the most recent undoable edit.
   */
  peekDescription(): string | undefined;

  /**
   * Clear all undo snapshots (e.g., on session end).
   */
  clear(): void;
}
```

---

## Pure Function Type Contracts

### Apply Operation to Text

```typescript
/**
 * Apply a single edit operation to file content.
 * Pure function: input text + operation → output text.
 * Throws if operation cannot be applied (e.g., oldText not found).
 */
type ApplyOperation = (content: string, operation: EditOperation) => string;
```

### Compute File Operations

```typescript
/**
 * Group edit operations by file path for batch application.
 */
type GroupOperationsByFile = (operations: EditOperation[]) => Map<string, EditOperation[]>;
```

### Generate Diff Display

Diff rendering is handled by the existing `diff` library (`diffTrimmedLines`, `diffArrays`) already used in `ApplyView.tsx`. The `ApplyViewRoot` component's sub-components (`SideBySideBlock`, `SplitBlock`, `DiffCell`, `WordDiffSpan`) consume the library output directly. No custom `GenerateDiff` function is needed.

---

## Settings Contract

New settings in `CopilotSettings`:

| Setting            | Type     | Default | Range | Description                |
| ------------------ | -------- | ------- | ----- | -------------------------- |
| `maxUndoSnapshots` | `number` | `20`    | 5–50  | Maximum undo history depth |

Existing settings/components reused:

- `ComposerTools.ts` — `editFileTool`, `writeFileTool` (modified to use EditPlanner)
- `ApplyView.tsx` — contains `ApplyView` class + `ApplyViewRoot` React component (diff preview UI, extended for EditPlan support)

---

## Tool Contracts

### editFileTool (Modified)

```typescript
// Existing tool signature preserved
{
  name: "edit_file",
  description: "Edit an existing file by replacing text",
  parameters: {
    filePath: string,
    oldText: string,
    newText: string
  }
}
// Internal: wraps into EditPlan with single replace operation
// Routes through EditPlanner → diff preview → user accept/reject
```

### writeFileTool (Modified)

```typescript
// Existing tool signature preserved
{
  name: "write_file",
  description: "Create a new file or overwrite existing",
  parameters: {
    filePath: string,
    content: string
  }
}
// Internal: wraps into EditPlan with create/replace operation
// Routes through EditPlanner → diff preview → user accept/reject
```

---

## Event Hooks

| Hook                | Trigger                               | Handler                                        |
| ------------------- | ------------------------------------- | ---------------------------------------------- |
| Edit tool called    | LLM generates edit/write tool call    | `ComposerTools` → `EditPlanner.computeDiffs()` |
| Edit plan previewed | Diff computed                         | `ApplyView` renders multi-file diff            |
| Edit accepted       | User clicks Accept                    | `EditExecutor.applyPlan()`                     |
| Edit rejected       | User clicks Reject                    | Discard plan, no file changes                  |
| Undo triggered      | User clicks Undo or keyboard shortcut | `UndoManager.undo()`                           |
| Session ended       | Chat cleared or plugin unloaded       | `UndoManager.clear()`                          |
