# Quickstart: Projects Mode

**Feature**: `008-projects-mode` | **Date**: 2026-04-08

---

## Implementation Order

### Step 1: Extend ProjectConfig Type

Modify `src/settings/model.ts`:

- Add optional fields to `ProjectConfig`: `modelOverride`, `temperatureOverride`, `searchScope`, `templateId`, `tags`, `createdAt`, `lastAccessedAt`
- Add `ProjectTemplate` type
- Add `projectTemplates` array to `CopilotSettings`
- Add `defaultSearchScope` setting
- All new fields optional for backwards compatibility

### Step 2: Project Config Validation

Add validation pure function:

- `validateProjectConfig(config)`: check required fields, valid paths, valid ranges
- Unit tests for validation edge cases

### Step 3: Enhance ProjectManager

Modify `src/services/ProjectManager.ts`:

- `createProject(config)`: generate ID, set timestamps, persist to settings
- `createFromTemplate(templateId, overrides)`: merge template + overrides
- `updateProject(projectId, updates)`: validate, merge, persist
- `deleteProject(projectId, archiveHistory)`: remove from settings, optionally clean chat history
- `switchProject(projectId)`: orchestrate switch (save current, load target, refresh context)
- Update `lastAccessedAt` on access

### Step 4: Project-Scoped Search

Modify `src/search/VectorStoreManager.ts`:

- Accept optional `pathFilter: string[]` in search methods
- When project has `searchScope === 'project'`: compute path filter from project folders
- Apply filter post-retrieval (filter results by path prefix)
- Add `computeSearchPathFilter(includeFolders, excludeFolders)` pure function

### Step 5: Project Context Refresh

Modify `src/cache/projectContextCache.ts`:

- `refreshForProject(projectId)`: re-scan project folders, update cached context
- `isContextReady(projectId)`: check if refresh is complete
- Background async refresh with `ProjectLoadTracker` coordination
- Show loading indicator in UI while refreshing

### Step 6: Project Chain Overrides

Modify `src/LLMProviders/ProjectChainRunner.ts`:

- Apply `modelOverride` when creating LLM chain
- Apply `temperatureOverride` when specified
- Fall back to global settings when overrides not set

### Step 7: Project Templates UI

Modify `src/components/project/` UI:

- "Save as Template" button on project settings panel
- "Create from Template" option in project creation dialog
- Template picker showing saved templates
- Template management (rename, delete) in settings

### Step 8: Auto-Save on Switch

Modify `src/core/ChatPersistenceManager.ts`:

- Auto-save current project's chat before switching
- Load new project's latest chat on switch
- Guard: don't overwrite if MessageRepository is empty (user hasn't chatted)

---

## Prerequisites

- Existing `ProjectManager` singleton functional
- Existing `ProjectChainRunner` functional
- Existing `projectMessageRepos` in ChatManager working
- Existing `ChatPersistenceManager` functional with project prefix support
- Existing `projectContextCache` functional
- No new external dependencies required

---

## Verification Checklist

- [ ] New project created with valid config
- [ ] Project created from template has pre-filled fields
- [ ] Project list shows all projects with last accessed time
- [ ] Switching project changes chat history immediately
- [ ] Previous project's chat auto-saved on switch
- [ ] New project's chat history loaded on switch
- [ ] Context refresh runs in background after switch
- [ ] Loading indicator shown during context refresh
- [ ] Vector search respects project folder scope
- [ ] Model override applied to LLM calls
- [ ] Temperature override applied to LLM calls
- [ ] Fallback to global settings when no override
- [ ] Project deletion removes from settings
- [ ] Project deletion optionally archives chat history
- [ ] Template saved from existing project
- [ ] Template pre-fills new project creation
- [ ] All validation rules enforced (name, folders, ranges)
- [ ] Backwards compatible — existing projects work unchanged

---

## Key Files Reference

| File                                     | Purpose                                   |
| ---------------------------------------- | ----------------------------------------- |
| `src/services/ProjectManager.ts`         | Project lifecycle management (modified)   |
| `src/LLMProviders/ProjectChainRunner.ts` | Project LLM overrides (modified)          |
| `src/cache/projectContextCache.ts`       | Project context caching (modified)        |
| `src/search/VectorStoreManager.ts`       | Project-scoped search (modified)          |
| `src/core/ChatManager.ts`                | Project message repo switching (modified) |
| `src/core/ChatPersistenceManager.ts`     | Auto-save on switch (modified)            |
| `src/components/project/`                | Project UI components (modified)          |
| `src/settings/model.ts`                  | ProjectConfig schema extension (modified) |
