# Vault Search and Indexing

Copilot can search your vault to find relevant notes and answer questions grounded in your own content. This guide explains the two types of search, how to manage the index, and how to configure what gets indexed.

---

## Two Types of Search

### Lexical Search (Keyword-Based)

Lexical search finds notes that contain the exact words you used. It's fast, requires no setup, and works out of the box.

- **Used in**: Vault QA (Basic) mode
- **How it works**: Looks for your exact keywords in note titles and content
- **Strengths**: Fast, precise, no embedding API calls needed
- **Limitations**: Won't find notes that use different words to express the same idea

**RAM Limit**: The lexical search index is held in memory. You can configure the memory limit in **Settings → Copilot → QA → Lexical Search RAM Limit** (default: 100 MB, range: 20–1,000 MB).

**Lexical Boosts**: Copilot can boost search results from notes in the same folder as the current note, or from notes that link to each other. Enable in **Settings → Copilot → QA → Enable Lexical Boosts** (on by default).

### Semantic Search (Meaning-Based)

Semantic search finds notes that are conceptually related, even if they don't share exact words.

- **Used in**: Vault QA and Copilot Plus modes — but **disabled by default**. You must explicitly enable it.
- **How it works**: Converts your notes into numerical vectors (using an embedding model), then finds notes whose vectors are closest to your query
- **Strengths**: Finds notes by concept and meaning, great for "fuzzy" recall
- **Cost**: Requires embedding API calls (costs money for paid embedding models)
- **Enable**: **Settings → Copilot → QA → Enable Semantic Search** — turn this on to activate semantic search

### Hybrid Search

When semantic search is enabled, Copilot can combine meaning-based matches with exact keyword matches.

- **What it does**: blends conceptual matches with literal word matches so exact-note hits still rank highly
- **Best for**: searches where you want both fuzzy recall and precise term matching
- **Result**: a query like a project codename or unique phrase should still put the exact note near the top, while related notes remain visible

### Reranking

After the first pass of search, Copilot can optionally rerank the top results to improve the order of the most relevant notes.

- **Enable**: turn on **Reranking** in QA settings
- **What it changes**: only the order of the top search results, not which notes are indexed
- **Fallback behavior**: if no reranking backend is available, Copilot keeps the original order

---

## Index Management

The semantic search index stores the vector embeddings of your notes. Manage it from **Settings → Copilot → QA**.

### Auto-Index Strategy

Controls when Copilot automatically updates the index:

| Strategy           | When the index updates                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| **NEVER**          | Manual only — you must trigger indexing yourself                       |
| **ON STARTUP**     | Updates when Obsidian starts or the plugin reloads                     |
| **ON MODE SWITCH** | Updates when you switch to Vault QA or Copilot Plus mode (Recommended) |

The default is **ON MODE SWITCH**.

> **Warning**: For large vaults using paid embedding models, frequent indexing can incur significant costs. Consider using NEVER and indexing manually if cost is a concern.

### Refresh Index (Incremental)

**Command palette → Index (refresh) vault**

Updates only notes that have been added, modified, or deleted since the last index. Faster and cheaper than a full reindex.

This is the normal maintenance path for semantic search. Copilot keeps track of indexed note content, so routine refreshes only process notes that actually changed.

### Force Reindex

**Command palette → Force reindex vault**

Rebuilds the entire index from scratch. Use this if:

- You changed your embedding model
- The index seems corrupted or missing results
- You've made many changes and want a clean state
- Search warns that your index is stale

### Garbage Collection

**Command palette → Garbage collect Copilot index (remove files that no longer exist in vault)**

Removes entries from the index for notes that have been deleted from your vault. Keeps the index clean without a full reindex.

### Clear Index

**Command palette → Clear local Copilot index**

Deletes the entire index. You'll need to reindex before semantic search works again.

### What Happens on Startup and File Changes

When automatic indexing is enabled, Copilot checks for changed notes on startup and batches file edits instead of rebuilding the entire search index every time.

- New notes can be added to the semantic index without a full rebuild
- Edited notes are reprocessed automatically when indexing is active
- Deleted notes are removed from the index on the next incremental update

### Debug Commands

For troubleshooting:

- **List indexed files** — Shows all notes currently in the index
- **Inspect index by note paths** — Check which chunks of specific notes are indexed
- **Count total vault tokens** — Estimates total tokens across your vault
- **Search semantic index** — Run a direct search query against the index

---

## Filtering: What Gets Indexed

Control which notes are included in semantic search.

