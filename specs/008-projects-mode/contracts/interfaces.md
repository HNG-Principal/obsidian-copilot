# Interface Contracts: Projects Mode

**Feature**: `008-projects-mode` | **Date**: 2026-04-08

---

## Core Interfaces

### IProjectManager (Extended)

Extends the existing `ProjectManager` singleton at `src/LLMProviders/projectManager.ts`.
Current methods: `getCurrentProjectId()`, `switchProject(project)`, `getCurrentChainManager()`, `getProjectContext()`, `retryFailedItem()`.

```typescript
interface IProjectManager {
  /**
   * Get the currently active project ID.
   * EXISTING — returns string | null (not undefined).
   */
  getCurrentProjectId(): string | null;

  /**
   * Switch to a different project.
   * EXISTING — accepts ProjectConfig, not just projectId.
   * ENHANCED — auto-saves current chat before switching.
   */
  switchProject(project: ProjectConfig): Promise<void>;

  /**
   * Switch to no-project mode (default context).
   * NEW — exits project mode entirely.
   */
  clearProject(): Promise<void>;

  /**
   * Create a new project from configuration.
   * NEW — generates ID, sets timestamps, persists to settings.
   */
  createProject(config: Partial<ProjectConfig>): Promise<ProjectConfig>;

  /**
   * Update an existing project's configuration.
   * NEW — validates, merges, persists. Triggers cache refresh if context changed.
   */
  updateProject(projectId: string, updates: Partial<ProjectConfig>): Promise<void>;

  /**
   * Delete a project. Optionally archives chat history.
   * NEW — removes from settings, optionally cleans chat history files.
   */
  deleteProject(projectId: string, archiveHistory?: boolean): Promise<void>;

  /**
   * Get the runtime state of a project.
   * NEW — returns loading/context readiness state.
   */
  getProjectState(projectId: string): ProjectState | undefined;

  /**
   * List all configured projects.
   * NEW convenience method — currently done via getSettings().projectList.
   */
  listProjects(): ProjectConfig[];

  /**
   * Restore the last active project from persisted settings.
   * NEW — used on plugin startup to rehydrate project mode after restart.
   */
  restoreActiveProject(): Promise<void>;
}
```

### IProjectContextManager

Maps to the existing `ProjectContextCache` at `src/cache/projectContextCache.ts`.
Context scoping uses `contextSource.inclusions/exclusions` from `ProjectConfig`.

```typescript
interface IProjectContextManager {
  /**
   * Refresh context cache for a specific project.
   * EXISTING — scans project folders per contextSource.inclusions and updates cached context.
   */
  refreshForProject(project: ProjectConfig): Promise<void>;

  /**
   * Check if context is ready for a project.
   * NEW — check if refresh is complete.
   */
  isContextReady(projectId: string): boolean;
}
```

---

## Pure Function Type Contracts

### Validate Project Config

```typescript
/**
 * Validate project configuration fields.
 * Returns list of validation errors (empty if valid).
 */
type ValidateProjectConfig = (config: Partial<ProjectConfig>) => string[];
```

### Compute Search Path Filter

```typescript
/**
 * Convert project include/exclude folders into a search path filter.
 * Pure function: normalize comma-separated project folder patterns into include/exclude arrays.
 */
type ComputeSearchPathFilter = (
  inclusions: string,
  exclusions: string
) => { include: string[]; exclude: string[] };
```

---

## Settings Contract

Extended settings in `CopilotSettings`:

| Setting           | Type              | Default | Description                                              |
| ----------------- | ----------------- | ------- | -------------------------------------------------------- |
| `projectList`     | `ProjectConfig[]` | `[]`    | **EXISTING** — list of project configurations (extended) |
| `activeProjectId` | `string \| null`  | `null`  | **NEW** — last active project restored on plugin load    |

New optional fields on existing `ProjectConfig`:

| Field         | Type                    | Default     | Description                                     |
| ------------- | ----------------------- | ----------- | ----------------------------------------------- |
| `pinnedFiles` | `string[] \| undefined` | `undefined` | Pinned project files always included in context |

---

## Event Hooks

| Hook                   | Trigger                     | Handler                                                                                                                           |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Project switched       | User selects a project      | `ProjectManager.switchProject()` → ChatManager switches repo → ChatPersistenceManager saves/loads → ProjectContextCache refreshes |
| Project created        | User creates project        | `ProjectManager.createProject()` → settings updated → context initialized                                                         |
| Project deleted        | User deletes project        | `ProjectManager.deleteProject()` → settings updated → chat history optionally archived                                            |
| Project config updated | User changes settings       | `ProjectManager.updateProject()` → re-apply overrides (model, temp, pinned files, folder scope)                                   |
| Context ready          | Background refresh complete | `ProjectLoadTracker` notifies → UI updates loading indicator                                                                      |
| Chat auto-saved        | Project switch or interval  | `ChatPersistenceManager.saveChat()` with project prefix                                                                           |
| Plugin loaded          | Obsidian startup            | `ProjectManager.restoreActiveProject()` rehydrates active project or falls back to no-project mode                                |
| Search executed        | User or agent queries       | `ProjectContextCache.get(project)` scopes files before the search context is assembled                                            |
