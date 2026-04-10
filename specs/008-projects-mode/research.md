# Research Decisions: Projects Mode

**Feature**: `008-projects-mode` | **Date**: 2026-04-08

---

## 1. Project Configuration Schema

**Decision**: Extend the existing `ProjectConfig` in `CopilotSettings.projectList` only where the approved feature requires new data. Add pinned files to `ProjectConfig` and persist the active project ID separately in settings.

**Rationale**: The existing `ProjectConfig` already stores name, folder scoping, system prompt, and model overrides. The only missing project-level data required by the spec is pinned files. Persisting the active project ID separately allows startup restoration without expanding project config beyond the feature scope.

**Alternatives Considered**:

- **Separate project config file per project**: Rejected — fragmenting settings complicates backup/sync and settings migration.
- **Project config in vault frontmatter**: Rejected — mixes project metadata with vault content. Plugin settings should stay in plugin settings.
- **New `ProjectConfigV2` type with migration**: Considered — overkill for a single additive field. Optional fields on the existing type are sufficient.
- **Templates and organizational tags**: Rejected for this feature — not present in the approved spec and not required to satisfy the user stories.

**Implementation Approach**:

- Already-existing fields that support spec requirements:
  - `projectModelKey` — per-project model selection
  - `modelConfigs.temperature` — per-project temperature
  - `contextSource.inclusions` / `contextSource.exclusions` — folder scoping
  - `systemPrompt` — per-project system prompt
  - `created` — creation timestamp
  - `UsageTimestamps` — last usage timestamp
- Extend `ProjectConfig` (in `src/aiParams.ts`) with optional field:
  - `pinnedFiles?: string[]` — vault-relative files always included in project context
- Persist `activeProjectId: string | null` in settings for startup restoration
- No migration needed — both additions are optional or safely defaultable

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
- **Context**: `ProjectContextCache` scopes context processing to project folders via `contextSource.inclusions/exclusions`
- **Search**: `ProjectContextCache` handles project-scoped file discovery; `VectorStoreManager` remains vault-wide (no path filtering needed at that layer)
- **Prompts**: Project's `systemPrompt` field injected via `ChatManager.injectProcessedUserCustomPromptIntoSystemPrompt()`
- **Chat history**: `ChatPersistenceManager` already prefixes files with project ID (`{projectId}__`) ✅
- **Chains**: `ProjectChainRunner` extends `CopilotPlusChainRunner`; model/temperature from `projectModelKey`/`modelConfigs` applied via `ProjectManager.switchProject()`

---

## 3. Project Switching Strategy

**Decision**: Synchronous UI switch with async context refresh. When user switches projects, immediately update UI to show the target project's message history while refreshing context in the background.

**Rationale**: Users expect instant project switching. Waiting for context refresh (which may involve re-indexing) would feel slow. Showing cached messages immediately and refreshing context asynchronously provides the best UX.

**Alternatives Considered**:

- **Block on context refresh**: Rejected — too slow (up to 3 seconds).
- **Lazy context refresh (on first query)**: Considered — but first query would be slow. Background refresh on switch is better.
- **No context refresh (use cached)**: Risky — vault may have changed since last switch.

**Implementation Approach**:

- `ProjectManager.switchProject(project)`:
  1. Notify `ChatManager` to switch MessageRepository (instant)
  2. Notify `ChatUIState` to trigger re-render (instant)
  3. Persist `activeProjectId` to settings
  4. Start async context refresh: `ProjectContextCache.refreshForProject(project)`
  5. Show loading indicator on context status while refreshing
  6. Use `ProjectLoadTracker` to coordinate loading states
- If user sends message before context is ready: use available cached context, note in UI

---

## 4. Project-Scoped Search

**Decision**: Project-scoped search uses the existing `ProjectContextCache` approach: filter file discovery by `contextSource.inclusions/exclusions` patterns at the context layer. The vector index remains vault-wide.

**Rationale**: The existing architecture already scopes context via `ProjectContextCache`, which reads `contextSource.inclusions/exclusions` patterns from `ProjectConfig`. Adding path filtering to `VectorStoreManager` would duplicate this responsibility and break the current architectural boundary where `ProjectContextCache` owns project scoping.

**Alternatives Considered**:

- **VectorStoreManager path filtering**: Rejected — duplicates scoping logic already in `ProjectContextCache`. Would require `VectorStoreManager` to know about projects, breaking its vault-level abstraction.
- **Separate index per project**: Rejected — wastes storage, requires full reindex on project folder changes.
- **No search scoping**: Rejected — spec requires project-scoped search.

**Implementation Approach**:

- `ProjectContextCache.get(project)` already scopes markdown discovery to `contextSource.inclusions`
- `contextSource.exclusions` already applied during file scanning
- Harden edge cases: empty inclusions = full vault, renamed/deleted folders handled gracefully
- Add `computeSearchPathFilter(inclusions: string, exclusions: string)` pure function for testable path matching logic
- Default behavior: when `contextSource.inclusions` is empty, search entire vault (backward compatible)

---

## 5. Active Project Restoration on Startup

**Decision**: Persist the last active project ID in plugin settings and restore it during plugin startup if the project still exists.

**Rationale**: The spec requires project configuration persistence across Obsidian restarts. Restoring the active project avoids forcing the user to manually reselect the same project on each launch and aligns with the switching workflow.

**Alternatives Considered**:

- **Always start in no-project mode**: Rejected — satisfies persistence only partially and creates unnecessary friction after restart.
- **Store active project only in memory**: Rejected — cannot survive restarts.
- **Restore full project object snapshot**: Rejected — duplicative with `projectList`; only the project ID must be persisted.

**Implementation Approach**:

- Persist `activeProjectId: string | null` in settings whenever `switchProject()` or `clearProject()` runs
- On plugin startup, `ProjectManager.restoreActiveProject()` reads `activeProjectId`
- If the project exists, switch into it and kick off background context refresh
- If the project no longer exists, clear the saved value and continue in no-project mode

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
- File naming: `{projectId}__{chatId}.md` (existing pattern, double underscore prefix)
- Frontmatter includes `projectId` and `projectName` metadata
- On project deletion: offer to archive or delete associated chat history files
