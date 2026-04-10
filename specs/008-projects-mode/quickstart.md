# Quickstart: Projects Mode

**Feature**: `008-projects-mode` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: Extend ProjectConfig Type

Modify `src/aiParams.ts`:

- Add optional field to `ProjectConfig`: `pinnedFiles`
- Add `ProjectState` type

Modify `src/settings/model.ts`:

- Add `activeProjectId: string | null` to persisted settings for startup restoration
- Keep `pinnedFiles` optional for backwards compatibility
- Note: `projectModelKey`, `modelConfigs.temperature`, `contextSource.inclusions/exclusions` already exist

### Step 2: Project Config Validation

Add validation pure function:

- `validateProjectConfig(config)`: check required fields, valid inclusions/exclusions patterns, valid temperature range
- Unit tests for validation edge cases

### Step 3: Enhance ProjectManager

Modify `src/LLMProviders/projectManager.ts`:

- `createProject(config)`: generate ID, set timestamps, persist to settings
- `updateProject(projectId, updates)`: validate, merge, persist
- `deleteProject(projectId, archiveHistory)`: remove from settings, optionally clean chat history
- `clearProject()`: exit project mode and restore vault-wide behavior
- `listProjects()`: convenience read for UI
- `getProjectState(projectId)`: expose loading/readiness to UI
- `switchProject(project)` already exists — harden with auto-save current chat and better error handling
- `restoreActiveProject()`: rehydrate the last active project on plugin startup
- `touchProjectUsageTimestamps(project)` already exists for last-accessed tracking

### Step 4: Harden Project-Scoped Search

Search scoping is already implemented via `ProjectContextCache` using `contextSource.inclusions/exclusions` patterns. This step hardens it:

- Verify `ProjectContextCache.get(project)` correctly scopes markdown discovery to `contextSource.inclusions`
- Verify `contextSource.exclusions` patterns are applied
- Add `computeSearchPathFilter(inclusions: string, exclusions: string)` pure function for testable path matching
- No changes to `VectorStoreManager` — project scoping stays in the context layer

### Step 5: Project Context Refresh

Modify `src/cache/projectContextCache.ts`:

- `refreshForProject(project)`: re-scan project folders, update cached context
- `isContextReady(projectId)`: check if refresh is complete
- Background async refresh with `ProjectLoadTracker` coordination
- Show loading indicator in UI while refreshing

### Step 6: Project Chain Overrides

Modify `src/LLMProviders/chainRunner/ProjectChainRunner.ts` (currently a thin wrapper):

- Apply `projectModelKey` when creating LLM chain (may already work via ProjectManager)
- Apply `modelConfigs.temperature` when specified
- Fall back to global settings when overrides not set
- Note: Project system prompt injection happens in `ChatManager.injectProcessedUserCustomPromptIntoSystemPrompt()`

### Step 7: Pinned Files UI

Modify existing project UI components:

- `src/components/modals/project/AddProjectModal.tsx`: Add pinned files picker in project creation/edit dialog
- `src/components/chat-components/ProjectList.tsx`: Show pinned file count and active/loading state in the project list
- Add pinned file add/remove flows in `AddProjectModal`

### Step 8: Auto-Save on Switch

Modify `src/core/ChatPersistenceManager.ts`:

- Auto-save current project's chat before switching
- Load new project's latest chat on switch
- Guard: don't overwrite if MessageRepository is empty (user hasn't chatted)

### Step 9: Restore Active Project on Plugin Load

Modify `src/main.ts` and/or `src/LLMProviders/projectManager.ts`:

- Read persisted `activeProjectId` on startup
- Restore the matching project if it still exists
- Fall back to no-project mode if the saved project no longer exists
- Trigger background context refresh after restoration

---

## Prerequisites

- Existing `projectManager.ts` singleton in `src/LLMProviders/` functional
- Existing `ProjectChainRunner` in `src/LLMProviders/chainRunner/` functional
- Existing `projectMessageRepos` in ChatManager working
- Existing `ChatPersistenceManager` functional with project prefix (`{projectId}__`) support
- Existing `projectContextCache` functional with inclusion/exclusion scoping
- Existing `AddProjectModal` and `ProjectList` UI components
- No new external dependencies required

---

## Verification Checklist

- [ ] New project created with valid config
- [ ] Project list shows all projects with last accessed time
- [ ] Switching project changes chat history immediately
- [ ] Previous project's chat auto-saved on switch
- [ ] New project's chat history loaded on switch
- [ ] Context refresh runs in background after switch
- [ ] Loading indicator shown during context refresh
- [ ] No-project mode uses full-vault behavior
- [ ] Project-scoped search excludes non-scoped folders
- [ ] Model override applied to LLM calls
- [ ] Temperature override applied to LLM calls
- [ ] Fallback to global settings when no override
- [ ] Project deletion removes from settings
- [ ] Project deletion optionally archives chat history
- [ ] Pinned files are always included in project context
- [ ] Missing or oversized pinned files are handled gracefully
- [ ] Active project is restored correctly on plugin startup
- [ ] All validation rules enforced (name, folders, ranges)
- [ ] Backwards compatible — existing projects work unchanged

---

## Key Files Reference

| File                                                 | Purpose                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `src/LLMProviders/projectManager.ts`                 | Project lifecycle management (modified)                      |
| `src/LLMProviders/chainRunner/ProjectChainRunner.ts` | Project LLM overrides (modified)                             |
| `src/LLMProviders/projectValidation.ts`              | Project validation + path-filter helpers (new)               |
| `src/cache/projectContextCache.ts`                   | Project context caching (modified)                           |
| `src/core/ChatManager.ts`                            | Project message repo switching + prompt injection (modified) |
| `src/core/ChatPersistenceManager.ts`                 | Auto-save on switch (modified)                               |
| `src/components/chat-components/ProjectList.tsx`     | Project list UI (modified)                                   |
| `src/components/modals/project/AddProjectModal.tsx`  | Project create/edit modal (modified)                         |
| `src/settings/model.ts`                              | Persisted active project setting (modified)                  |
| `src/main.ts`                                        | Active project restoration on startup (modified)             |
