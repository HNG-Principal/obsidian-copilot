# Quickstart: Long-Term Memory

**Feature**: 009-long-term-memory  
**Audience**: Developer implementing this feature

## Prerequisites

- Node.js 18+, npm
- Obsidian desktop app (for live testing)
- Familiarity with `src/memory/UserMemoryManager.ts` (existing memory system)
- Understanding of `BaseChainRunner.handleResponse()` (post-response hook)

## Getting Started

### 1. Create type definitions

Start with `src/memory/memoryTypes.ts` — define `Memory`, `MemoryCategory`, `MemorySource`, `MemoryRetrievalResult`, `MemoryStoreData` types from the data model. These are used everywhere else.

### 2. Implement pure leaf functions (testable first)

Build and test these independently — they have zero imports beyond types:

1. **`src/memory/sensitivePatternFilter.ts`** — `filterSensitiveContent(text, patterns)` returns filtered text and a flag. Test with common API key formats.

2. **`src/memory/memoryExtractor.ts`** — Two functions:

   - `buildExtractionPrompt(messages, existingMemories)` → `{ systemPrompt, userPrompt }`
   - `parseExtractionResponse(llmResponse)` → array of extracted entries

   Test prompt building with mock messages. Test response parsing with sample LLM outputs including edge cases (malformed JSON, empty arrays, code blocks).

3. **`src/memory/memoryDeduplicator.ts`** — `deduplicateMemories(existing, extracted)` → `{ toInsert, toUpdate }`. Test merge logic with overlapping entries.

### 3. Implement MemoryStore

`src/memory/LongTermMemoryManager.ts` (or separate `memoryStore.ts` if file gets large):

- `load()`: Read `.copilot/long-term-memory.json`, parse, validate schema version
- `save()`: Atomic write (write temp → rename)
- Handle first-run (file doesn't exist → return empty store)
- Handle embedding model change (detect mismatch → flag for re-embed)

### 4. Implement LongTermMemoryManager

The main orchestrator in `src/memory/LongTermMemoryManager.ts`:

- Constructor receives `app: App` (for file I/O via vault adapter)
- `extractAndStore()`: fire-and-forget wrapper — calls extractor, deduplicator, store
- `getRelevantMemoriesPrompt()`: compute query embedding, cosine similarity, format top-N, increment accessCount on returned memories
- CRUD methods for management UI
- Race condition guard (`isExtracting` flag, same pattern as `UserMemoryManager.isUpdatingMemory`)

### 5. Wire integration points

Three touch points in existing code:

1. **Settings** (`src/settings/model.ts`): Add `enableLongTermMemory`, `maxLongTermMemories`, `longTermMemoryRetrievalCount` to `CopilotSettings` interface and `DEFAULT_SETTINGS`.

2. **System prompt injection** (`src/memory/UserMemoryManager.ts`): In `getUserMemoryPrompt()`, call `longTermMemoryManager.getRelevantMemoriesPrompt()` and append `<long_term_memories>` XML section.

3. **Post-response hook** (`src/LLMProviders/chainRunner/BaseChainRunner.ts`): In `handleResponse()`, call `longTermMemoryManager.extractAndStore()` alongside existing `addRecentConversation()`.

### 6. Build management UI

`src/components/memory/MemoryManagementModal.tsx`:

- List all memories with content, category badge, project tag, timestamps
- Edit content/category inline
- Toggle sensitive flag
- Delete with confirmation
- Filter by project tag or category
- Use Radix UI Dialog + existing Tailwind patterns

### 7. Add settings UI

In the existing memory settings section of `src/settings/v2/SettingsMainV2.tsx`:

- Toggle: Enable Long-Term Memory
- Number input: Max memories (10-500)
- Number input: Max retrieved per turn (1-20)
- Button: Open Memory Management modal
- Button: Export memories to markdown (FR-002 optional export)
- Button: Re-embed all memories (shown when embedding model changed)

## Verification Checklist

- [ ] Types compile with strict mode (`npm run build` passes)
- [ ] Pure functions have unit tests (extractor, deduplicator, filter)
- [ ] Store handles first-run, corrupt file, and schema migration
- [ ] Extraction fires after AI response without blocking chat
- [ ] Retrieval completes within 2s for 1000 memories
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
