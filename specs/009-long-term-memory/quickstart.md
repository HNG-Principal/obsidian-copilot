# Quickstart: Long-Term Memory

**Feature**: 009-long-term-memory  
**Audience**: Developer implementing this feature  
**Updated**: 2026-04-09 (aligned with spec clarifications)

## Prerequisites

- Node.js 18+, npm
- Obsidian desktop app (for live testing)
- Familiarity with `src/memory/UserMemoryManager.ts` (existing memory system)
- Understanding of `BaseChainRunner.handleResponse()` (post-response hook)

## Getting Started

### 1. Create type definitions

Start with `src/memory/longTermMemoryTypes.ts` — define `Memory`, `MemoryCategory`, `MemorySource`, `MemoryRetrievalResult`, `MemoryExtractionResult`, `MemoryEmbedding` types from the data model. These are used everywhere else.

### 2. Implement pure leaf functions (testable first)

Build and test these independently — they have zero imports beyond types:

1. **`src/memory/sensitivePatternFilter.ts`** — `filterSensitiveContent(text, patterns)` returns filtered text and a flag. Test with common API key formats.

2. **`src/memory/MemoryExtractor.ts`** — Two functions:
   - `buildExtractionPrompt(messages, existingMemories)` → `{ systemPrompt, userPrompt }`
   - `parseExtractionResponse(llmResponse)` → array of extracted entries

   Test prompt building with mock messages. Test response parsing with sample LLM outputs including edge cases (malformed JSON, empty arrays, code blocks).

3. **`src/memory/MemoryDeduplicator.ts`** — Two-stage dedup:
   - `findDuplicateCandidates(existing, extracted, threshold)` → cosine similarity check (default 0.85)
   - `mergeMemories(oldContent, newContent, chatModel)` → LLM-assisted merge for candidates above threshold

   Test cosine similarity with known vectors. Test merge prompt with sample inputs.

### 3. Implement MemoryStore

`src/memory/LongTermMemoryManager.ts` (or separate `memoryStore.ts` if file gets large):

- `loadMemories()`: Read `.copilot/memory/memories.jsonl`, parse line-by-line, filter out tombstoned entries
- `loadEmbeddings()`: Read `.copilot/memory/embeddings.jsonl`, parse header + vectors
- `appendMemory()`: Append single JSONL line (append-friendly format)
- `save()`: Rewrite full JSONL files (used for compaction and updates)
- Handle first-run (directory/files don't exist → create empty)
- Handle embedding model change (detect mismatch in header → flag for re-embed)

### 4. Implement LongTermMemoryManager

The main orchestrator in `src/memory/LongTermMemoryManager.ts`:

- Constructor receives `app: App` (for file I/O via vault adapter)
- `extractAndStore()`: fire-and-forget wrapper — calls extractor, cosine similarity dedup, LLM merge for candidates, store
- `getRelevantMemoriesPrompt()`: compute query embedding, cosine similarity over embeddings.jsonl, format top-N, update lastAccessedAt
- CRUD methods for management UI
- Race condition guard (`isExtracting` flag, same pattern as `UserMemoryManager.isUpdatingMemory`)

### 5. Wire integration points

Three touch points in existing code:

1. **Settings** (`src/settings/model.ts`): Add `enableLongTermMemory`, `maxLongTermMemories` (default 5000), `maxMemoriesRetrieved` (default 10), `memoryDeduplicationThreshold` (default 0.85) to `CopilotSettings` interface and `DEFAULT_SETTINGS`.

2. **System prompt injection** (`src/memory/UserMemoryManager.ts`): In `getUserMemoryPrompt()`, call `longTermMemoryManager.getRelevantMemoriesPrompt()` and append `<long_term_memories>` XML section.

3. **Post-response hook** (`src/LLMProviders/chainRunner/BaseChainRunner.ts`): In `handleResponse()`, call `longTermMemoryManager.extractAndStore()` alongside existing `addRecentConversation()`.

### 6. Build management UI

`src/components/memory/MemoryManagerModal.tsx`:

- List all memories with content, category badge, project tag, timestamps
- Edit content/category inline
- Toggle sensitive flag
- Delete with confirmation
- Filter by project tag or category
- Use Radix UI Dialog + existing Tailwind patterns

### 7. Add settings UI

In the existing memory settings section of `src/settings/v2/SettingsMainV2.tsx`:

- Toggle: Enable Long-Term Memory
- Number input: Max memories (100-5000, default 5000)
- Number input: Max retrieved per turn (1-50, default 10)
- Number input: Deduplication threshold (0.5-1.0, default 0.85)
- Button: Open Memory Management modal
- Button: Export memories to markdown (FR-002 optional export)
- Button: Re-embed all memories (shown when embedding model changed)

## Verification Checklist

- [ ] Types compile with strict mode (`npm run build` passes)
- [ ] Pure functions have unit tests (extractor, deduplicator, filter)
- [ ] Store handles first-run, corrupt file, and JSONL parse errors
- [ ] Extraction fires after AI response without blocking chat
- [ ] Cosine similarity dedup with configurable threshold works correctly
- [ ] Retrieval completes within 2s for 5000 memories
- [ ] Memories inject into system prompt as `<long_term_memories>` XML
- [ ] Sensitive memories excluded from retrieval
- [ ] Management UI allows CRUD operations
- [ ] Settings toggle enables/disables feature
- [ ] Embedding model change triggers re-embed prompt
- [ ] Export to markdown produces readable file in memoryFolderName
- [ ] Project tag populated from current project context
- [ ] No console.log — all logging via logInfo/logWarn/logError

## Key Files Reference

| File                                              | Purpose                             |
| ------------------------------------------------- | ----------------------------------- |
| `src/memory/memoryTypes.ts`                       | All type definitions                |
| `src/memory/sensitivePatternFilter.ts`            | Pre-extraction content filter       |
| `src/memory/memoryExtractor.ts`                   | Prompt building + response parsing  |
| `src/memory/memoryDeduplicator.ts`                | Merge/dedup logic                   |
| `src/memory/LongTermMemoryManager.ts`             | Main manager class                  |
| `src/memory/UserMemoryManager.ts`                 | Modified — delegates to LTM manager |
| `src/components/memory/MemoryManagementModal.tsx` | Management UI                       |
| `src/settings/model.ts`                           | New settings fields                 |
| `src/LLMProviders/chainRunner/BaseChainRunner.ts` | Extraction hook                     |
