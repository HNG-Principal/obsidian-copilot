# Feature Specification: Enhanced Vault Search

**Feature Branch**: `002-enhanced-vault-search`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "Enhanced vault search with multilingual embeddings, hybrid semantic and keyword search, time-based filtering, and result reranking, replacing the Miyo search backend"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Natural Language Vault Search (Priority: P1)

A user wants to find notes about a topic they vaguely remember. They type a natural language query (e.g., "that idea about habit stacking from last month") into the search interface. The system returns the most semantically relevant notes ranked by similarity, even if the exact words don't appear in those notes.

**Why this priority**: Semantic search is the core differentiator over Obsidian's built-in keyword search. Without it, none of the other search capabilities matter.

**Independent Test**: Index a vault with 100+ notes. Search for a concept using different phrasing than what appears in the notes. Verify the correct notes appear in the top 5 results.

**Acceptance Scenarios**:

1. **Given** a vault with indexed notes, **When** the user searches with a natural language query, **Then** results are returned ranked by semantic relevance within 2 seconds.
2. **Given** a query that uses synonyms or paraphrasing of note content, **When** the search runs, **Then** the semantically matching notes still appear in the top 5 results.
3. **Given** a vault with up to 10,000 notes, **When** the user searches, **Then** results are returned within 2 seconds.

---

### User Story 2 - Incremental Index Updates (Priority: P2)

A user opens their vault after editing several notes. The system detects which files have changed since the last indexing run and re-embeds only those files, rather than rebuilding the entire index. This keeps the search index current without long waits on vault open.

**Why this priority**: Without incremental indexing, users with large vaults face unacceptable wait times every time they open Obsidian. This is a prerequisite for any production-quality search.

**Independent Test**: Index a vault, modify 3 notes, reopen the vault. Verify only the 3 modified notes are re-embedded (check logs or processing count). Search for new content in the modified notes and confirm it appears.

**Acceptance Scenarios**:

1. **Given** a previously indexed vault with 1,000 notes, **When** 5 notes are modified and the vault is reopened, **Then** only the 5 modified notes are re-embedded (not the full vault).
2. **Given** a new note is created, **When** the vault index updates, **Then** the new note is searchable within 10 seconds.
3. **Given** a note is deleted, **When** the vault index updates, **Then** the deleted note no longer appears in search results.

---

### User Story 3 - Time-Based Search Filtering (Priority: P3)

A user wants to find notes from a specific time period (e.g., "notes from last week about project X" or "meeting notes from January"). The system combines the semantic query with a time filter, returning only notes that match both the content query and the time range.

**Why this priority**: Time is one of the most natural filters users apply to knowledge retrieval. It significantly improves result relevance for users with large, long-lived vaults.

**Independent Test**: Create notes across different dates. Search with a query that includes a time qualifier. Verify only notes from the specified time range are returned.

**Acceptance Scenarios**:

1. **Given** a user searches for "project updates from last week", **When** the query is processed, **Then** only notes modified within the last 7 days matching "project updates" are returned.
2. **Given** a user searches for "meeting notes from January 2026", **When** results are returned, **Then** notes with modification dates outside January 2026 are excluded.

---

### User Story 4 - Hybrid Search (Priority: P4)

