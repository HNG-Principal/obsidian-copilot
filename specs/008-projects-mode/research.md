# Research Decisions: Projects Mode

**Feature**: `008-projects-mode` | **Date**: 2026-04-08

---

## 1. Project Configuration Schema

**Decision**: Extend the existing `ProjectConfig` in `CopilotSettings.projectList` with additional fields for templates, search scoping, and project-specific model overrides.

**Rationale**: The existing `ProjectConfig` already stores name, folders, and system prompt. Extending it with optional fields maintains backwards compatibility while enabling the new features specified in the spec.

**Alternatives Considered**:

- **Separate project config file per project**: Rejected — fragmenting settings complicates backup/sync and settings migration.
- **Project config in vault frontmatter**: Rejected — mixes project metadata with vault content. Plugin settings should stay in plugin settings.
- **New `ProjectConfigV2` type with migration**: Considered — overkill for additive changes. Optional fields on existing type are sufficient.

**Implementation Approach**:

- Extend `ProjectConfig` with optional fields:
  - `modelOverride?: string` — use a different model for this project
  - `temperatureOverride?: number` — project-specific temperature
  - `searchScope?: 'project' | 'vault'` — restrict vector search to project folders
  - `templateId?: string` — template this project was created from
  - `tags?: string[]` — user-defined tags for organization
- No migration needed — all new fields optional
- Settings UI extended with these fields in project edit panel

---

## 2. Project Isolation Architecture

**Decision**: Leverage and harden the existing isolation mechanisms: `ChatManager.projectMessageRepos` for message isolation, `ProjectContextCache` for context isolation, `ProjectChainRunner` for LLM config isolation.

**Rationale**: The existing codebase already has the foundation for project isolation (separate MessageRepository per project, auto-detection via `getCurrentProjectId()`). This feature hardens and extends it rather than rebuilding.

**Alternatives Considered**:

- **Full namespace isolation (separate everything)**: Overkill — some resources (LLM providers, embedding models) should be shared.
- **No isolation beyond chat history**: Insufficient — spec requires context, search, and prompt isolation.
- **Plugin instance per project**: Rejected — Obsidian plugin architecture doesn't support this.

**Implementation Approach**:

- **Messages**: Already isolated via `projectMessageRepos` Map in ChatManager ✅
- **Context**: `ProjectContextCache` scopes context processing to project folders
- **Search**: `VectorStoreManager` filters results by project folders when `searchScope === 'project'`
- **Prompts**: Project's `systemPrompt` field injected via `getEffectiveUserPrompt()`
- **Chat history**: `ChatPersistenceManager` already prefixes files with project ID ✅
- **Chains**: `ProjectChainRunner`applies project-specific model/temperature overrides

---

## 3. Project Switching Strategy

**Decision**: Synchronous UI switch with async context refresh. When user switches projects, immediately update UI to show the target project's message history while refreshing context in the background.

**Rationale**: Users expect instant project switching. Waiting for context refresh (which may involve re-indexing) would feel slow. Showing cached messages immediately and refreshing context asynchronously provides the best UX.

**Alternatives Considered**:

- **Block on context refresh**: Rejected — too slow (up to 3 seconds).
- **Lazy context refresh (on first query)**: Considered — but first query would be slow. Background refresh on switch is better.
- **No context refresh (use cached)**: Risky — vault may have changed since last switch.

**Implementation Approach**:

- `ProjectManager.switchProject(projectId)`:
  1. Notify `ChatManager` to switch MessageRepository (instant)
  2. Notify `ChatUIState` to trigger re-render (instant)
  3. Start async context refresh: `ProjectContextCache.refreshForProject(projectId)`
  4. Show loading indicator on context status while refreshing
  5. Use `ProjectLoadTracker` to coordinate loading states
- If user sends message before context is ready: use available cached context, note in UI

---

## 4. Project-Scoped Search

**Decision**: Filter vector search results by project folder paths at query time, not at index time. The index remains vault-wide.

**Rationale**: A vault-wide index avoids rebuilding when projects change. Query-time filtering is efficient because the metadata already includes file paths. This matches how existing `VectorStoreManager` works with the `filterByPaths` approach.

**Alternatives Considered**:

- **Separate index per project**: Rejected — wastes storage, requires full reindex on project folder changes.
- **Real-time index scoping**: Rejected — complex to maintain incremental indexes per project.
- **No search scoping**: Rejected — spec requires project-scoped search.

**Implementation Approach**:

- `VectorStoreManager.search()` accepts optional `pathFilter: string[]`
- When `project.searchScope === 'project'`: filter by project `includeFolders`
- When `project.searchScope === 'vault'`: no filter (search everything)
- Default: `'project'` — scope to project folders
- Filter applied post-retrieval (after vector similarity) to avoid index changes

---

## 5. Project Templates

**Decision**: Templates are predefined project configurations that users can use as starting points. Stored as `ProjectTemplate` objects in plugin settings.

**Rationale**: Users creating multiple similar projects (e.g., "Research Project", "Writing Project") benefit from templates. Templates reduce setup friction and enforce consistent configuration.

**Alternatives Considered**:

- **No templates**: Considered — but adds significant UX value with minimal code.
- **Templates in vault files**: Rejected — complicates import/export and settings management.
- **Community template marketplace**: Deferred to v2 — local templates only for v1.

**Implementation Approach**:

- `ProjectTemplate`: `{ id, name, description, config: Partial<ProjectConfig> }`
- Built-in templates: none (avoid hardcoding per Constitution I)
- User can save any project as a template
- Creating a project from template pre-fills the configuration
- Templates stored in `CopilotSettings.projectTemplates`

---

## 6. Project-Aware Chat Persistence

**Decision**: Extend existing `ChatPersistenceManager` to fully support project-isolated chat history with reliable save/load cycles.

**Rationale**: `ChatPersistenceManager` already prefixes files with project ID. This decision hardens the persistence to ensure no cross-project leakage and adds auto-save on project switch.

**Alternatives Considered**:

- **Separate persistence manager per project**: Rejected — existing prefix approach works, just needs hardening.
- **Database-backed persistence**: Overkill for v1.
- **No persistence (memory only)**: Rejected — users expect chat history to survive restarts.

**Implementation Approach**:

- Auto-save current project's chat on project switch
- Load target project's chat history on switch
- Clear chat history load guard: only load if MessageRepository is empty for that project
- File naming: `{projectId}_{chatId}.md` (existing pattern)
- On project deletion: offer to archive or delete associated chat history files
