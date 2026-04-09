# Data Model: Composer & Note Editing

**Feature**: `007-composer-note-editing` | **Date**: 2026-04-08

---

## Entities

### EditOperation (Discriminated Union)

A single edit operation to a vault note.

#### Replace

| Field      | Type        | Description                    |
| ---------- | ----------- | ------------------------------ |
| `kind`     | `'replace'` | Operation discriminant         |
| `filePath` | `string`    | Target file path               |
| `oldText`  | `string`    | Exact text to find and replace |
| `newText`  | `string`    | Replacement text               |

#### Insert

| Field      | Type                                        | Description            |
| ---------- | ------------------------------------------- | ---------------------- |
| `kind`     | `'insert'`                                  | Operation discriminant |
| `filePath` | `string`                                    | Target file path       |
| `position` | `'beginning' \| 'end' \| { after: string }` | Insert position        |
| `text`     | `string`                                    | Text to insert         |

#### Delete

| Field      | Type       | Description            |
| ---------- | ---------- | ---------------------- |
| `kind`     | `'delete'` | Operation discriminant |
| `filePath` | `string`   | Target file path       |
| `text`     | `string`   | Exact text to remove   |

#### Create

| Field      | Type       | Description            |
| ---------- | ---------- | ---------------------- |
| `kind`     | `'create'` | Operation discriminant |
| `filePath` | `string`   | New file path          |
| `content`  | `string`   | File content           |

#### Rename

| Field     | Type       | Description            |
| --------- | ---------- | ---------------------- |
| `kind`    | `'rename'` | Operation discriminant |
| `oldPath` | `string`   | Current file path      |
| `newPath` | `string`   | New file path          |

### EditPlan

A collection of edit operations to be applied atomically.

| Field           | Type              | Description                               |
| --------------- | ----------------- | ----------------------------------------- |
| `id`            | `string`          | Unique plan ID                            |
| `operations`    | `EditOperation[]` | Ordered list of operations                |
| `description`   | `string`          | Human-readable plan description           |
| `affectedFiles` | `string[]`        | Computed: unique file paths in operations |
| `status`        | `EditPlanStatus`  | Current plan status                       |

### EditPlanStatus (union type)

```typescript
type EditPlanStatus = "streaming" | "preview" | "accepted" | "rejected" | "applied" | "failed";
```

### UndoSnapshot

Pre-edit state of affected files for rollback support.

| Field         | Type                  | Description                              |
| ------------- | --------------------- | ---------------------------------------- |
| `id`          | `string`              | Unique snapshot ID                       |
| `planId`      | `string`              | Associated edit plan ID                  |
| `timestamp`   | `number`              | Creation timestamp (epoch ms)            |
| `description` | `string`              | Edit plan description                    |
| `files`       | `Map<string, string>` | File path → original content before edit |

### EditResult

Result of applying an edit plan.

| Field        | Type                                 | Description                               |
| ------------ | ------------------------------------ | ----------------------------------------- |
| `planId`     | `string`                             | Edit plan that was applied                |
| `status`     | `'success' \| 'partial' \| 'failed'` | Application outcome                       |
| `appliedOps` | `number`                             | Number of operations successfully applied |
| `totalOps`   | `number`                             | Total operations in plan                  |
| `error`      | `string \| undefined`                | Error message if failed                   |
| `snapshotId` | `string`                             | Undo snapshot ID for rollback             |

---

## Relationships

```
EditPlan      1──* EditOperation (plan → operations)
EditPlan      1──1 UndoSnapshot (plan → pre-edit snapshot)
EditPlan      1──1 EditResult (plan → application result)
UndoSnapshot  1──* FileContent (snapshot → file contents)
```

---

## Validation Rules

1. **File path**: Must be a valid vault-relative path
2. **Replace oldText**: Must exist exactly once in target file (prevents ambiguous edits)
3. **Insert after**: Anchor text must exist in target file
4. **Create filePath**: Must not already exist (use replace for existing files)
5. **Rename oldPath**: Must exist in vault
6. **Operation order**: Operations on the same file applied in sequence (later ops see results of earlier ones)
7. **Snapshot stack depth**: `stack.length ≤ maxUndoSnapshots` (configurable)

---

## State Transitions

### Edit Plan Lifecycle

```
streaming → preview → accepted → applied
                    → rejected
streaming → failed (LLM error during generation)
applied → undone (via undo manager)
```

### Per-File Edit State (within edit plan)

> **v1 Note**: v1 scope is single-note per spec assumption. The per-file state machine below applies to the single target file. Multi-file support is a future extension.

```
pending → diffing → previewed → accepted
                              → rejected
```

---

## Access Patterns

| Operation            | Frequency                    | Method                                                         |
| -------------------- | ---------------------------- | -------------------------------------------------------------- |
| Create edit plan     | Per LLM edit response        | Inline `EditPlan` construction in `ComposerTools` (T012/T013)  |
| Preview diff         | Per edit plan                | `ApplyView` component rendering (existing diff sub-components) |
| Apply edit plan      | Per user accept              | `editExecutor.applyPlan()`                                     |
| Create undo snapshot | Before each apply            | `undoManager.createSnapshot()`                                 |
| Undo last edit       | Per user undo action         | `undoManager.undo()`                                           |
| Check oldText exists | Per replace/delete operation | `editPlanner.validateOperation()`                              |
