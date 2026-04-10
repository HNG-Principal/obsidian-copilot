# Research: Long-Term Memory

**Feature**: 009-long-term-memory  
**Date**: 2026-04-09 (updated from 2026-04-08) (updated from 2026-04-08)  
**Status**: Complete

## Research Tasks

### 1. Fact Extraction Strategy

**Decision**: Use LLM-based extraction at end of each AI response turn, following the existing `extractTitleAndSummary()` pattern in `UserMemoryManager`.

**Rationale**: The codebase already has a proven pattern for LLM-based conversation analysis. The existing `addRecentConversation()` method uses a fire-and-forget async pattern that doesn't block the chat flow. The new extraction will follow the same pattern but output structured fact entries instead of title/summary pairs.

**Alternatives considered**:

- **Rule-based extraction** (regex/NLP): Rejected — too brittle, language-dependent, violates Constitution I (Generalizable Solutions).
- **End-of-conversation batch**: Rejected — clarification answer specifies per-turn extraction. Also, conversations may never formally "end" in Obsidian.
- **Separate extraction model**: Rejected — spec assumption says "same LLM configured for chat."

**Implementation approach**:

- New pure function `extractFactsFromMessages(messages, existingMemories)` returns `Memory[]`
- LLM prompt receives conversation turn + existing memories for dedup context
- Output: JSON array of `{ content, category, isUpdate, updatedMemoryId? }`
- Parsing follows existing JSON extraction pattern (code block → raw JSON → fallback)
- Fire-and-forget via existing `isUpdatingMemory` race condition guard

### 2. Semantic Retrieval Architecture

**Decision**: Implement a custom `LongTermMemoryRetriever` class implementing the `DocumentRetriever` interface, wrapping memory entries as LangChain `Document[]` objects.

**Rationale**: The `RetrieverFactory` system is designed for vault document search — it's coupled to vault indexing, file watchers, and Orama/v3 indexes. Memory retrieval needs a simpler, dedicated path that operates on an in-memory collection of ~100-1000 entries. A custom `DocumentRetriever` is the lightest integration.

**Alternatives considered**:

