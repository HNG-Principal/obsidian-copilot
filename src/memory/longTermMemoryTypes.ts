/**
 * Type definitions for the Long-Term Memory subsystem.
 * Defines all entities used by MemoryStore, LongTermMemoryManager, and related modules.
 */

/**
 * Semantic category for a memory entry.
 */
export type MemoryCategory = "preference" | "fact" | "instruction" | "context";

/**
 * Provenance tracking for a memory entry.
 */
export interface MemorySource {
  /** "auto" = extracted by LLM; "manual" = explicitly saved by user */
  type: "auto" | "manual";
  /** Abbreviated context from originating conversation (≤100 chars) */
  conversationSnippet: string | null;
}

/**
 * The core storage unit for a single extracted fact or insight.
 */
export interface Memory {
  /** UUID v4, unique identifier */
  id: string;
  /** The extracted fact/insight (1-3 sentences, bullet-point normalized) */
  content: string;
  /** Semantic label for the memory */
  category: MemoryCategory;
  /** Project ID when memory was created; null for non-project chats */
  projectTag: string | null;
  /** Unix timestamp (ms) of first extraction */
  createdAt: number;
  /** Unix timestamp (ms) of last update */
  updatedAt: number;
  /** Unix timestamp (ms) of last retrieval (for pruning score) */
  lastAccessedAt: number;
  /** Count of times retrieved for prompt injection */
  accessCount: number;
  /** User-controlled sensitive flag; excluded from retrieval when true */
  sensitive: boolean;
  /** Tombstone for soft deletion; default false */
  deleted: boolean;
  /** Provenance metadata */
  source: MemorySource;
}

/**
 * Result of a semantic memory search, extending Memory with scoring.
 */
export interface MemoryRetrievalResult {
  /** The matched memory entry */
  memory: Memory;
  /** Cosine similarity to query (0.0-1.0) */
  similarityScore: number;
  /** 1-based position in result set */
  rank: number;
}

/**
 * Result returned by the extraction parser for each extracted fact.
 */
export interface MemoryExtractionResult {
  /** The extracted fact/insight text */
  content: string;
  /** Semantic label for the memory */
  category: MemoryCategory;
  /** Whether this updates an existing memory */
  isUpdate: boolean;
  /** ID of existing memory to update (null if new) */
  updatedMemoryId: string | null;
}

/**
 * Header metadata for the embeddings JSONL file.
 */
export interface EmbeddingsHeader {
  _type: "header";
  /** Schema version (starts at 1) */
  version: number;
  /** Embedding model ID */
  model: string;
  /** Embedding vector dimension */
  dimension: number;
  /** Unix timestamp (ms) of header creation */
  createdAt: number;
}

/**
 * A single embedding record in the embeddings JSONL file.
 */
export interface MemoryEmbedding {
  /** References Memory.id */
  memoryId: string;
  /** The embedding vector */
  vector: number[];
  /** Unix timestamp (ms) of embedding creation */
  createdAt: number;
}

/**
 * Loaded embeddings data from the store.
 */
export interface LoadedEmbeddings {
  /** The embedding model ID from the header */
  model: string;
  /** The embedding dimension from the header */
  dimension: number;
  /** Map of memoryId → embedding vector */
  vectors: Map<string, number[]>;
}
