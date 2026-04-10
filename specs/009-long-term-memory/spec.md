# Feature Specification: Long-Term Memory

**Feature Branch**: `009-long-term-memory`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "Long-term memory enabling persistent cross-session knowledge with automatic fact extraction from conversations, deduplication, user management UI for viewing and editing and deleting memories, and semantic retrieval injected into system prompts"

## Clarifications

### Session 2026-04-08

- Q: Should memories be global, project-scoped, or global with project tags? → A: Global with project tags — memories tagged by source project, retrieval can optionally filter by project.
- Q: When should fact extraction happen — real-time per turn, end of conversation, or periodic batch? → A: End of each AI turn — extract after each assistant response completes.
- Q: How should sensitive information (passwords, API keys, health data) be handled? → A: Auto-skip known sensitive patterns during extraction, plus a user-togglable "sensitive" flag per memory for manual exclusion from retrieval.
- Q: What should the default max number of memories retrieved per AI turn be? → A: 10 memories max (configurable in settings).
- Q: Should memories be stored as human-readable markdown or structured data? → A: Structured data file with optional markdown export for inspection.

### Session 2026-04-09

- Q: What structured data format should the memory store use? → A: JSONL file — append-friendly and consistent with existing `.copilot/` index file patterns.
- Q: Should there be a maximum memory store size, and what happens when it's exceeded? → A: 5000 memories max per vault. When exceeded, oldest and lowest-relevance memories are pruned automatically.
- Q: Can users disable automatic memory extraction entirely? → A: Yes — a toggle in settings (enabled by default). When disabled, no extraction occurs but existing memories remain retrievable.
- Q: What mechanism should deduplication use to detect similar memories? → A: Embedding cosine similarity with a configurable threshold — memories above the threshold are candidates for merging.
- Q: Should memory embeddings reuse the vault search embedding provider or use a separate one? → A: Reuse the same embedding provider configured for vault search (EmbeddingManager).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Automatic Fact Extraction from Conversations (Priority: P1)

A user mentions during a chat conversation: "I'm working on a React project using TypeScript and Tailwind." In future sessions, when the user asks "What stack am I using?", the AI recalls this fact without the user needing to repeat it. Facts are automatically extracted from conversations and stored as persistent memories.

**Why this priority**: Automatic extraction is the core mechanism that populates long-term memory. Without it, the system has no memories to retrieve. This must work before any other memory feature is useful.

**Independent Test**: Chat about a specific personal preference or fact. Start a new session. Ask a question that requires that fact. Verify the AI uses the stored memory in its response.

**Acceptance Scenarios**:

1. **Given** a user mentions a factual detail in conversation (e.g., role, tech stack, project name), **When** the conversation ends or continues, **Then** the fact is automatically extracted and stored as a memory.
2. **Given** a memory has been stored, **When** a new chat session begins and the user asks a related question, **Then** the AI's response incorporates the stored memory.
3. **Given** the user shares contradictory information (e.g., "I switched from React to Vue"), **When** the new fact is extracted, **Then** the outdated memory is updated rather than creating a duplicate.

---

### User Story 2 - Semantic Memory Retrieval (Priority: P2)

A user asks "What were the key decisions we made about the database?" The system retrieves semantically relevant memories from past conversations — even if the user didn't use the exact same words when the decisions were originally discussed. Retrieved memories are injected into the AI's context to produce an informed response.

**Why this priority**: Retrieval makes stored memories useful. Without semantic retrieval, memories exist but can't be surfaced at the right time. This transforms a passive store into an active knowledge assistant.

**Independent Test**: Store several memories across multiple sessions. Ask a semantically related question (not using the exact same wording). Verify the system retrieves and uses the relevant memories.

**Acceptance Scenarios**:

1. **Given** multiple memories exist on different topics, **When** a user asks a question, **Then** only semantically relevant memories are retrieved and injected into the AI context.
2. **Given** a question matches multiple memories, **When** the system retrieves memories, **Then** they are ranked by relevance and the most relevant ones are included first.
3. **Given** no stored memories are relevant to the current question, **When** the AI responds, **Then** it does not hallucinate or fabricate past conversations.

---

### User Story 3 - Memory Management UI (Priority: P3)

A user wants to see what the AI "remembers" about them. They open the memory management interface, which shows a list of all stored memories organized by topic or date. They can view each memory's content, edit inaccurate memories, and delete memories they don't want the AI to use.

**Why this priority**: User control and transparency are essential for trust. Users must be able to see, correct, and delete what the AI stores about them. This is also important for privacy.

**Independent Test**: Open the memory management UI. Verify all stored memories are visible. Edit one memory, delete another. Verify the changes are reflected in subsequent AI interactions.

**Acceptance Scenarios**:

1. **Given** the user opens the memory management interface, **When** the UI loads, **Then** all stored memories are displayed with their content and creation date.
2. **Given** a user edits a memory, **When** they save the edit, **Then** future AI interactions use the updated memory content.
3. **Given** a user deletes a memory, **When** the deletion is confirmed, **Then** the memory is permanently removed and no longer used in AI responses.
4. **Given** the user has many memories, **When** they browse the management UI, **Then** memories can be searched or filtered by keyword.

---

