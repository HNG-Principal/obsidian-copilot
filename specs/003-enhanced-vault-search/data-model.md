# Data Model: Enhanced Vault Search

**Feature**: `003-enhanced-vault-search` | **Date**: 2026-04-08

---

## Entity Diagram

```
┌─────────────────┐       ┌─────────────────┐
│  VaultDocument   │──1:N──│   VaultChunk    │
│                  │       │                  │
│ filePath (PK)    │       │ id (PK)          │
│ contentHash      │       │ documentPath (FK)│
│ modifiedAt       │       │ content          │
│ titleDate?       │       │ headingPath[]    │
│ tags[]           │       │ startLine        │
│ headings[]       │       │ endLine          │
│ wordCount        │       │ embedding?[]     │
└─────────────────┘       │ metadata         │
        │                  └─────────────────┘
        │                           │
        │                  ┌────────┴────────┐
        │                  │  ChunkMetadata   │
        │                  │                  │
        │                  │ documentTags[]   │
        │                  │ documentModifiedAt│
        │                  │ documentTitleDate?│
        │                  │ documentWordCount│
        │                  │ sectionHeadings[]│
        │                  └─────────────────┘
        │
┌───────┴─────────┐       ┌─────────────────┐
│  IndexMetadata   │       │   SearchQuery    │
│                  │       │                  │
│ version          │       │ queryText        │
│ embeddingModel   │       │ resultLimit      │
│ embeddingDimension│      │ textWeight?      │
│ lastFullIndexAt  │       │ timeRange?       │
│ documentHashes{} │       └────────┬────────┘
│ stale?           │                │
└─────────────────┘       ┌────────┴────────┐
                          │   TimeRange      │
                          │                  │
                          │ start?           │
                          │ end?             │
                          └─────────────────┘

┌─────────────────┐       ┌─────────────────┐
│  SearchResult    │──1:1──│ ScoreBreakdown   │
│                  │       │                  │
│ chunk            │       │ semanticScore    │
│ score            │       │ lexicalScore     │
│ documentPath     │       │ fusionScore      │
│ sectionPreview   │       │ rerankScore?     │
│ scoreBreakdown   │       └─────────────────┘
└─────────────────┘

┌─────────────────┐
│   IndexStats     │
│                  │
│ documentCount    │
│ chunkCount       │
│ lastFullIndexAt? │
│ embeddingModel?  │
│ stale            │
└─────────────────┘
```

---

## Entity Definitions

### VaultDocument

Represents a single markdown vault file in the search index.

| Field         | Type          | Description                                   |
| ------------- | ------------- | --------------------------------------------- |
| `filePath`    | `string` (PK) | Workspace-relative file path                  |
| `contentHash` | `string`      | MD5 hash of file content for change detection |
| `modifiedAt`  | `number`      | File modification time (epoch ms)             |
| `titleDate`   | `number?`     | Date parsed from file title, if present       |
| `tags`        | `string[]`    | Tags extracted from frontmatter and inline    |
| `headings`    | `string[]`    | All h1-h6 headings in the document            |
| `wordCount`   | `number`      | Total word count                              |

**Validation**: `filePath` must be a valid vault-relative `.md` path. `contentHash` is always 32 hex chars.

---

### VaultChunk

A header-aware section of a VaultDocument stored in the semantic index.

| Field          | Type            | Description                                             |
| -------------- | --------------- | ------------------------------------------------------- |
| `id`           | `string` (PK)   | Format: `{notePath}#{chunkIndex}` (0-based)             |
| `documentPath` | `string` (FK)   | Parent VaultDocument filePath                           |
| `content`      | `string`        | Chunk text (≤ CHUNK_SIZE chars)                         |
| `headingPath`  | `string[]`      | Heading breadcrumb, e.g. `["Chapter 1", "Section 1.1"]` |
| `startLine`    | `number`        | First line number of this chunk (1-based)               |
| `endLine`      | `number`        | Last line number of this chunk (1-based)                |
| `embedding`    | `number[]?`     | Embedding vector (dimension varies by model)            |
| `metadata`     | `ChunkMetadata` | Copied parent document metadata                         |

**Invariants**: `startLine ≤ endLine`. `headingPath` may be empty for content before first heading.

---

### ChunkMetadata

Denormalized parent document metadata attached to each chunk for efficient filtering without joins.

| Field                | Type       | Description                         |
| -------------------- | ---------- | ----------------------------------- |
| `documentTags`       | `string[]` | Tags from parent document           |
| `documentModifiedAt` | `number`   | Parent mtime (epoch ms)             |
| `documentTitleDate`  | `number?`  | Date parsed from parent title       |
| `documentWordCount`  | `number`   | Parent total word count             |
| `sectionHeadings`    | `string[]` | All headings in the parent document |

