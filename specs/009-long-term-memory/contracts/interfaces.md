# Contracts: Long-Term Memory

**Feature**: 009-long-term-memory  
**Date**: 2026-04-09 (updated from 2026-04-08)

This document defines the public interfaces exposed by the Long-Term Memory module. These are the contracts other modules depend on — changes require coordinating with consumers.

## Core Interfaces

### ILongTermMemoryManager

The primary public API for the memory subsystem. Consumed by `UserMemoryManager`, `BaseChainRunner`, and the management UI.

```typescript
interface ILongTermMemoryManager {
  /**
   * Extract and store facts from the latest conversation turn.
   * Fire-and-forget — errors are logged, never thrown.
   * Called from BaseChainRunner.handleResponse() after each AI response.
   */
  extractAndStore(messages: ChatMessage[], chatModel: BaseChatModel): void;

  /**
   * Retrieve semantically relevant memories for prompt injection.
   * Returns formatted string for XML section in system prompt.
   * Returns null if no relevant memories or feature disabled.
   * Side-effect: increments accessCount on each returned memory.
   */
  getRelevantMemoriesPrompt(query: string): Promise<string | null>;

  /**
   * Get all memories for management UI display.
   * Returns full list including sensitive entries (UI handles visibility).
   */
  getAllMemories(): Promise<Memory[]>;

  /**
   * Update a single memory entry (content, category, sensitive flag).
   * Used by management UI for user edits.
   */
  updateMemory(
    id: string,
    updates: Partial<Pick<Memory, "content" | "category" | "sensitive">>
  ): Promise<void>;

  /**
   * Delete a memory by ID.
   * Used by management UI.
   */
  deleteMemory(id: string): Promise<void>;

  /**
   * Re-embed all memories (needed when embedding model changes).
   * Returns count of re-embedded entries.
   */
  reEmbed(): Promise<number>;

  /**
   * Export all non-sensitive memories to a markdown file for user inspection.
   * Writes to `memoryFolderName/Long-Term Memories.md` (FR-002).
   */
  exportMarkdown(): Promise<void>;
}
```

### IMemoryStore

Internal storage contract. Isolates persistence logic from business logic for testability.

```typescript
interface IMemoryStore {
  /** Load all non-deleted memories from memories.jsonl. */
  loadMemories(): Promise<Memory[]>;

  /** Load all embeddings from embeddings.jsonl (header + vectors). */
  loadEmbeddings(): Promise<{ model: string; dimension: number; vectors: Map<string, number[]> }>;

  /** Append a memory record + embedding to their respective JSONL files. */
  appendMemory(memory: Memory, embedding: number[]): Promise<void>;

  /** Rewrite full JSONL files (used for compaction, bulk updates). */
  save(memories: Memory[], embeddings: Map<string, number[]>, model: string): Promise<void>;

  /** Check if the store directory and files exist. */
  exists(): Promise<boolean>;
}
```

### Pure Function Contracts

These leaf-module functions accept plain data — no singletons, no managers.

```typescript
/**
 * Extract fact entries from conversation messages.
 * Pure function: receives messages + existing memories, returns extracted facts.
 * The caller handles LLM invocation.
 */
type ExtractFactsPromptBuilder = (
  messages: ChatMessage[],
  existingMemories: Memory[]
) => { systemPrompt: string; userPrompt: string };

type ParseExtractionResponse = (llmResponse: string) => Array<{
  content: string;
  category: MemoryCategory;
  isUpdate: boolean;
  updatedMemoryId: string | null;
}>;

/**
 * Deduplicate memories using two-stage approach:
 * 1. Cosine similarity check against existing embeddings
 * 2. LLM-assisted merge for candidates above threshold
 */
type DeduplicateMemories = (
  existing: Memory[],
  existingEmbeddings: Map<string, number[]>,
  extracted: Array<{
    content: string;
    category: MemoryCategory;
    embedding: number[];
  }>,
  threshold: number // default 0.85
) => Promise<{
  toInsert: Array<{ content: string; category: MemoryCategory; embedding: number[] }>;
  toUpdate: Array<{ id: string; content: string; category: MemoryCategory; embedding: number[] }>;
}>;

/**
 * Filter sensitive content from text before extraction.
 */
type FilterSensitiveContent = (
  text: string,
  patterns: RegExp[]
) => { filtered: string; hadSensitive: boolean };
```

## Settings Contract

New settings added to `CopilotSettings`:

```typescript
// Added to CopilotSettings interface
{
  enableLongTermMemory: boolean; // default: true
  maxLongTermMemories: number; // default: 5000, range: 100-10000
  maxMemoriesRetrieved: number; // default: 10, range: 1-50
  memoryDeduplicationThreshold: number; // default: 0.85, range: 0.5-1.0
}
```

## System Prompt Injection Contract

Memory injection follows the existing XML section pattern:

```xml
<!-- Added after existing <saved_memories> section -->
<long_term_memories>
- [fact 1 content]
- [fact 2 content]
- [fact N content]
</long_term_memories>
```

Injection order (prepended before system prompt):

1. `<recent_conversations>` (existing)
2. `<saved_memories>` (existing)
3. `<long_term_memories>` (new)
4. System prompt instructions (existing)

## Event Hooks

| Hook Point               | Trigger                                                          | Consumer                                             |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------- |
| Post-response extraction | `BaseChainRunner.handleResponse()` completes                     | `ILongTermMemoryManager.extractAndStore()`           |
| Pre-request retrieval    | `UserMemoryManager.getUserMemoryPrompt()` builds memory sections | `ILongTermMemoryManager.getRelevantMemoriesPrompt()` |
| Settings change          | `subscribeToSettingsChange()` for `enableLongTermMemory`         | Feature toggle, re-embed trigger                     |
