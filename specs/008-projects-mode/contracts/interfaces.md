# Interface Contracts: Projects Mode

**Feature**: `008-projects-mode` | **Date**: 2026-04-08

---

## Core Interfaces

### IProjectManager (Extended)

```typescript
interface IProjectManager {
  /**
   * Get the currently active project ID.
   * Returns undefined when no project is active.
   */
  getCurrentProjectId(): string | undefined;

  /**
   * Switch to a different project.
   * Saves current project's chat, loads target project's state.
   */
  switchProject(projectId: string): Promise<void>;

  /**
   * Switch to no-project mode (default context).
   */
  clearProject(): Promise<void>;

  /**
   * Create a new project from configuration.
   */
  createProject(config: ProjectConfig): Promise<ProjectConfig>;

  /**
   * Create a new project from a template.
   */
  createFromTemplate(
    templateId: string,
    overrides?: Partial<ProjectConfig>
  ): Promise<ProjectConfig>;

  /**
   * Update an existing project's configuration.
   */
  updateProject(projectId: string, updates: Partial<ProjectConfig>): Promise<void>;

  /**
   * Delete a project. Optionally archives chat history.
   */
  deleteProject(projectId: string, archiveHistory?: boolean): Promise<void>;

  /**
   * Get the runtime state of a project.
   */
  getProjectState(projectId: string): ProjectState | undefined;

  /**
   * List all configured projects.
   */
  listProjects(): ProjectConfig[];
}
```

### IProjectContextManager

```typescript
interface IProjectContextManager {
  /**
   * Refresh context cache for a specific project.
   * Scans project folders and updates cached context.
   */
  refreshForProject(projectId: string): Promise<void>;

  /**
   * Get path filters for project-scoped search.
   */
  getSearchPathFilter(projectId: string): string[] | undefined;

  /**
   * Check if context is ready for a project.
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
 * Pure function: project config → array of allowed path prefixes.
 */
type ComputeSearchPathFilter = (includeFolders: string[], excludeFolders: string[]) => string[];
```

### Apply Template to Config

```typescript
/**
 * Merge a project template with user overrides to create a ProjectConfig.
 */
type ApplyTemplate = (
  template: ProjectTemplate,
  overrides: Partial<ProjectConfig>
) => ProjectConfig;
```

---

## Settings Contract

Extended settings in `CopilotSettings`:

| Setting              | Type                   | Default     | Description                                              |
| -------------------- | ---------------------- | ----------- | -------------------------------------------------------- |
| `projectList`        | `ProjectConfig[]`      | `[]`        | **EXISTING** — list of project configurations (extended) |
| `projectTemplates`   | `ProjectTemplate[]`    | `[]`        | **NEW** — saved project templates                        |
| `defaultSearchScope` | `'project' \| 'vault'` | `'project'` | **NEW** — default search scope for new projects          |

New optional fields on existing `ProjectConfig`:

| Field                 | Type                    | Default      | Description           |
| --------------------- | ----------------------- | ------------ | --------------------- |
| `modelOverride`       | `string \| undefined`   | `undefined`  | Override LLM model    |
| `temperatureOverride` | `number \| undefined`   | `undefined`  | Override temperature  |
| `searchScope`         | `'project' \| 'vault'`  | `'project'`  | Search scope          |
| `templateId`          | `string \| undefined`   | `undefined`  | Source template       |
| `tags`                | `string[] \| undefined` | `undefined`  | Organizational tags   |
| `createdAt`           | `number`                | `Date.now()` | Creation timestamp    |
| `lastAccessedAt`      | `number`                | `Date.now()` | Last access timestamp |

---

## Event Hooks

| Hook                   | Trigger                     | Handler                                                                                                                           |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Project switched       | User selects a project      | `ProjectManager.switchProject()` → ChatManager switches repo → ChatPersistenceManager saves/loads → ProjectContextCache refreshes |
| Project created        | User creates project        | `ProjectManager.createProject()` → settings updated → context initialized                                                         |
| Project deleted        | User deletes project        | `ProjectManager.deleteProject()` → settings updated → chat history optionally archived                                            |
| Project config updated | User changes settings       | `ProjectManager.updateProject()` → re-apply overrides (model, temp, search scope)                                                 |
| Context ready          | Background refresh complete | `ProjectLoadTracker` notifies → UI updates loading indicator                                                                      |
| Chat auto-saved        | Project switch or interval  | `ChatPersistenceManager.saveChat()` with project prefix                                                                           |
| Search executed        | User or agent queries       | `VectorStoreManager.search()` applies project path filter                                                                         |