---

### SearchQuery

User-facing search request structure.

| Field         | Type         | Description                              |
| ------------- | ------------ | ---------------------------------------- |
| `queryText`   | `string`     | Natural language query or keyword phrase |
| `resultLimit` | `number`     | Maximum results to return                |
| `textWeight`  | `number?`    | Lexical weight (0.0–1.0), default 0.3    |
| `timeRange`   | `TimeRange?` | Optional time filter constraint          |

**Validation**: `resultLimit > 0`. `textWeight` clamped to [0, 1] if provided.

---

### TimeRange

Optional time filter applied to search queries.

| Field   | Type      | Description                   |
| ------- | --------- | ----------------------------- |
| `start` | `number?` | Earliest epoch ms (inclusive) |
| `end`   | `number?` | Latest epoch ms (inclusive)   |

**Invariant**: At least one of `start` or `end` must be set when the object exists.

---

### SearchResult

Structured search response for a single matched chunk.

| Field            | Type             | Description                               |
| ---------------- | ---------------- | ----------------------------------------- |
| `chunk`          | `VaultChunk`     | The matched chunk                         |
| `score`          | `number`         | Final composite score                     |
| `documentPath`   | `string`         | Convenience: chunk's parent document path |
| `sectionPreview` | `string`         | Truncated content for display             |
| `scoreBreakdown` | `ScoreBreakdown` | Component scores for transparency         |

---

### ScoreBreakdown

Individual score components captured during the ranking pipeline.

| Field           | Type      | Description                             |
| --------------- | --------- | --------------------------------------- |
| `semanticScore` | `number`  | Cosine similarity from embedding search |
| `lexicalScore`  | `number`  | BM25+ score from full-text engine       |
| `fusionScore`   | `number`  | Combined RRF score                      |
| `rerankScore`   | `number?` | Score from reranker (if enabled)        |

---

### IndexMetadata

Persisted with the search index for incremental updates and stale-index detection.

| Field                | Type                     | Description                                 |
| -------------------- | ------------------------ | ------------------------------------------- |
| `version`            | `number`                 | Index schema version                        |
| `embeddingModel`     | `string`                 | Model identifier used for embeddings        |
| `embeddingDimension` | `number`                 | Vector dimension of current model           |
| `lastFullIndexAt`    | `number`                 | Epoch ms of last full index build           |
| `documentHashes`     | `Record<string, string>` | Map of filePath → content MD5 hash          |
| `stale`              | `boolean?`               | True when dimension/model mismatch detected |

**Invariant**: When `stale=true`, search operations are blocked until re-index.

---

### IndexStats

Runtime statistics surfaced by the search engine.

| Field             | Type      | Description                  |
| ----------------- | --------- | ---------------------------- |
| `documentCount`   | `number`  | Total indexed documents      |
| `chunkCount`      | `number`  | Total indexed chunks         |
| `lastFullIndexAt` | `number?` | Epoch ms of last full index  |
| `embeddingModel`  | `string?` | Current embedding model name |
| `stale`           | `boolean` | Whether index is stale       |

---

## State Transitions

### Index Lifecycle

```
         ┌──────────────┐
         │  UNINITIALIZED│
         └──────┬───────┘
                │ initializeIndex()
                ▼
         ┌──────────────┐
         │    BUILDING   │──── full index with embeddings
         └──────┬───────┘
                │ complete
                ▼
         ┌──────────────┐
    ┌───>│    READY      │<───── dimension validation passes
    │    └──────┬───────┘
    │           │ file changes detected
    │           ▼
    │    ┌──────────────┐
    │    │  INCREMENTAL  │──── updateChanged() re-indexes diffs
    │    └──────┬───────┘
    │           │ complete
    │           └───────────────┘
    │
    │    ┌──────────────┐
    │    │    STALE      │──── embedding model/dimension changed
    │    └──────┬───────┘
    │           │ full re-index
    └───────────┘
```

---

## Relationships

| Source        | Target         | Cardinality   | Description                               |
| ------------- | -------------- | ------------- | ----------------------------------------- |
| VaultDocument | VaultChunk     | 1:N           | Each document splits into multiple chunks |
| VaultChunk    | ChunkMetadata  | 1:1           | Each chunk carries parent metadata        |
| SearchResult  | VaultChunk     | 1:1           | Each result references one chunk          |
| SearchResult  | ScoreBreakdown | 1:1           | Each result has component scores          |
| IndexMetadata | VaultDocument  | 1:N (by hash) | Tracks hash per document path             |
