# Data Model: Projects Mode

**Feature**: `008-projects-mode` | **Date**: 2026-04-08

---

## Entities

### ProjectConfig (Extended)

The full configuration for a project. Extends the existing `ProjectConfig` type.

| Field                 | Type                    | Description                                |
| --------------------- | ----------------------- | ------------------------------------------ |
| `id`                  | `string`                | Unique project ID                          |
| `name`                | `string`                | Display name                               |
| `description`         | `string \| undefined`   | Project description                        |
| `includeFolders`      | `string[]`              | Vault folders scoped to this project       |
| `excludeFolders`      | `string[]`              | Folders to exclude                         |
| `systemPrompt`        | `string \| undefined`   | Project-specific system prompt             |
| `modelOverride`       | `string \| undefined`   | LLM model override for this project        |
| `temperatureOverride` | `number \| undefined`   | Temperature override                       |
| `searchScope`         | `'project' \| 'vault'`  | Vector search scope (default: `'project'`) |
| `templateId`          | `string \| undefined`   | Template this project was created from     |
| `tags`                | `string[] \| undefined` | User-defined tags                          |
| `createdAt`           | `number`                | Creation timestamp                         |
| `lastAccessedAt`      | `number`                | Last access timestamp                      |

### ProjectTemplate

A reusable project configuration template.

| Field         | Type                     | Description                     |
| ------------- | ------------------------ | ------------------------------- |
| `id`          | `string`                 | Unique template ID              |
| `name`        | `string`                 | Template name                   |
| `description` | `string \| undefined`    | Template description            |
| `config`      | `Partial<ProjectConfig>` | Pre-filled configuration fields |
| `createdAt`   | `number`                 | Creation timestamp              |

### ProjectState

Runtime state for an active project (not persisted).

| Field            | Type      | Description                         |
| ---------------- | --------- | ----------------------------------- |
| `projectId`      | `string`  | Active project ID                   |
| `isContextReady` | `boolean` | Whether context refresh is complete |
| `isLoading`      | `boolean` | Whether project is loading          |
| `messageCount`   | `number`  | Messages in current session         |
| `lastSwitchedAt` | `number`  | Last switch timestamp               |

---

## Relationships

```
ProjectConfig    1──0..1 ProjectTemplate (project → template used)
ProjectConfig    1──1   MessageRepository (project → isolated messages)
ProjectConfig    1──1   ProjectContextCache entry (project → cached context)
ProjectConfig    1──*   ChatHistoryFile (project → chat history files)
ProjectTemplate  1──*   ProjectConfig (template → projects created from it)
```

---

## Validation Rules

1. **Project ID**: Non-empty string, unique across `projectList`
2. **Project name**: Non-empty string
3. **Include folders**: All paths must be valid vault paths
4. **Exclude folders**: Must not completely negate include folders
5. **Model override**: Must be a valid model identifier when specified
6. **Temperature override**: Must be in range [0.0, 2.0] when specified
7. **Search scope**: Must be `'project'` or `'vault'`
8. **Template ID**: Must reference an existing template if specified

---

## State Transitions

### Project Lifecycle

```
Created → Active (user switches to it)
Active → Background (user switches away)
Background → Active (user switches back)
Active → Deleted (user deletes project)
Background → Deleted (user deletes project)
```

### Project Switch Flow

```
Switch Initiated → UI Updated (instant) → Messages Loaded → Context Refreshing → Fully Ready
                                                           → Context Cached (skip refresh)
```

---

## Access Patterns

| Operation               | Frequency                       | Method                                         |
| ----------------------- | ------------------------------- | ---------------------------------------------- |
| List projects           | On project dropdown open        | `CopilotSettings.projectList`                  |
| Switch project          | Per user selection              | `ProjectManager.switchProject()`               |
| Get active project      | Per message send, context build | `ProjectManager.getCurrentProjectId()`         |
| Refresh project context | Per project switch              | `ProjectContextCache.refreshForProject()`      |
| Create project          | Per user action                 | `ProjectManager.createProject()`               |
| Delete project          | Per user action                 | `ProjectManager.deleteProject()`               |
| Update project config   | Per user settings change        | `ProjectManager.updateProject()`               |
| Save as template        | Per user action                 | Settings: push to `projectTemplates`           |
| Create from template    | Per user action                 | Pre-fill `ProjectConfig` from template         |
| Scope search to project | Per search query                | `VectorStoreManager.search()` with path filter |
| Load project messages   | Per switch                      | `ChatManager.getCurrentMessageRepo()`          |
| Persist project chat    | Per switch/auto-save            | `ChatPersistenceManager.saveChat()`            |
