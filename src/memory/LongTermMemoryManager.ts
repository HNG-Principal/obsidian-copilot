/**
 * Orchestrator for long-term memory lifecycle: extraction, storage, retrieval, and management.
 * Dependencies are injected via constructor — no singletons.
 */

import { logError, logInfo } from "@/logger";
import { deduplicateMemories } from "@/memory/MemoryDeduplicator";
import { buildExtractionPrompt, parseExtractionResponse } from "@/memory/MemoryExtractor";
import { retrieveRelevantMemories } from "@/memory/MemoryRetriever";
import { MemoryStore } from "@/memory/MemoryStore";
import { Memory, MemoryExtractionResult, MemorySource } from "@/memory/longTermMemoryTypes";
import { filterSensitiveContent } from "@/memory/sensitivePatternFilter";
import { getSettings } from "@/settings/model";
import { ChatMessage } from "@/types/message";
import { Embeddings } from "@langchain/core/embeddings";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Central manager for the long-term memory subsystem.
 * Handles extraction from conversations, persistence, and retrieval.
 */
export class LongTermMemoryManager {
  constructor(
    private store: MemoryStore,
    private getEmbeddingsAPI: () => Promise<Embeddings>,
    private getModelName: (embeddings: Embeddings) => string
  ) {}

  /**
   * Extract memories from a conversation, embed them, and append to the store.
   * Designed to be called fire-and-forget — errors are logged, not thrown.
   *
   * @param messages - Recent conversation messages
   * @param chatModel - LLM to use for extraction
   */
  async extractAndStore(messages: ChatMessage[], chatModel: BaseChatModel): Promise<void> {
    try {
      if (!getSettings().enableLongTermMemory) {
        return;
      }

      if (!messages || messages.length === 0) {
        return;
      }

      // 1. Build conversation text and filter sensitive content
      const conversationText = messages
        .filter((m) => m.isVisible !== false)
        .map((m) => `${m.sender}: ${m.message}`)
        .join("\n");

      const { filtered, hadSensitive } = filterSensitiveContent(conversationText);
      if (hadSensitive) {
        logInfo("[LTM] Filtered sensitive content before extraction");
      }

      // 2. Load existing memories for dedup hints
      const existingMemories = await this.store.loadMemories();

      // 3. Build extraction prompt using filtered conversation
      const filteredMessages: ChatMessage[] = [
        {
          sender: "conversation",
          message: filtered,
          isVisible: true,
          timestamp: null,
        },
      ];
      const { systemPrompt, userPrompt } = buildExtractionPrompt(
        filteredMessages,
        existingMemories
      );

      // 4. Invoke LLM for extraction
      const response = await chatModel.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);
      const responseText = typeof response.content === "string" ? response.content : "";

      // 5. Parse extraction response
      const extracted = parseExtractionResponse(responseText);
      if (extracted.length === 0) {
        logInfo("[LTM] No memories extracted from conversation");
        return;
      }

      // 6. Get embeddings API and generate embeddings for all extracted memories
      const embeddingsAPI = await this.getEmbeddingsAPI();
      const modelName = this.getModelName(embeddingsAPI);
      const extractedEmbeddings = await Promise.all(
        extracted.map((item) => embeddingsAPI.embedQuery(item.content))
      );

      // 7. Load existing embeddings for dedup comparison
      const existingEmbeddings = await this.store.loadEmbeddings();
      const threshold = getSettings().memoryDeduplicationThreshold;

      // 8. Deduplicate against existing memories
      const { toInsert, toUpdate } = await deduplicateMemories(
        extracted,
        extractedEmbeddings,
        existingMemories,
        existingEmbeddings,
        threshold,
        chatModel
      );

      // 9. Process new insertions
      for (let i = 0; i < toInsert.length; i++) {
        const item = toInsert[i];
        // Find the original embedding index
        const originalIdx = extracted.indexOf(item);
        const embedding =
          originalIdx >= 0
            ? extractedEmbeddings[originalIdx]
            : await embeddingsAPI.embedQuery(item.content);
        await this.processExtractedMemory(
          item,
          existingMemories,
          embeddingsAPI,
          modelName,
          embedding
        );
      }

      // 10. Process dedup merges — update existing memories with merged content
      for (const update of toUpdate) {
        const target = existingMemories.find((m) => m.id === update.existingId);
        if (target) {
          target.content = update.mergedContent;
          target.updatedAt = Date.now();
          const newEmbedding = await embeddingsAPI.embedQuery(update.mergedContent);
          existingEmbeddings.vectors.set(target.id, newEmbedding);
          await this.store.save(existingMemories, existingEmbeddings.vectors, modelName);
        }
      }

      logInfo(
        `[LTM] Extracted ${extracted.length} memories: ${toInsert.length} new, ${toUpdate.length} merged`
      );

      // 11. Prune store if over limit
      await this.pruneIfNeeded();
    } catch (error) {
      logError("[LTM] Error in extractAndStore:", error);
    }
  }

  /**
   * Process a single extracted memory — create new or update existing.
   */
  private async processExtractedMemory(
    item: MemoryExtractionResult,
    existingMemories: Memory[],
    embeddingsAPI: Embeddings,
    modelName: string,
    precomputedEmbedding?: number[]
  ): Promise<void> {
    const now = Date.now();
    const embedding = precomputedEmbedding ?? (await embeddingsAPI.embedQuery(item.content));

    if (item.isUpdate && item.updatedMemoryId) {
      // Update existing memory: load all, modify, save (full rewrite)
      const target = existingMemories.find((m) => m.id === item.updatedMemoryId);
      if (target) {
        target.content = item.content;
        target.category = item.category;
        target.updatedAt = now;

        // Build updated embeddings map
        const loadedEmbeddings = await this.store.loadEmbeddings();
        loadedEmbeddings.vectors.set(target.id, embedding);
        await this.store.save(existingMemories, loadedEmbeddings.vectors, modelName);
        return;
      }
      // If target not found, fall through to create new
    }

    // Create new memory
    const memory: Memory = {
      id: this.generateId(),
      content: item.content,
      category: item.category,
      projectTag: null,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      sensitive: false,
      deleted: false,
      source: {
        type: "auto" as MemorySource["type"],
        conversationSnippet: item.content.slice(0, 100),
      },
    };

    await this.store.appendMemory(memory, embedding, modelName);
  }

  /**
   * Prune the store if it exceeds maxLongTermMemories.
   * Computes a pruneScore for each memory and removes the bottom 10%.
   * pruneScore = 0.4 × normalize(accessCount) + 0.3 × normalize(recency) + 0.3 × normalize(age-inverse)
   * Higher score = more valuable = kept.
   */
  private async pruneIfNeeded(): Promise<void> {
    const maxMemories = getSettings().maxLongTermMemories;
    const memories = await this.store.loadMemories();

    if (memories.length <= maxMemories) return;

    const now = Date.now();

    // Compute raw values for normalization
    const accessCounts = memories.map((m) => m.accessCount);
    const recencies = memories.map((m) => now - m.lastAccessedAt); // Lower = more recent
    const ages = memories.map((m) => now - m.createdAt); // Lower = newer

    const normalize = (values: number[]): number[] => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (max === min) return values.map(() => 0.5);
      return values.map((v) => (v - min) / (max - min));
    };

    const normAccess = normalize(accessCounts); // Higher = more accessed = better
    const normRecency = normalize(recencies); // Higher = LESS recent = worse
    const normAge = normalize(ages); // Higher = older = worse

    // Score each memory: higher = more valuable
    const scored = memories.map((m, i) => ({
      memory: m,
      score: 0.4 * normAccess[i] + 0.3 * (1 - normRecency[i]) + 0.3 * (1 - normAge[i]),
    }));

    // Sort ascending by score (least valuable first)
    scored.sort((a, b) => a.score - b.score);

    // Remove bottom 10%
    const pruneCount = Math.ceil(memories.length * 0.1);
    const toPrune = new Set(scored.slice(0, pruneCount).map((s) => s.memory.id));

    const surviving = memories.filter((m) => !toPrune.has(m.id));

    const loadedEmbeddings = await this.store.loadEmbeddings();
    for (const id of toPrune) {
      loadedEmbeddings.vectors.delete(id);
    }

    const embeddingsAPI = await this.getEmbeddingsAPI();
    const modelName = this.getModelName(embeddingsAPI);
    await this.store.save(surviving, loadedEmbeddings.vectors, modelName);

    logInfo(
      `[LTM] Pruned ${pruneCount} memories (store had ${memories.length}, max ${maxMemories})`
    );
  }

  /**
   * Retrieve relevant long-term memories for a query and format as an XML prompt section.
   * Returns null if no relevant memories or feature disabled.
   * Updates access stats on returned memories.
   */
  async getRelevantMemoriesPrompt(query: string): Promise<string | null> {
    try {
      if (!getSettings().enableLongTermMemory) return null;

      const [memories, embeddings] = await Promise.all([
        this.store.loadMemories(),
        this.store.loadEmbeddings(),
      ]);

      if (memories.length === 0 || embeddings.vectors.size === 0) return null;

      const embeddingsAPI = await this.getEmbeddingsAPI();
      const queryEmbedding = await embeddingsAPI.embedQuery(query);
      const maxResults = getSettings().maxMemoriesRetrieved;

      const results = retrieveRelevantMemories(
        query,
        memories,
        embeddings,
        queryEmbedding,
        maxResults
      );

      if (results.length === 0) return null;

      // Update access stats on matched memories
      const now = Date.now();
      let needsSave = false;
      for (const result of results) {
        result.memory.lastAccessedAt = now;
        result.memory.accessCount += 1;
        needsSave = true;
      }

      if (needsSave) {
        const modelName = this.getModelName(embeddingsAPI);
        await this.store.save(memories, embeddings.vectors, modelName);
      }

      // Format as bullet-point list inside XML tags
      const bullets = results.map((r) => `- [${r.memory.category}] ${r.memory.content}`).join("\n");

      return `<long_term_memories>\n${bullets}\n</long_term_memories>`;
    } catch (error) {
      logError("[LTM] Error in getRelevantMemoriesPrompt:", error);
      return null;
    }
  }

  /**
   * Get all non-deleted memories for UI display.
   */
  async getAllMemories(): Promise<Memory[]> {
    return this.store.loadMemories();
  }

  /**
   * Update a memory's fields and re-embed if content changed.
   *
   * @param id - Memory ID to update
   * @param updates - Partial fields to apply (content, category, sensitive)
   */
  async updateMemory(
    id: string,
    updates: Partial<Pick<Memory, "content" | "category" | "sensitive">>
  ): Promise<void> {
    const memories = await this.store.loadMemories();
    const target = memories.find((m) => m.id === id);
    if (!target) {
      throw new Error(`Memory not found: ${id}`);
    }

    const contentChanged = updates.content !== undefined && updates.content !== target.content;

    if (updates.content !== undefined) target.content = updates.content;
    if (updates.category !== undefined) target.category = updates.category;
    if (updates.sensitive !== undefined) target.sensitive = updates.sensitive;
    target.updatedAt = Date.now();

    const loadedEmbeddings = await this.store.loadEmbeddings();
    const embeddingsAPI = await this.getEmbeddingsAPI();
    const modelName = this.getModelName(embeddingsAPI);

    // Re-embed only if content changed
    if (contentChanged) {
      const newEmbedding = await embeddingsAPI.embedQuery(target.content);
      loadedEmbeddings.vectors.set(id, newEmbedding);
    }

    await this.store.save(memories, loadedEmbeddings.vectors, modelName);
  }

  /**
   * Permanently delete a memory (hard delete) by rewriting the store without it.
   */
  async deleteMemory(id: string): Promise<void> {
    const memories = await this.store.loadMemories();
    const filtered = memories.filter((m) => m.id !== id);
    if (filtered.length === memories.length) {
      throw new Error(`Memory not found: ${id}`);
    }

    const loadedEmbeddings = await this.store.loadEmbeddings();
    loadedEmbeddings.vectors.delete(id);

    const embeddingsAPI = await this.getEmbeddingsAPI();
    const modelName = this.getModelName(embeddingsAPI);
    await this.store.save(filtered, loadedEmbeddings.vectors, modelName);
  }

  /**
   * Export all non-sensitive memories to a Markdown file in the memory folder.
   * File name: "Long-Term Memories.md"
   */
  async exportToMarkdown(): Promise<string> {
    const memories = await this.store.loadMemories();
    const exportable = memories.filter((m) => !m.sensitive);

    const grouped = new Map<string, Memory[]>();
    for (const m of exportable) {
      const cat = m.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(m);
    }

    const lines: string[] = [
      "# Long-Term Memories",
      "",
      `> Exported ${exportable.length} memories on ${new Date().toISOString().split("T")[0]}`,
      "",
    ];

    for (const [category, mems] of grouped) {
      lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      lines.push("");
      for (const m of mems) {
        const date = new Date(m.createdAt).toISOString().split("T")[0];
        lines.push(`- ${m.content} *(${date})*`);
      }
      lines.push("");
    }

    const filePath = `${this.store.getBasePath()}/Long-Term Memories.md`;
    await app.vault.adapter.write(filePath, lines.join("\n"));
    logInfo(`[LTM] Exported ${exportable.length} memories to ${filePath}`);
    return filePath;
  }

  /**
   * Re-embed all memories when the embedding model changes.
   * Detects model mismatch from embeddings header vs current model.
   * Returns the count of re-embedded entries.
   */
  async reEmbed(): Promise<number> {
    const memories = await this.store.loadMemories();
    if (memories.length === 0) return 0;

    const embeddingsAPI = await this.getEmbeddingsAPI();
    const modelName = this.getModelName(embeddingsAPI);

    const embeddings = new Map<string, number[]>();
    for (const memory of memories) {
      const vector = await embeddingsAPI.embedQuery(memory.content);
      embeddings.set(memory.id, vector);
    }

    await this.store.save(memories, embeddings, modelName);
    logInfo(`[LTM] Re-embedded ${memories.length} memories with model ${modelName}`);
    return memories.length;
  }

  /**
   * Generate a unique memory ID.
   */
  private generateId(): string {
    return `ltm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
