import { logError, logInfo, logWarn } from "@/logger";
import {
  EmbeddingsHeader,
  LoadedEmbeddings,
  Memory,
  MemoryEmbedding,
} from "@/memory/longTermMemoryTypes";
import { ensureFolderExists } from "@/utils";

const MEMORIES_FILE = "memories.jsonl";
const EMBEDDINGS_FILE = "embeddings.jsonl";
const SCHEMA_VERSION = 1;

/**
 * Normalize a vault-relative path by collapsing extra slashes and trimming.
 */
function normalizePath(path: string): string {
  return path.replace(/\/+/g, "/").replace(/\/$/, "");
}

/**
 * JSONL-based persistence layer for long-term memories and their embeddings.
 * Handles reading, writing, appending, and compacting of JSONL files.
 * Uses Obsidian's vault adapter for all file I/O.
 */
export class MemoryStore {
  private basePath: string;

  /**
   * @param basePath - The vault-relative folder path for storing JSONL files
   *                   (e.g., "copilot/memory")
   */
  constructor(basePath: string) {
    this.basePath = normalizePath(basePath);
  }

  /** @returns The vault-relative folder path for this store */
  getBasePath(): string {
    return this.basePath;
  }

  /** @returns Full vault-relative path to memories.jsonl */
  private get memoriesPath(): string {
    return `${this.basePath}/${MEMORIES_FILE}`;
  }

  /** @returns Full vault-relative path to embeddings.jsonl */
  private get embeddingsPath(): string {
    return `${this.basePath}/${EMBEDDINGS_FILE}`;
  }

  /**
   * Ensure the storage directory exists, creating it on first run.
   */
  async ensureDirectory(): Promise<void> {
    await ensureFolderExists(this.basePath);
  }

  /**
   * Check if the store directory and JSONL files exist.
   */
  async exists(): Promise<boolean> {
    try {
      return (
        (await app.vault.adapter.exists(this.memoriesPath)) &&
        (await app.vault.adapter.exists(this.embeddingsPath))
      );
    } catch {
      return false;
    }
  }

  /**
   * Load all non-deleted memories from memories.jsonl.
   * Skips malformed lines gracefully with a warning.
   */
  async loadMemories(): Promise<Memory[]> {
    if (!(await app.vault.adapter.exists(this.memoriesPath))) {
      return [];
    }

    const raw = await app.vault.adapter.read(this.memoriesPath);
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const memories: Memory[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Memory;
        if (!parsed.deleted) {
          memories.push(parsed);
        }
      } catch {
        logWarn("[MemoryStore] Skipping malformed JSONL line in memories:", line.slice(0, 80));
      }
    }

    logInfo(`[MemoryStore] Loaded ${memories.length} memories`);
    return memories;
  }

  /**
   * Load all embeddings from embeddings.jsonl (header + vectors).
   * Returns model info and a Map of memoryId → vector.
   * Detects model mismatch if currentModel is known.
   */
  async loadEmbeddings(): Promise<LoadedEmbeddings> {
    if (!(await app.vault.adapter.exists(this.embeddingsPath))) {
      return { model: "", dimension: 0, vectors: new Map() };
    }

    const raw = await app.vault.adapter.read(this.embeddingsPath);
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const vectors = new Map<string, number[]>();
    let model = "";
    let dimension = 0;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed._type === "header") {
          const header = parsed as EmbeddingsHeader;
          model = header.model;
          dimension = header.dimension;
        } else {
          const embedding = parsed as MemoryEmbedding;
          if (embedding.memoryId && embedding.vector) {
            vectors.set(embedding.memoryId, embedding.vector);
          }
        }
      } catch {
        logWarn("[MemoryStore] Skipping malformed JSONL line in embeddings:", line.slice(0, 80));
      }
    }

    logInfo(`[MemoryStore] Loaded ${vectors.size} embeddings (model: ${model})`);
    return { model, dimension, vectors };
  }

  /**
   * Append a memory record + embedding to their respective JSONL files.
   * Creates files with header if they don't exist.
   */
  async appendMemory(memory: Memory, embedding: number[], embeddingModel: string): Promise<void> {
    await this.ensureDirectory();

    // Append to memories.jsonl
    const memoryLine = JSON.stringify(memory) + "\n";
    await this.appendToFile(this.memoriesPath, memoryLine);

    // Append to embeddings.jsonl (create header if new file)
    if (!(await app.vault.adapter.exists(this.embeddingsPath))) {
      const header: EmbeddingsHeader = {
        _type: "header",
        version: SCHEMA_VERSION,
        model: embeddingModel,
        dimension: embedding.length,
        createdAt: Date.now(),
      };
      await app.vault.adapter.write(this.embeddingsPath, JSON.stringify(header) + "\n");
    }

    const embeddingRecord: MemoryEmbedding = {
      memoryId: memory.id,
      vector: embedding,
      createdAt: Date.now(),
    };
    await this.appendToFile(this.embeddingsPath, JSON.stringify(embeddingRecord) + "\n");
  }

  /**
   * Rewrite full JSONL files (used for compaction, bulk updates, and hard deletes).
   * Completely replaces both files with the provided data.
   */
  async save(memories: Memory[], embeddings: Map<string, number[]>, model: string): Promise<void> {
    await this.ensureDirectory();

    // Rewrite memories.jsonl
    const memoryLines = memories.map((m) => JSON.stringify(m)).join("\n");
    await app.vault.adapter.write(
      this.memoriesPath,
      memoryLines.length > 0 ? memoryLines + "\n" : ""
    );

    // Rewrite embeddings.jsonl with header
    const dimension = embeddings.size > 0 ? (embeddings.values().next().value?.length ?? 0) : 0;
    const header: EmbeddingsHeader = {
      _type: "header",
      version: SCHEMA_VERSION,
      model,
      dimension,
      createdAt: Date.now(),
    };
    const embeddingLines = [JSON.stringify(header)];
    for (const [memoryId, vector] of embeddings) {
      const record: MemoryEmbedding = {
        memoryId,
        vector,
        createdAt: Date.now(),
      };
      embeddingLines.push(JSON.stringify(record));
    }
    await app.vault.adapter.write(this.embeddingsPath, embeddingLines.join("\n") + "\n");

    logInfo(`[MemoryStore] Saved ${memories.length} memories, ${embeddings.size} embeddings`);
  }

  /**
   * Append content to a file. Creates the file if it doesn't exist.
   */
  private async appendToFile(filePath: string, content: string): Promise<void> {
    try {
      if (await app.vault.adapter.exists(filePath)) {
        const existing = await app.vault.adapter.read(filePath);
        await app.vault.adapter.write(filePath, existing + content);
      } else {
        await app.vault.adapter.write(filePath, content);
      }
    } catch (error) {
      logError(`[MemoryStore] Failed to append to ${filePath}:`, error);
      throw error;
    }
  }
}
