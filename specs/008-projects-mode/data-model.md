# Data Model: Projects Mode

**Feature**: `008-projects-mode` | **Date**: 2026-04-08

---

## Entities

### ProjectConfig (Extended)

The full configuration for a project. Extends the existing `ProjectConfig` type defined in `src/aiParams.ts`.

**Existing fields** (already in codebase):

| Field             | Type                                                                                   | Description                        |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| `id`              | `string`                                                                               | Unique project ID                  |
| `name`            | `string`                                                                               | Display name                       |
| `description`     | `string \| undefined`                                                                  | Project description                |
| `systemPrompt`    | `string`                                                                               | Project-specific system prompt     |
| `projectModelKey` | `string`                                                                               | LLM model key for this project     |
| `modelConfigs`    | `{ temperature?: number; maxTokens?: number }`                                         | Model parameter overrides          |
| `contextSource`   | `{ inclusions?: string; exclusions?: string; webUrls?: string; youtubeUrls?: string }` | Folder scoping + web/YT context    |
| `created`         | `number`                                                                               | Creation timestamp                 |
| `UsageTimestamps` | `number`                                                                               | Last usage timestamp (for sorting) |

**New fields** (added by this feature):

| Field         | Type                    | Description                                             |
| ------------- | ----------------------- | ------------------------------------------------------- |
| `pinnedFiles` | `string[] \| undefined` | Vault-relative files always included in project context |

> **Note**: Folder scoping uses existing `contextSource.inclusions` / `contextSource.exclusions` (glob patterns). Per-project model is `projectModelKey`. Temperature is `modelConfigs.temperature`. No new fields are needed for these capabilities.

### ProjectState

Runtime state for an active project (not persisted).

| Field            | Type      | Description                         |
| ---------------- | --------- | ----------------------------------- |
| `projectId`      | `string`  | Active project ID                   |
| `isContextReady` | `boolean` | Whether context refresh is complete |
| `isLoading`      | `boolean` | Whether project is loading          |
| `messageCount`   | `number`  | Messages in current session         |
| `lastSwitchedAt` | `number`  | Last switch timestamp               |

### PersistedProjectSelection

The persisted project selection stored in plugin settings to restore the active project on startup.

| Field             | Type             | Description                                   |
| ----------------- | ---------------- | --------------------------------------------- |
| `activeProjectId` | `string \| null` | Last active project to restore on plugin load |

---

## Relationships

```
ProjectConfig    1──1   MessageRepository (project → isolated messages)
ProjectConfig    1──1   ProjectContextCache entry (project → cached context)
ProjectConfig    1──*   ChatHistoryFile (project → chat history files)
PersistedProjectSelection 0..1──1 ProjectConfig (activeProjectId → restored project)
```

---

## Validation Rules

1. **Project ID**: Non-empty string, unique across `projectList`
2. **Project name**: Non-empty string
3. **contextSource.inclusions**: Comma-separated glob patterns for valid vault paths
4. **contextSource.exclusions**: Must not completely negate inclusions
5. **projectModelKey**: Must be a valid model key when specified
6. **modelConfigs.temperature**: Must be in range [0.0, 2.0] when specified
7. **pinnedFiles**: Must be vault-relative paths when specified; duplicates should be removed during normalization

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

| Operation               | Frequency                       | Method                                    |
| ----------------------- | ------------------------------- | ----------------------------------------- |
| List projects           | On project dropdown open        | `CopilotSettings.projectList`             |
| Switch project          | Per user selection              | `ProjectManager.switchProject()`          |
| Get active project      | Per message send, context build | `ProjectManager.getCurrentProjectId()`    |
| Refresh project context | Per project switch              | `ProjectContextCache.refreshForProject()` |
| Create project          | Per user action                 | `ProjectManager.createProject()`          |
| Delete project          | Per user action                 | `ProjectManager.deleteProject()`          |
| Update project config   | Per user settings change        | `ProjectManager.updateProject()`          |
| Restore active project  | On plugin load                  | `ProjectManager.restoreActiveProject()`   |
| Scope search to project | Per search query                | `ProjectContextCache.get(project)`        |
| Load project messages   | Per switch                      | `ChatManager.getCurrentMessageRepo()`     |
| Persist project chat    | Per switch/auto-save            | `ChatPersistenceManager.saveChat()`       |