A user searches for a specific term they know exists in their notes (e.g., a project code name or a person's name). Pure semantic search may not surface exact keyword matches at the top. The system combines semantic similarity with keyword matching to ensure exact-match results are ranked highly alongside semantically relevant ones.

**Why this priority**: Semantic search alone misses queries where the user knows the exact term. Hybrid search handles both exploratory and precision queries.

**Independent Test**: Search for a unique term (e.g., a project code name) that appears verbatim in one note. Verify that note ranks #1, even if other notes are semantically related to the broader topic.

**Acceptance Scenarios**:

1. **Given** a note contains the exact phrase "Project Helios", **When** the user searches for "Project Helios", **Then** that note ranks #1 in results.
2. **Given** a vague query like "solar energy initiative", **When** results are returned, **Then** both the "Project Helios" note and other semantically related notes appear, with the exact match ranked first.

---

### User Story 5 - Multilingual Search (Priority: P5)

A user writes notes in multiple languages (e.g., English and Spanish). They search in one language and expect to find relevant notes written in another language. The system uses multilingual embeddings so that semantic similarity works across languages.

**Why this priority**: Multilingual support broadens the user base significantly but is not required for the core English-language experience.

**Independent Test**: Create notes in two different languages about the same topic. Search in one language and verify the note in the other language appears in results.

**Acceptance Scenarios**:

1. **Given** a note written in Spanish about machine learning, **When** the user searches in English for "machine learning", **Then** the Spanish note appears in the results.
2. **Given** notes across at least 5 major languages, **When** searches are performed, **Then** relevant cross-language results are returned.

---

### Edge Cases

- What happens when the embedding provider is unreachable during indexing?
- How does the system handle notes with very little text content (e.g., a single line)?
- What happens when two notes have nearly identical content — are duplicates deduplicated in results?
- How are binary attachments (images, PDFs) within notes handled during indexing?
- What happens if the user switches embedding providers — is a full re-index required?
- How does the system handle notes with large frontmatter blocks — is frontmatter indexed or excluded?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST generate embeddings for all markdown notes in the vault using the user's configured embedding provider (BYOK).
- **FR-002**: System MUST support incremental indexing — only re-embed notes that have changed since the last index run.
- **FR-003**: System MUST support hybrid search combining semantic similarity (vector) and keyword matching (full-text).
- **FR-004**: System MUST support time-based filtering on search results (by note modification date and date-formatted titles).
- **FR-005**: System MUST rerank the top-N search results to improve relevance ordering.
- **FR-006**: System MUST support multilingual search across at least 5 major languages when a multilingual embedding model is configured.
- **FR-007**: System MUST store embeddings with metadata (file path, modification date, headings, tags) for filtering.
- **FR-008**: System MUST chunk documents using a sliding window approach with header-aware splitting to preserve context.
- **FR-009**: System MUST return search results with source note references (file path, matching section) for user navigation.
- **FR-010**: System MUST detect and require a full re-index when the embedding provider or model changes.
- **FR-011**: System MUST operate entirely on self-hosted infrastructure with no data sent to third-party services (except the user's own configured embedding provider).

### Key Entities

- **VaultDocument**: Represents a markdown file in the vault. Key attributes: file path, content hash (for change detection), modification date, tags, headings.
- **VaultChunk**: A segment of a document with its embedding. Key attributes: parent document reference, chunk text, position within document, heading context, embedding vector.
- **SearchQuery**: A user's search request. Key attributes: query text, time range filter (optional), result limit.
- **SearchResult**: A ranked result. Key attributes: source chunk, relevance score, source document path, matching section preview.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Search results return within 2 seconds for vaults up to 10,000 notes.
- **SC-002**: Incremental indexing re-embeds only changed files, completing in under 30 seconds for up to 50 changed notes.
- **SC-003**: Hybrid search outperforms pure vector search on keyword-specific queries (measured by correct result appearing in top 3 vs. top 10).
- **SC-004**: Reranking measurably improves top-5 result relevance compared to raw cosine similarity (measured by user-judged relevance in a test set).
- **SC-005**: Users with multilingual vaults find cross-language results for the same topic in the top 10 results.
- **SC-006**: Full re-index of a 10,000-note vault completes within 30 minutes.

## Assumptions

- Users will configure their own embedding provider and API key (BYOK model). The system does not bundle a default embedding model.
- The existing Obsidian plugin vault-watch mechanism will be reused for detecting file changes; this feature adds the embedding and search backend.
- Embedding dimensions and model choice are configurable; the system does not hardcode a specific model.
- Reranking can use either a cross-encoder model or LLM-based reranking depending on user configuration and available resources.
- Full-text search relies on the backend's text search capabilities (e.g., tsvector or equivalent).
- Image and binary content within notes is not indexed for v1 — only markdown text content.
