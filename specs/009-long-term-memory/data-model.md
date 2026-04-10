# Data Model: Long-Term Memory

**Feature**: 009-long-term-memory  
**Date**: 2026-04-09 (updated from 2026-04-08)

## Entities

### Memory

The core storage unit for a single extracted fact or insight.

| Field            | Type             | Required | Description                                                            |
| ---------------- | ---------------- | -------- | ---------------------------------------------------------------------- |
| `id`             | `string`         | Yes      | UUID v4, unique identifier                                             |
| `content`        | `string`         | Yes      | The extracted fact/insight (1-3 sentences, bullet-point normalized)    |
| `category`       | `MemoryCategory` | Yes      | Semantic label: `"preference"`, `"fact"`, `"instruction"`, `"context"` |
| `projectTag`     | `string \| null` | No       | Project ID when memory was created; `null` for non-project chats       |
| `embedding`      | `number[]`       | No       | Stored in separate `embeddings.jsonl` file, not inline                 |
| `createdAt`      | `number`         | Yes      | Unix timestamp (ms) of first extraction                                |
| `updatedAt`      | `number`         | Yes      | Unix timestamp (ms) of last update                                     |
| `lastAccessedAt` | `number`         | Yes      | Unix timestamp (ms) of last retrieval (for pruning score)              |
| `accessCount`    | `number`         | Yes      | Count of times retrieved for prompt injection                          |
| `sensitive`      | `boolean`        | Yes      | User-controlled sensitive flag; excluded from retrieval when `true`    |
| `deleted`        | `boolean`        | Yes      | Tombstone for soft deletion; default `false`                           |
| `source`         | `MemorySource`   | Yes      | Provenance metadata                                                    |

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

### MemoryExtractionResult

Result returned by the extraction parser for each extracted fact.

| Field             | Type             | Required | Description                                   |
| ----------------- | ---------------- | -------- | --------------------------------------------- |
| `content`         | `string`         | Yes      | The extracted fact/insight text               |
| `category`        | `MemoryCategory` | Yes      | Semantic label for the memory                 |
| `isUpdate`        | `boolean`        | Yes      | Whether this updates an existing memory       |
| `updatedMemoryId` | `string \| null` | No       | ID of existing memory to update (null if new) |

### MemoryStore (persistent structure)

Two JSONL files in `.copilot/memory/`:

**`memories.jsonl`** — one Memory record per line:

```json
{
  "id": "a1b2c3d4",
  "content": "User prefers TypeScript strict mode",
  "category": "preference",
  "projectTag": "proj-1",
  "createdAt": 1712678400000,
  "updatedAt": 1712678400000,
  "lastAccessedAt": 1712678400000,
  "accessCount": 3,
  "sensitive": false,
  "deleted": false,
  "source": { "type": "auto", "conversationSnippet": "I always use strict..." }
}
```

**`embeddings.jsonl`** — header line + one embedding per line:

```json
{"_type":"header","version":1,"model":"text-embedding-3-small","dimension":1536,"createdAt":1712678400000}
{"memoryId":"a1b2c3d4","vector":[0.0123,-0.0456,...],"createdAt":1712678400000}
```

| Field            | Type     | Description                                      |
| ---------------- | -------- | ------------------------------------------------ |
| `version`        | `number` | Schema version in header (starts at `1`)         |
| `embeddingModel` | `string` | Model ID in header; triggers re-embed if changed |
| `memories`       | JSONL    | One JSON object per line in `memories.jsonl`     |
| `embeddings`     | JSONL    | One JSON object per line in `embeddings.jsonl`   |

## Relationships

```
Memory *──1 MemorySource      (each memory has one source)
Memory *──1 MemoryCategory    (each memory has one category)
Memory *──0..1 Project        (optional project tag, references ProjectConfig.id)
Memory 1──0..1 Embedding      (1:1 in embeddings.jsonl, keyed by memoryId)
MemoryRetrievalResult 1──1 Memory  (wraps a memory with score)
```

## Validation Rules

1. **Memory.content**: Non-empty string, max 500 characters. LLM extraction prompt enforces brevity.
2. **Memory.id**: UUID v4 format. Generated at creation, immutable.
3. **Memory.embedding**: Stored in separate `embeddings.jsonl` keyed by `memoryId`. Length must match configured embedding model's dimension.
4. **Memory.category**: Must be one of the 4 defined `MemoryCategory` values.
5. **Memory.projectTag**: When non-null, must correspond to a valid `ProjectConfig.id` (soft reference — not enforced at storage level since projects can be deleted).
6. **MemoryStore header**: `model` field must match current `EmbeddingManager` model. If mismatch, queue re-embedding.
7. **Max store size**: 5000 non-deleted memories per vault (configurable via `maxLongTermMemories`). When exceeded, prune oldest/lowest-relevance.
8. **MemoryRetrievalResult.similarityScore**: Must be between 0.0 and 1.0 inclusive.
9. **Deduplication threshold**: Cosine similarity ≥ 0.85 (configurable) triggers merge candidate check.

## State Transitions

### Memory Lifecycle

```
[Created] → extracted by LLM or saved manually
    │
    ├─→ [Active] → included in retrieval results
    │       │
    │       ├─→ [Updated] → content/category modified (updatedAt refreshed, re-embedded)
    │       │       └─→ returns to [Active]
    │       │
    │       ├─→ [Sensitive] → user sets sensitive=true → excluded from retrieval
    │       │       └─→ [Active] if user clears flag
    │       │
    │       ├─→ [Deleted] → soft delete (deleted=true, tombstone)
    │       │       └─→ [Removed] during compaction (hard delete)
    │       │
    │       └─→ [Pruned] → store exceeds 5000 limit, lowest pruneScore removed
    │
    └─→ [Deduplicated] → cosine similarity ≥ threshold → LLM-assisted merge
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

| Access Pattern              | Frequency                  | Method                                                        |
| --------------------------- | -------------------------- | ------------------------------------------------------------- |
| Semantic retrieval by query | Every chat turn            | Cosine similarity over all non-sensitive embeddings           |
| Filter by project tag       | Every chat turn (optional) | Linear scan before similarity (small dataset)                 |
| Full list for UI            | On management modal open   | Load all from store                                           |
| Single memory update        | On user edit in UI         | By `id` lookup                                                |
| Batch dedup check           | On extraction              | Cosine similarity (threshold 0.85) → LLM merge for candidates |
| Pruning                     | On extraction (background) | Sort by pruneScore, remove top 10% when > 5000                |
| Count for limit enforcement | On extraction              | Array length check                                            |
