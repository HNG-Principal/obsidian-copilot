# Data Model: Long-Term Memory

**Feature**: 009-long-term-memory  
**Date**: 2026-04-08

## Entities

### Memory

The core storage unit for a single extracted fact or insight.

| Field         | Type             | Required | Description                                                            |
| ------------- | ---------------- | -------- | ---------------------------------------------------------------------- |
| `id`          | `string`         | Yes      | UUID v4, unique identifier                                             |
| `content`     | `string`         | Yes      | The extracted fact/insight (1-3 sentences, bullet-point normalized)    |
| `category`    | `MemoryCategory` | Yes      | Semantic label: `"preference"`, `"fact"`, `"instruction"`, `"context"` |
| `projectTag`  | `string \| null` | No       | Project ID when memory was created; `null` for non-project chats       |
| `embedding`   | `number[]`       | Yes      | Dense vector from configured embedding model                           |
| `createdAt`   | `number`         | Yes      | Unix timestamp (ms) of first extraction                                |
| `updatedAt`   | `number`         | Yes      | Unix timestamp (ms) of last update                                     |
| `accessCount` | `number`         | Yes      | Count of times retrieved for prompt injection                          |
| `sensitive`   | `boolean`        | Yes      | User-controlled sensitive flag; excluded from retrieval when `true`    |
| `source`      | `MemorySource`   | Yes      | Provenance metadata                                                    |

### MemorySource

Provenance tracking for a memory entry.

| Field                 | Type                 | Required | Description                                                        |
| --------------------- | -------------------- | -------- | ------------------------------------------------------------------ |
| `type`                | `"auto" \| "manual"` | Yes      | `"auto"` = extracted by LLM; `"manual"` = explicitly saved by user |
| `conversationSnippet` | `string \| null`     | No       | Abbreviated context from originating conversation (≤100 chars)     |

### MemoryCategory (enum)

```typescript
type MemoryCategory = "preference" | "fact" | "instruction" | "context";
```

| Value         | Description                               | Example                                                        |
| ------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `preference`  | User preference or personal choice        | "Prefers TypeScript over JavaScript"                           |
| `fact`        | Factual statement about user's domain     | "Uses Obsidian for PhD research notes"                         |
| `instruction` | Behavioral directive for the AI           | "Always respond in Portuguese when discussing personal topics" |
| `context`     | Background context about user's situation | "Currently migrating from Notion to Obsidian"                  |

### MemoryRetrievalResult

Result of a semantic memory search, extending `Memory` with scoring.

| Field             | Type     | Required | Description                          |
| ----------------- | -------- | -------- | ------------------------------------ |
| `memory`          | `Memory` | Yes      | The matched memory entry             |
| `similarityScore` | `number` | Yes      | Cosine similarity to query (0.0-1.0) |
| `rank`            | `number` | Yes      | 1-based position in result set       |

### MemoryStore (persistent structure)

The on-disk JSON schema at `.copilot/long-term-memory.json`.

| Field            | Type       | Description                                                |
| ---------------- | ---------- | ---------------------------------------------------------- |
| `version`        | `number`   | Schema version for future migrations (starts at `1`)       |
| `embeddingModel` | `string`   | Model ID used for embeddings; triggers re-embed if changed |
| `memories`       | `Memory[]` | Array of all memory entries                                |
| `lastUpdated`    | `number`   | Unix timestamp of last file write                          |

## Relationships

```
Memory *──1 MemorySource      (each memory has one source)
Memory *──1 MemoryCategory    (each memory has one category)
Memory *──0..1 Project        (optional project tag, references ProjectConfig.id)
MemoryStore 1──* Memory       (store contains all memories)
MemoryRetrievalResult 1──1 Memory  (wraps a memory with score)
```

## Validation Rules

1. **Memory.content**: Non-empty string, max 500 characters. LLM extraction prompt enforces brevity.
2. **Memory.id**: UUID v4 format. Generated at creation, immutable.
3. **Memory.embedding**: Non-empty float array. Length must match configured embedding model's dimension.
4. **Memory.category**: Must be one of the 4 defined `MemoryCategory` values.
5. **Memory.projectTag**: When non-null, must correspond to a valid `ProjectConfig.id` (soft reference — not enforced at storage level since projects can be deleted).
6. **MemoryStore.version**: Must equal current schema version (`1`). If mismatch, run migration.
7. **MemoryStore.embeddingModel**: If changed from current setting, all embeddings must be recomputed before retrieval.
8. **MemoryRetrievalResult.similarityScore**: Must be between 0.0 and 1.0 inclusive.

## State Transitions

### Memory Lifecycle

```
[Created] → extracted by LLM or saved manually
    │
    ├─→ [Active] → included in retrieval results
    │       │
    │       ├─→ [Updated] → content/category modified (updatedAt refreshed)
    │       │       └─→ returns to [Active]
    │       │
    │       ├─→ [Sensitive] → user sets sensitive=true → excluded from retrieval
    │       │       └─→ [Active] if user clears flag
    │       │
    │       └─→ [Deleted] → user deletes from management UI → removed from store
    │
    └─→ [Deduplicated] → merged into existing memory during extraction
            └─→ existing memory [Updated], new entry discarded
```

### Embedding Invalidation

```
[Valid Embeddings] → embeddingModel unchanged, embeddings present
    │
    └─→ [Invalid] → user changes embedding provider in settings
            │
            └─→ [Re-embedding] → background re-computation of all memory embeddings
                    │
                    └─→ [Valid Embeddings] → retrieval re-enabled
```

## Indexes & Access Patterns

| Access Pattern              | Frequency                  | Method                                              |
| --------------------------- | -------------------------- | --------------------------------------------------- |
| Semantic retrieval by query | Every chat turn            | Cosine similarity over all non-sensitive embeddings |
| Filter by project tag       | Every chat turn (optional) | Linear scan before similarity (small dataset)       |
| Full list for UI            | On management modal open   | Load all from store                                 |
| Single memory update        | On user edit in UI         | By `id` lookup                                      |
| Batch dedup check           | On extraction              | LLM-assisted with full memory list as context       |
| Count for limit enforcement | On extraction              | Array length check                                  |