- **Reuse vault RetrieverFactory directly**: Rejected — memories aren't vault files; would require writing memories as physical notes and indexing them, adding unnecessary complexity.
- **MergedSemanticRetriever with custom provider**: Possible but overengineered — the merge/rerank pipeline is designed for vault-scale search. Memory retrieval is simpler.
- **Keyword matching only**: Rejected — spec requires semantic similarity (Assumption #5).

**Implementation approach**:

- Store memory embeddings alongside memory content in the structured data file
- On retrieval: compute query embedding → cosine similarity against stored embeddings → rank → return top N
- Use the same embedding model configured for vault search (via `EmbeddingManager`)
- Configurable max results (default: 10, per clarification)
- Optional project-tag filtering before similarity ranking

### 3. System Prompt Injection

**Decision**: Extend `getUserMemoryPrompt()` in `UserMemoryManager` to include a `<long_term_memories>` section, following the existing XML section pattern.

**Rationale**: The injection point already exists — `getSystemPromptWithMemory()` in `src/system-prompts/systemPromptBuilder.ts` calls `getUserMemoryPrompt()` and prepends the result to the system prompt. Adding a new XML section is the minimal change.

**Alternatives considered**:

- **Separate injection in chain runners**: Rejected — would require modifying multiple runners (LLMChainRunner, CopilotPlusChainRunner, AutonomousAgentChainRunner). The existing centralized injection handles all runners.
- **Inject as tool results**: Rejected — memories are background context, not tool call responses. Tool injection has different formatting and lifecycle.

**Implementation approach**:

- `LongTermMemoryManager.getRelevantMemoriesPrompt(query)` returns formatted XML string
- `UserMemoryManager.getUserMemoryPrompt()` calls LTM manager and appends `<long_term_memories>` section
- XML format: `<long_term_memories>\n- fact 1\n- fact 2\n</long_term_memories>`
- Retrieval triggered with current user message as the query

### 4. Storage Format

**Decision**: JSONL files in `.copilot/memory/` — `memories.jsonl` for memory records and `embeddings.jsonl` for embedding vectors (keyed by memory ID). Optional markdown export to `memoryFolderName/Long-Term Memories.md`.

**Rationale**: JSONL is append-friendly and consistent with existing `.copilot/` index file patterns (per 2026-04-09 clarification). Separating embeddings from content allows re-embedding without touching memory records when the user changes embedding providers. At the 5000-memory scale, both files fit comfortably in memory for brute-force operations.

**Alternatives considered**:

- **Single JSON file**: Requires rewriting the entire file on every mutation. At 5000 memories with embeddings (~50 MB), this becomes expensive.
- **SQLite via sql.js**: Adds a WASM dependency. Obsidian plugins should minimize bundle size (Constitution VII).
- **Obsidian vault markdown files**: Rejected per clarification — structured format chosen.

**Implementation approach**:

- `MemoryStore` interface: `load()`, `save()`, `getAll()`, `upsert(memory)`, `delete(id)`, `exportMarkdown()`
- Memory records: one JSON object per line in `memories.jsonl` (content, metadata, timestamps, category, sensitive flag)
- Embedding vectors: one JSON object per line in `embeddings.jsonl` (memory ID, model identifier, float array)
- File I/O via Obsidian's `app.vault.adapter.read()` / `app.vault.adapter.write()` for `.copilot/` access
- Deletion uses tombstone markers during normal operation; compact periodically
- On embedding provider change: detect model mismatch, queue background re-embeddingte()`for`.copilot/` access
- Deletion uses tombstone markers during normal operation; compact periodically
- On embedding provider change: detect model mismatch, queue background re-embedding

### 5. DedupliTwo-stage deduplication — embedding cosine similarity as the first pass (configurable threshold, default 0.85), followed by LLM-assisted merge for candidates above the threshold.

**Rationale**: Per 2026-04-09 clarification, deduplication uses embedding cosine similarity with a configurable threshold. Pure embedding comparison is fast (O(n) vector ops) and catches the majority of duplicates without LLM cost. The LLM merge step runs only on candidates flagged by the similarity check, keeping costs proportional to actual duplicates rather than total memory count.

**Alternatives considered**:

- **LLM-only dedup (previous research decision)**: Accurate but expensive — requires passing all existing memories to the LLM on every extraction. At 5000 memories this exceeds context limits.
- **Exact string matching**: Too brittle — "uses React" vs "working with React" wouldn't match.
- **Embedding-only without LLM merge**: Would silently overwrite old content. LLM merge preserves both old and new information.

**Deduplication flow**:

1. After extraction produces candidate memories, embed each candidate
2. For each candidate, compute cosine similarity against all existing memory embeddings
3. If max similarity ≥ threshold (0.85) → pass old + new content to LLM for intelligent merge
4. If max similarity < threshold → store as new memory
5. LLM merge prompt: "Combine these two facts into a single, accurate statement. Keep the most recent information. Preserve all distinct details."

**Performance**: At 5000 memories × 1536-dim vectors, brute-force cosine similarity takes ~5ms. LLM merge runs only on actual duplicate candidates (typically 0-3 per extraction batch). 3. If max similarity ≥ threshold (0.85) → pass old + new content to LLM for intelligent merge 4. If matore Size Limits and Pruning

**Decision**: 5000 memories max per vault (configurable). When exceeded, prune oldest memories with lowest relevance scores.

**Rationale**: Per 2026-04-09 clarification, the store has a configurable cap. At 5000 memories with 1536-dim embeddings, the embedding file is ~30 MB — fits in memory for brute-force search. Beyond this, both file size and retrieval time become concerns.

**Pruning algorithm**:

1. Score each memory: `pruneScore = ageFactor × (1 - maxRelevanceSeen)`
2. `ageFactor` = days since last accessed / 365 (capped at 1.0)
3. When store exceeds max, sort by pruneScore descending and remove top 10%
4. Pruning runs as a background task after extraction, not blocking the chat
5. Track `lastAccessedAt` timestamp on each memory (updated on retrieval)

**Alternatives considered**:

- **No limit**: Memory and file size grow unbounded.
- **Fixed FIFO**: Discards potentially valuable old memories.
- **LRU only**: Doesn't account for memory quality.

---

### 7. Extraction Toggle

**Decision**: Settings toggle `enableLongTermMemory` (default: `true`). When disabled, no extraction runs but existing memories remain retrievable.

**Rationale**: Per 2026-04-09 clarification. Users need control over whether facts are extracted. Follows the existing `enableRecentConversations` / `enableSavedMemory` toggle pattern.

**New settings fields**:

- `enableLongTermMemory: boolean` (default `true`)
- `maxLongTermMemories: number` (default `5000`)
- `maxMemoriesRetrieved: number` (default `10`)
- `memoryDeduplicationThreshold: number` (default `0.85`)

---

### 8. Embedding Provider Reuse

**Decision**: Reuse `EmbeddingManager.getInstance().getEmbeddingsAPI()` — same provider as vault search.

**Rationale**: Per 2026-04-09 clarification. No separate embedding configuration needed. The existing EmbeddingManager handles provider selection, API keys, rate limiting, and error handling.

**Re-embedding on provider change**:

- Store the embedding model identifier in `embeddings.jsonl` header line
- On load, compare stored model with current EmbeddingManager model
- If mismatch, queue background re-embedding (non-blocking)
- Show notice: "Memory embeddings are being updated for the new embedding provider"

---

### 9. Sx similarity < threshold → store as new memory

5. LLM merge prompt: "Combine these two facts into a single, accurate statement. Keep the most recent information. Preserve all distinct details."

**Performance**: At 5000 memories × 1536-dim vectors, brute-force cosine similarity takes ~5ms. LLM merge runs only on actual duplicate candidates (typically 0-3 per extraction batch).

### 6. Store Size Limits and Pruning

**Decision**: 5000 memories max per vault (configurable). When exceeded, prune oldest memories with lowest relevance scores.

**Rationale**: Per 2026-04-09 clarification, the store has a configurable cap. At 5000 memories with 1536-dim embeddings, the embedding file is ~30 MB — fits in memory for brute-force search. Beyond this, both file size and retrieval time become concerns.

**Pruning algorithm**:

1. Score each memory: `pruneScore = ageFactor × (1 - maxRelevanceSeen)`
2. `ageFactor` = days since last accessed / 365 (capped at 1.0)
3. When store exceeds max, sort by pruneScore descending and remove top 10%
4. Pruning runs as a background task after extraction, not blocking the chat
5. Track `lastAccessedAt` timestamp on each memory (updated on retrieval)

**Alternatives considered**:

- **No limit**: Memory and file size grow unbounded.
- **Fixed FIFO**: Discards potentially valuable old memories.
- **LRU only**: Doesn't account for memory quality.

---

### 7. Extraction Toggle

**Decision**: Settings toggle `enableLongTermMemory` (default: `true`). When disabled, no extraction runs but existing memories remain retrievable.

**Rationale**: Per 2026-04-09 clarification. Users need control over whether facts are extracted. Follows the existing `enableRecentConversations` / `enableSavedMemory` toggle pattern.

**New settings fields**:

- `enableLongTermMemory: boolean` (default `true`)
- `maxLongTermMemories: number` (default `5000`)
- `maxMemoriesRetrieved: number` (default `10`)
- `memoryDeduplicationThreshold: number` (default `0.85`)

---

### 8. Embedding Provider Reuse

**Decision**: Reuse `EmbeddingManager.getInstance().getEmbeddingsAPI()` — same provider as vault search.

**Rationale**: Per 2026-04-09 clarification. No separate embedding configuration needed. The existing EmbeddingManager handles provider selection, API keys, rate limiting, and error handling.

**Re-embedding on provider change**:

- Store the embedding model identifier in `embeddings.jsonl` header line
- On load, compare stored model with current EmbeddingManager model
- If mismatch, queue background re-embedding (non-blocking)
- Show notice: "Memory embeddings are being updated for the new embedding provider"

---

### 9. Sensitive Pattern Filtering

**Decision**: Pre-extraction filter using configurable regex patterns for known sensitive content types (API keys, tokens, passwords, secrets). Plus a `sensitive` boolean flag per memory for user-controlled exclusion.

**Rationale**: Per clarification, auto-skip known patterns + user flag. Regex filtering is fast, deterministic, and doesn't require LLM calls. The user flag provides manual override.

**Alternatives considered**:

- **LLM-based sensitivity detection**: Too expensive to run on every extraction. Also unreliable — LLMs may not consistently identify secrets.
- **No auto-filtering (user manages via UI only)**: Insufficient — secrets could be stored before the user notices.

**Implementation approach**:

- Pure function `filterSensitiveContent(text, patterns)` → `{ filtered: string, hadSensitive: boolean }`
- Default patterns: API key formats (`sk-...`, `AIza...`, `ghp_...`), bearer tokens, password fields in key-value pairs
- Patterns configurable in settings (advanced, hidden by default)
- `Memory.sensitive` boolean field — when true, excluded from retrieval results
- UI shows sensitive flag toggle per memory in management panel
