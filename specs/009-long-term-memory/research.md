# Research: Long-Term Memory

**Feature**: 009-long-term-memory  
**Date**: 2026-04-08  
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

**Decision**: Single JSON file at `.copilot/long-term-memory.json` containing an array of memory entries with embedded vectors. Optional markdown export to `memoryFolderName/Long-Term Memories.md`.

**Rationale**: Existing caching uses `.copilot/` directory for structured data (file cache, index snapshots). JSON supports efficient read/update/dedup operations. The spec clarification chose "structured data with optional markdown export."

**Alternatives considered**:

- **JSONL (one entry per line)**: Considered for append-only writes, but memories require update/delete/dedup operations that benefit from loading the full set. With a target of ~100-1000 entries, a single JSON file is manageable.
- **SQLite via sql.js**: Possible but adds a WASM dependency. Obsidian plugins should minimize bundle size (Constitution VII).
- **Obsidian vault markdown files**: Rejected per clarification — structured format chosen.

**Implementation approach**:

- `MemoryStore` interface: `load()`, `save()`, `getAll()`, `upsert(memory)`, `delete(id)`, `exportMarkdown()`
- File I/O via Obsidian's `app.vault` for vault-relative paths or `FileSystemAdapter` for `.copilot/` access
- Atomic writes (write to temp file → rename) to prevent corruption
- Embeddings stored inline per memory entry to avoid separate embedding cache

### 5. Deduplication Strategy

**Decision**: LLM-assisted deduplication during extraction. The extraction prompt receives existing memories as context and is instructed to update rather than duplicate.

**Rationale**: The existing `updateSavedMemoryFile()` method already implements this exact pattern — it passes current memories + new statement to the LLM with instructions to "remove duplicates and near-duplicates by merging" and "keep most recent truth for conflicts." This proven approach is more robust than embedding-distance thresholds.

**Alternatives considered**:

- **Embedding cosine similarity threshold**: Simpler but produces false positives (similar topics ≠ duplicate facts). A threshold of 0.9 misses paraphrased duplicates; 0.7 merges distinct facts.
- **Exact string matching**: Too brittle — "uses React" vs "working with React" wouldn't match.
- **Two-stage (embedding filter → LLM confirm)**: Over-engineered for v1. Can be added later if LLM dedup becomes a cost concern.

**Implementation approach**:

- Extraction prompt includes `<existing_memories>` section with current memory content
- LLM returns `isUpdate: true, updatedMemoryId: "..."` when a memory should be updated
- Pure function `deduplicateMemories(existing, extracted)` applies the LLM's merge decisions
- Fallback: if LLM doesn't flag a duplicate, a lightweight post-check compares new entry against existing by category + embedding similarity > 0.95

### 6. Sensitive Pattern Filtering

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
