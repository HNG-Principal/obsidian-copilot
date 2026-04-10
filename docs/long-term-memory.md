# Long-Term Memory

Long-term memory enables Copilot to automatically learn and remember facts, preferences, and instructions from your conversations. Over time, the AI builds a personal knowledge base that makes responses more relevant and personalized.

## How It Works

1. **Automatic extraction** — After each conversation, Copilot analyzes the exchange and extracts useful information: preferences, facts, instructions, and contextual details.
2. **Semantic storage** — Extracted memories are stored locally in your vault with vector embeddings for efficient similarity search.
3. **Smart retrieval** — Before each response, Copilot finds the most relevant memories and includes them in the AI's context, enabling personalized answers.
4. **Deduplication** — When a new memory is similar to an existing one, Copilot merges them automatically instead of creating duplicates.

## Enabling Long-Term Memory

Long-term memory is enabled by default. To toggle it:

1. Open **Settings → Copilot Plus**
2. Find the **Long-Term Memory** section
3. Toggle **Enable long-term memory** on or off

When disabled, no new memories are extracted and existing memories are not included in AI context.

## Settings

| Setting                    | Default | Range      | Description                                                             |
| -------------------------- | ------- | ---------- | ----------------------------------------------------------------------- |
| Enable long-term memory    | On      | On/Off     | Master toggle for the entire feature                                    |
| Max stored memories        | 5000    | 100–10,000 | Maximum number of memories to keep. Oldest/least-used are pruned first. |
| Max memories per retrieval | 10      | 1–50       | How many memories to include in each AI response's context              |
| Deduplication threshold    | 0.85    | 0.50–1.00  | How similar two memories must be to trigger automatic merging           |

### Tuning Tips

- **Lower deduplication threshold** (e.g., 0.7) = more aggressive merging, fewer total memories
- **Higher deduplication threshold** (e.g., 0.95) = less merging, more granular memories
- **More memories per retrieval** = richer context but uses more tokens per message

## Memory Categories

Each memory is classified into one of four categories:

- **Preference** — User likes, dislikes, and style choices ("prefers dark mode", "uses TypeScript")
- **Fact** — Objective information about the user or their work ("lives in Berlin", "works on a React project")
- **Instruction** — Behavioral directives ("always use metric units", "explain things simply")
- **Context** — Background information about projects or situations ("currently migrating to Next.js")

## Managing Memories

Open the memory manager to view, search, edit, and delete your memories:

1. Open the **Command Palette** (Ctrl/Cmd + P)
2. Search for **"Manage long-term memories"**
3. The memory manager shows all stored memories with:
   - Content and category
   - Creation date
   - Sensitive flag indicator

### Available Actions

- **Search** — Filter memories by keyword or category
- **Edit** — Click the edit icon to modify a memory's content or category
- **Delete** — Remove a memory permanently (with confirmation)
- **Toggle sensitive** — Mark a memory as sensitive to exclude it from AI retrieval

## Privacy and Sensitive Data

### Automatic Filtering

Before extracting memories, Copilot automatically filters out sensitive patterns:

- API keys and tokens
- Passwords and secrets
- AWS access keys
- SSH private keys
- Connection strings with credentials
- JWT tokens

### Sensitive Flag

You can manually mark any memory as "sensitive" in the memory manager. Sensitive memories:

- Are **excluded from AI retrieval** (never sent to the LLM)
- Remain in your local store for your reference
- Can be unmarked at any time

### Local Storage

All memories are stored locally in your vault under `.copilot/memory/` as JSONL files. They are never uploaded to any external service. The files are:

- `memories.jsonl` — All memory records
- `embeddings.jsonl` — Vector embeddings for similarity search

## Exporting Memories

You can export all non-sensitive memories to a Markdown file:

The export creates a `Long-Term Memories.md` file in the memory folder, organized by category with dates.

## Store Pruning

When the number of stored memories exceeds the configured maximum, Copilot automatically removes the least valuable memories. The pruning algorithm considers:

- **Access frequency** (40%) — How often a memory has been retrieved
- **Recency** (30%) — When the memory was last accessed
- **Age** (30%) — When the memory was created (newer = more valuable)

The bottom 10% of memories by this score are removed during each pruning cycle.

## Troubleshooting

### Memories not being extracted

- Ensure **Enable long-term memory** is turned on in settings
- Check that your LLM provider is working (extraction requires a working chat model)
- Very short conversations may not produce extractable memories

### Too many duplicate memories

- Lower the **Deduplication threshold** setting (e.g., from 0.85 to 0.75)
- The dedup system compares semantic similarity, so paraphrased facts should still be caught

### Memories not appearing in responses

- Memories are retrieved based on semantic similarity to your current question
- Sensitive-flagged memories are excluded from retrieval
- Try increasing **Max memories per retrieval** if relevant memories are being cut off

### Embedding model changed

When you switch embedding models, existing memory embeddings become incompatible. Copilot can re-embed all memories with the new model automatically. If memories stop appearing in context after changing models, the embeddings may need to be rebuilt.