### Cost Estimation Before Indexing

Before indexing a large vault with a paid embedding model, estimate the cost first:

**Command palette → Count total tokens in your vault**

This shows the total token count across your vault, which you can use to estimate embedding API costs. Embedding costs are generally low, but worth checking for very large vaults.

### Exclusions

**Settings → Copilot → QA → Exclusions**

Comma-separated list of patterns. Notes matching these patterns are excluded. Supports:

- Folder names: `private` — excludes the folder named "private"
- Folder paths: `Work/Confidential` — excludes that specific subfolder
- File extensions: `.pdf` — excludes all PDF files
- Tags: `#private` — excludes all notes tagged `#private`
- Note titles: `My Secret Note` — excludes that specific note

Example: `private, Work/Confidential, #private` excludes the private folder, a specific work folder, and all notes tagged #private.

> **Note**: Tag matching works with tags in the note's **properties (frontmatter)**, not inline tags within the note body.

The `copilot` folder is always excluded automatically (it contains the plugin's own files).

### Inclusions

**Settings → Copilot → QA → Inclusions**

Comma-separated list. If set, **only** notes matching these patterns are indexed. Useful for indexing a specific area of your vault.

Leave empty to include everything (except exclusions).

---

## Time-Based Search

Copilot can narrow results to notes from a specific period when your search implies a time window, such as recent work, last week, or a dated note range.

Time filtering can use several signals from your notes:

- File modified time
- Dates in note titles such as `2026-04-08`, `2026.04.08`, or `20260408`
- A `date` field in note properties

This works best when your notes already use consistent dates in filenames or properties.

---

## Embedding Settings

These settings appear in **Settings → Copilot → QA** when Semantic Search is enabled.

### Requests per Minute

How many embedding API requests to send per minute. Default is 60. Decrease this if you hit rate limit errors from your embedding provider.

Range: 10–60

### Embedding Batch Size

How many text chunks to send per API request. Default is 16. Larger batches are faster but may cause issues with some providers.

### Partitions

The index is split into partitions to handle large vaults. You can control the number of partitions in **Settings → Copilot → QA → Number of Partitions**. If you have a large vault, increase this value to avoid index errors.

> **If you hit a "RangeError: invalid string length" error**: This means your vault is too large for a single partition. Increase the number of partitions in QA settings. A good rule of thumb is that the first partition file (found in `.obsidian/`) should be under ~400 MB.

### Chunk Size

Copilot splits notes into smaller sections before creating embeddings. Smaller chunks can improve precision, while larger chunks may preserve more surrounding context.

- **Default**: 512 tokens
- **Use smaller values** if results feel too broad
- **Use larger values** if important context is split too aggressively

Copilot also keeps section structure where possible, so headings can help search land in the right part of a note.

---

## Embedding Model Changes

If you switch to a different embedding model, the existing semantic index may no longer be valid.

When that happens, Copilot marks the index as stale and prompts you to run a full reindex. Until you rebuild, semantic search results may be incomplete or unavailable.

This is expected. Different embedding models produce different vector dimensions and representations, so old index data cannot be reused safely.

---

## Multilingual Search

Copilot does not need a separate multilingual mode. Multilingual search depends on the embedding model you choose.

Recommended multilingual embedding models include:

- Cohere `embed-multilingual-v3.0`
- OpenAI `text-embedding-3-large`

If your vault contains notes in multiple languages, choose a multilingual embedding model before building the semantic index, then run a full reindex.

---

## Inline Citations (Experimental)

When enabled, AI responses in Vault QA include footnote-style citations pointing to the source notes used in the answer.

**Enable**: **Settings → Copilot → QA → Enable Inline Citations**

This is an experimental feature. Not all models handle it well.

---

## Obsidian Sync

If you use Obsidian Sync, the vector index can be synced across devices. Enable **Settings → Copilot → QA → Enable Index Sync**.

> **Note**: The index can be large (hundreds of MB for big vaults). Keep this in mind for sync limits and mobile data usage.

---

## Mobile Considerations

By default, Copilot **disables indexing on mobile** to save battery and data. The setting is in **Settings → Copilot → QA → Disable index on mobile** (on by default).

On mobile, you can still use Vault QA with lexical search, but semantic search won't update automatically.

---

## Related

- [Agent Mode and Tools](agent-mode-and-tools.md) — How @vault uses the index in Plus mode
- [Models and Parameters](models-and-parameters.md) — Choosing an embedding model
- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md) — Miyo-powered local semantic search
