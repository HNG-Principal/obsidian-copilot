# Data Model: Enhanced Vault Search

**Feature**: `002-enhanced-vault-search` | **Date**: 2026-04-08

---

## Entities

### VaultDocument

Represents a markdown file in the vault for indexing purposes.

| Field         | Type                  | Description                                             |
| ------------- | --------------------- | ------------------------------------------------------- |
| `filePath`    | `string`              | Vault-relative file path                                |
| `contentHash` | `string`              | MD5 hash of file content for change detection           |
| `modifiedAt`  | `number`              | File modification timestamp (epoch ms)                  |
| `titleDate`   | `number \| undefined` | Date parsed from filename (epoch ms), if date-formatted |
| `tags`        | `string[]`            | Tags extracted from YAML frontmatter and inline tags    |
| `headings`    | `string[]`            | All headings in the document                            |
| `wordCount`   | `number`              | Total word count                                        |

### VaultChunk

A segment of a document with its embedding vector.

| Field          | Type            | Description                                                 |
| -------------- | --------------- | ----------------------------------------------------------- |
| `id`           | `string`        | Unique chunk ID (`{filePath}#{chunkIndex}`)                 |
| `documentPath` | `string`        | Parent document file path                                   |
| `content`      | `string`        | Chunk text content                                          |
| `headingPath`  | `string[]`      | Heading breadcrumb (e.g., `["Introduction", "Background"]`) |
| `startLine`    | `number`        | Start line in source document                               |
| `endLine`      | `number`        | End line in source document                                 |
| `embedding`    | `number[]`      | Embedding vector                                            |
| `metadata`     | `ChunkMetadata` | Additional metadata for filtering                           |

### ChunkMetadata

| Field                | Type                  | Description                      |
| -------------------- | --------------------- | -------------------------------- |
| `documentTags`       | `string[]`            | Tags from parent document        |
| `documentModifiedAt` | `number`              | Parent document mtime            |
| `documentTitleDate`  | `number \| undefined` | Date parsed from parent filename |

### SearchQuery

A user's search request with optional filters.

| Field         | Type                     | Description                                       |
| ------------- | ------------------------ | ------------------------------------------------- |
| `queryText`   | `string`                 | Natural language search query                     |
| `timeRange`   | `TimeRange \| undefined` | Optional time filter                              |
| `tags`        | `string[] \| undefined`  | Optional tag filter                               |
| `resultLimit` | `number`                 | Max results to return (default 10)                |
| `textWeight`  | `number`                 | Keyword vs semantic weight (0.0–1.0, default 0.3) |

### TimeRange

| Field   | Type                  | Description                           |
| ------- | --------------------- | ------------------------------------- |
| `start` | `number \| undefined` | Start timestamp (epoch ms), inclusive |
| `end`   | `number \| undefined` | End timestamp (epoch ms), inclusive   |

### SearchResult

A ranked result returned to the user.

| Field            | Type             | Description                             |
| ---------------- | ---------------- | --------------------------------------- |
| `chunk`          | `VaultChunk`     | The matched chunk                       |
| `score`          | `number`         | Combined relevance score (0.0–1.0)      |
| `documentPath`   | `string`         | Source document file path               |
| `sectionPreview` | `string`         | Heading path + first 200 chars of chunk |
| `scoreBreakdown` | `ScoreBreakdown` | Individual score components             |

### ScoreBreakdown

| Field           | Type                  | Description                 |
| --------------- | --------------------- | --------------------------- |
| `semanticScore` | `number`              | Cosine similarity score     |
| `lexicalScore`  | `number`              | BM25 keyword score          |
| `rerankScore`   | `number \| undefined` | Reranker score (if applied) |
| `fusionScore`   | `number`              | Combined RRF score          |

### IndexMetadata

Stored alongside the index for change detection and model tracking.

| Field                | Type                     | Description                                         |
| -------------------- | ------------------------ | --------------------------------------------------- |
| `version`            | `number`                 | Schema version for migrations                       |
| `embeddingModel`     | `string`                 | Model key used to generate embeddings               |
| `embeddingDimension` | `number`                 | Expected embedding vector dimension                 |
| `lastFullIndexAt`    | `number`                 | Timestamp of last full re-index                     |
| `documentHashes`     | `Record<string, string>` | Map of filePath → contentHash for all indexed files |

---

## Relationships

```
VaultDocument 1──* VaultChunk (document → chunks)
VaultChunk    *──1 ChunkMetadata (chunk → parent doc metadata)
SearchQuery   1──* SearchResult (query → results)
SearchResult  *──1 VaultChunk (result → source chunk)
SearchResult  1──1 ScoreBreakdown (result → scoring)
IndexMetadata 1──* VaultDocument (index tracks all documents)
```

---

## Validation Rules

1. **Chunk size**: `content.length` ≤ max chunk token count (configurable, default 512 tokens)
2. **Embedding dimension**: `embedding.length` must match `IndexMetadata.embeddingDimension`
3. **Score range**: All scores in `ScoreBreakdown` must be in `[0.0, 1.0]`
4. **File path**: `documentPath` must be a valid vault-relative path
5. **Time range**: If both `start` and `end` are provided, `start ≤ end`
6. **Content hash**: Must be 32-character hex string (MD5)

---

## State Transitions

### Index Lifecycle

```
Empty → Building (full index) → Ready
Ready → Updating (incremental) → Ready
Ready → Rebuilding (model change) → Ready
Ready → Stale (embedding model changed, awaiting user action)
```

### Document Index State

```
Unindexed → Indexing → Indexed
Indexed → Modified (content hash changed) → Re-indexing → Indexed
Indexed → Deleted → Removed from index
```

---

## Access Patterns

| Operation             | Frequency                       | Method                                 |
| --------------------- | ------------------------------- | -------------------------------------- |
| Semantic search       | Per user query                  | `SearchCore.retrieve()`                |
| Incremental re-index  | On vault open + file changes    | `IndexOperations.updateChanged()`      |
| Full re-index         | On model change                 | `IndexOperations.rebuildAll()`         |
| Time-filtered search  | Per user query with time filter | `FilterRetriever.filter()`             |
| Check index staleness | On settings change              | Compare `IndexMetadata.embeddingModel` |
| Hybrid score fusion   | Per search                      | `fusionScore()` pure function          |