### User Story 4 - Deduplication (Priority: P4)

A user repeatedly discusses the same topic across multiple conversations. The system recognizes when a newly extracted fact overlaps with an existing memory and merges or updates rather than creating duplicates. This keeps the memory store clean and relevant.

**Why this priority**: Without deduplication, memory accumulates redundant entries over time, degrading retrieval quality and wasting context window space. This is a quality-of-life feature that ensures the system remains useful long-term.

**Independent Test**: Mention the same fact in three different conversations. Check the memory store. Verify only one memory entry exists for that fact (not three duplicates).

**Acceptance Scenarios**:

1. **Given** a user restates the same fact across sessions, **When** the system extracts the fact, **Then** the existing memory is updated rather than a new duplicate created.
2. **Given** a user provides a more detailed version of an existing memory, **When** extraction occurs, **Then** the memory is enriched with the additional detail.
3. **Given** two memories are semantically similar but not identical, **When** the system evaluates them, **Then** only clearly redundant memories are merged — ambiguous cases are kept separate.

---

### Edge Cases

- What happens when the memory store grows very large (thousands of memories) — how does retrieval performance remain acceptable?
- How does the system handle confidential or sensitive information mentioned in conversation? Known sensitive patterns (API keys, tokens, passwords) are auto-skipped during extraction. Users can additionally flag memories as "sensitive" to exclude them from retrieval.
- What happens when memories from different projects contradict each other?
- How does the system handle memory extraction from very short or ambiguous conversations?
- What happens if the user clears all memories — does the system restart from scratch with no prior knowledge?
- How are memories handled when the user switches between multiple devices or vaults?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST automatically extract factual information from chat conversations at the end of each AI response turn, without requiring explicit user action.
- **FR-002**: System MUST store extracted memories persistently in JSONL format (one JSON object per line) within `.copilot/memory/` across sessions (surviving Obsidian restarts), with optional markdown export for user inspection.
- **FR-003**: System MUST retrieve semantically relevant memories based on the current conversation context and inject them into the AI's system prompt or context.
- **FR-004**: System MUST deduplicate memories using embedding cosine similarity with a configurable threshold — overlapping or redundant facts above the threshold are merged rather than stored separately.
- **FR-005**: System MUST provide a management interface where users can view all stored memories.
- **FR-006**: System MUST allow users to edit the content of any stored memory.
- **FR-007**: System MUST allow users to delete any stored memory permanently.
- **FR-008**: System MUST update existing memories when contradictory or updated information is provided by the user.
- **FR-009**: System MUST limit the number of retrieved memories injected into context to a configurable maximum (default: 10) to avoid exceeding the model's context window.
- **FR-010**: System MUST skip extraction of content matching known sensitive patterns (API keys, tokens, passwords) and MUST allow users to flag individual memories as "sensitive" to exclude them from retrieval.
- **FR-011**: System MUST enforce a configurable maximum memory store size (default: 5000). When exceeded, the system MUST automatically prune the oldest and lowest-relevance memories.
- **FR-012**: System MUST provide a settings toggle to enable/disable automatic memory extraction (enabled by default). When disabled, existing memories remain retrievable but no new extraction occurs.
- **FR-013**: System MUST reuse the vault search embedding provider (EmbeddingManager) for memory embeddings — no separate embedding configuration required.

### Key Entities

- **Memory**: A stored piece of factual knowledge. Key attributes: content (text), embedding vector, source conversation reference, source project tag (optional), creation date, last updated date, topic/category (auto-assigned), sensitive flag (boolean, default false).
- **MemoryRetrievalResult**: A ranked memory match. Key attributes: memory reference, relevance score, source context.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Facts mentioned in conversation are automatically extracted and stored within the same session — no manual user action required.
- **SC-002**: Semantically relevant memories are surfaced in at least 80% of conversations where prior knowledge applies (measured against a test set).
- **SC-003**: Duplicate memories are prevented — restating the same fact 5 times results in at most 1 memory entry.
- **SC-004**: Users can view, edit, and delete memories within 3 clicks from the main chat interface.
- **SC-005**: Memory retrieval adds no more than 2 seconds of latency to AI response time.

## Assumptions

- Memories are stored locally within the Obsidian vault as JSONL files in `.copilot/memory/` (not plain markdown notes), with an optional markdown export feature for user inspection.
- Memory extraction uses the same LLM configured for chat — no separate model is required.
- The memory store is per-vault. Different vaults have independent memory stores.
- Memories are global across projects but tagged with their source project. Retrieval can optionally filter by the active project while still allowing cross-project recall.
- Memory retrieval uses semantic similarity via the existing EmbeddingManager (not keyword matching) for relevance ranking. No separate embedding provider configuration is needed.
- There is a configurable maximum number of memories that can be injected into context (default: 10, adjustable in settings).
- The system does not automatically extract memories from existing vault notes — only from chat conversations.
- Automatic memory extraction is togglable in settings (enabled by default). Disabling it stops new extraction but preserves existing memories for retrieval.
- The memory store has a configurable maximum size of 5000 memories per vault. When exceeded, the oldest and lowest-relevance memories are pruned automatically.
- Deduplication uses embedding cosine similarity with a configurable threshold to detect semantically overlapping memories.
