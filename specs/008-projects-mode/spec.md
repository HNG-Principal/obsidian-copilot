# Feature Specification: Projects Mode

**Feature Branch**: `008-projects-mode`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "Projects mode enabling scoped contexts for different knowledge domains, with folder-based filtering, per-project system prompts and model preferences, context file pinning, and quick project switching from the chat sidebar"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Create and Use a Scoped Project (Priority: P1)

A user has multiple knowledge domains (e.g., "Work", "Personal Research", "Side Project"). They create a project called "Work" and scope it to their `Work/` folder. When chatting within this project, vault searches only return notes from that folder, keeping their personal notes out of work conversations.

**Why this priority**: Project creation and scoped filtering is the fundamental capability. Without it, none of the other project features matter.

**Independent Test**: Create a project scoped to one folder. Search for a topic that appears in both scoped and non-scoped folders. Verify only results from the scoped folder are returned.

**Acceptance Scenarios**:

1. **Given** a user creates a project with folder scopes set to `Work/`, **When** they search for a term, **Then** only notes within the `Work/` folder are returned.
2. **Given** a project is scoped to multiple folders (`Work/`, `Meetings/`), **When** a search runs, **Then** results from both folders are included.
3. **Given** a user searches without an active project, **When** results are returned, **Then** the entire vault is searched (no filtering).

---

### User Story 2 - Project Switching (Priority: P2)

A user is chatting in their "Work" project and needs to switch to their "Research" project. They click the project selector in the chat sidebar, select "Research", and the active context immediately changes — the system prompt, model preference, and search scope all update to the Research project's settings.

**Why this priority**: Quick switching is what makes projects practical for daily use. If switching is slow or cumbersome, users won't bother creating projects.

**Independent Test**: Create two projects with different scopes and system prompts. Switch between them via the sidebar. Verify the context, search scope, and system prompt update immediately.

**Acceptance Scenarios**:

1. **Given** two projects exist, **When** the user switches from Project A to Project B, **Then** the active context (search scope, system prompt, model) updates within 1 second.
2. **Given** a user switches projects, **When** the chat interface reloads, **Then** the previous project's chat history is preserved and the new project starts with a fresh or its own chat context.
3. **Given** a user switches projects, **When** the sidebar updates, **Then** the currently active project is clearly indicated.

---

### User Story 3 - Per-Project System Prompt and Model (Priority: P3)

A user configures their "Code Review" project with a system prompt that says "You are a senior software engineer reviewing code. Be concise and focus on bugs and improvements." They also set the preferred model to a faster, cheaper model for quick code reviews. When chatting in this project, all AI interactions use this system prompt and model.

**Why this priority**: Per-project customization is what makes projects more than just search filters — they become dedicated workspaces with tailored AI behavior.

**Independent Test**: Create a project with a custom system prompt and model. Start a chat in that project. Verify the AI behavior reflects the custom system prompt and that the configured model is used.

**Acceptance Scenarios**:

1. **Given** a project with a custom system prompt, **When** the user chats within that project, **Then** all AI responses reflect the custom system prompt's instructions.
2. **Given** a project with a preferred model set, **When** a message is sent, **Then** the configured model is used for the response (not the global default).
3. **Given** a project without a custom system prompt, **When** the user chats, **Then** the global default system prompt is used.

---

### User Story 4 - Pinned Context Files (Priority: P4)

A user pins several key files (e.g., "Project Brief.md", "Architecture Decision Records.md") to their project. These files are always included in the AI's context when chatting within this project, even if the user doesn't explicitly mention them. This gives the AI persistent background knowledge about the project.

**Why this priority**: Pinned files provide persistent context without the user having to re-mention important files every conversation. This is a convenience feature that significantly improves response quality for complex projects.

**Independent Test**: Pin 3 files to a project. Start a new chat in that project. Ask a question that requires knowledge from a pinned file (without mentioning it). Verify the AI uses the pinned file content in its response.

**Acceptance Scenarios**:

1. **Given** a project with pinned context files, **When** a new chat starts, **Then** the pinned files' content is automatically included in the AI context.
2. **Given** the user asks a question related to a pinned file's content, **When** the AI responds, **Then** the response incorporates information from the pinned file.
3. **Given** pinned files change on disk, **When** the user starts a new chat, **Then** the updated content of the pinned files is used.

---

### Edge Cases

- What happens when a project's scoped folder is renamed or deleted?
- How does the system handle pinned files that exceed the context window when combined?
- What happens when the user deletes a project — is the chat history preserved or deleted?
- How are nested folder scopes handled (e.g., project scoped to `Work/` and a note in `Work/Meetings/`)?
- What happens when no project is selected — does the system default to "all vault" behavior?
- How does project state persist across Obsidian restarts and across devices?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST allow users to create named projects with configurable folder scopes (one or more vault folders).
- **FR-002**: System MUST filter vault search results to only include notes within the active project's folder scopes.
- **FR-003**: System MUST support per-project custom system prompts that are applied to all AI interactions within that project.
- **FR-004**: System MUST support per-project preferred model selection (overriding the global default).
- **FR-005**: System MUST support pinned context files per project that are automatically included in AI context.
- **FR-006**: System MUST provide a project selector in the chat sidebar for quick project switching.
- **FR-007**: System MUST maintain isolated chat history per project — switching projects does not merge or overwrite chat histories.
- **FR-008**: System MUST persist project configuration across Obsidian restarts.
- **FR-009**: System MUST support a "no project" mode where the entire vault is used (backward compatible with pre-project behavior).

### Key Entities

- **Project**: A named context scope. Key attributes: name, folder scopes (array of vault paths), custom system prompt (optional), preferred model (optional), pinned context files (array of file paths), creation date.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Project switching updates the active context (search scope, system prompt, model) within 1 second.
- **SC-002**: Vault search within an active project returns zero results from non-scoped folders.
- **SC-003**: Projects and their configurations persist across Obsidian restarts with no data loss.
- **SC-004**: Pinned context files are automatically included in AI context for 100% of conversations within the project.
- **SC-005**: Users can create, configure, and use a project within 2 minutes of first interaction.

## Assumptions

- Project configurations are stored locally within the Obsidian vault (not on a remote server) for v1.
- The existing chat isolation mechanism (separate MessageRepository per project) will be extended to support the new project features.
- Folder scopes support subdirectory matching — scoping to `Work/` includes all files in `Work/` and its subdirectories.
- Per-project model selection only applies if the user has configured the selected model's API key.
- There is no limit on the number of projects a user can create.
