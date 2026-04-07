<!--
  Sync Impact Report
  ==================
  Version change: 0.0.0 → 1.0.0
  Modified principles: N/A (initial ratification)
  Added sections:
    - Core Principles (I through VIII)
    - Technology Stack & Constraints
    - Development Workflow & Quality Gates
    - Governance
  Removed sections: N/A
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ no changes needed
      (Constitution Check section is dynamic)
    - .specify/templates/spec-template.md ✅ no changes needed
      (no constitution references)
    - .specify/templates/tasks-template.md ✅ no changes needed
      (no constitution references)
  Follow-up TODOs: none
-->

# Obsidian Copilot Constitution

## Core Principles

### I. Generalizable Solutions (NON-NEGOTIABLE)

Every code change MUST produce solutions that work universally.

- NEVER add edge-case handling or hardcoded logic for specific
  scenarios (e.g., "piano notes", "daily notes", specific folder
  names). Solutions MUST work for all cases.
- NEVER hardcode folder names, file patterns, or special-case logic.
- If behavior needs to vary, make it **configurable**, not hardcoded.
- Solutions MUST work equally well for any folder structure, naming
  convention, or content type.

**Rationale**: The plugin serves users with wildly different vault
structures. Hardcoded assumptions break for everyone except the
original author.

### II. Clean Architecture

The codebase follows a strict layered architecture:
**Repository → Manager → UIState → React Components**.

- **Single Source of Truth**: Each domain concept MUST have exactly one
  authoritative store (e.g., `MessageRepository` for messages).
- **Computed Views**: Derived data (display messages, LLM messages)
  MUST be computed from the source, never stored separately.
- **Project Isolation**: Each project MUST maintain its own isolated
  state (e.g., separate `MessageRepository` instances per project).
- **Separation of Concerns**: UI components MUST NOT contain business
  logic. Business logic MUST NOT contain UI concerns.

**Rationale**: Clean layering prevents the dual-array synchronization
bugs and state drift that plagued the legacy `SharedState` system.

### III. Prompt Integrity (NON-NEGOTIABLE)

AI prompts, system prompts, and model adapter prompts MUST NOT be
modified unless the user **explicitly** requests the change.

- No "improvements" to prompt wording, ordering, or structure.
- No addition of examples, constraints, or formatting to prompts.
- Prompt content is treated as user-owned configuration.

**Rationale**: Prompt changes have unpredictable downstream effects on
every LLM provider. Users tune prompts deliberately; silent edits
undermine trust and reproducibility.

### IV. Type Safety

TypeScript strict mode is mandatory across the entire codebase.

- No implicit `any`. Strict null checks enabled.
- Use `interface` for object shapes, `type` for unions/aliases.
- Use absolute imports with `@/` prefix
  (e.g., `import { ChainType } from "@/chainFactory"`).
- Prefer `const` assertions and type inference where appropriate.

**Rationale**: Strict typing catches integration errors at compile
time — critical for a plugin that coordinates dozens of LLM providers
with different response shapes.

### V. Structured Logging

All runtime observability MUST go through the logging utilities.

- NEVER use `console.log`, `console.warn`, or `console.error`.
- Use `logInfo()`, `logWarn()`, `logError()` from `@/logger`.
- These utilities already respect the debug flag internally — NEVER
  wrap them in `if (getSettings().debug)`.

**Rationale**: Consistent logging enables debug-mode diagnostics
without polluting the console in production. Direct `console.*` calls
bypass the user's debug preference.

### VI. Testable by Design

Code MUST be structured so that leaf functions are testable with plain
arguments and no mocking of transitive imports.

- **Pass data, not services**: If a function only needs a string
  (e.g., `outputFolder`), accept it as a parameter — not the entire
  settings singleton.
- **Singletons at the edges only**: `getSettings()`,
  `PDFCache.getInstance()`, and similar singletons MUST only be called
  in top-level orchestration (constructors, main entry points).
- **Pure logic in leaf modules**: Extract testable logic into small
  files with minimal imports. Orchestration files call leaf functions
  and pass in dependencies.
- **Litmus test**: "Can I test this by calling it directly with plain
  arguments?" If no, the dependency SHOULD be a parameter instead.
- Unit tests use Jest with TypeScript. Test files live adjacent to
  implementation (`.test.ts`).
- Integration tests require API keys in `.env.test` and are excluded
  from the default test run.

**Rationale**: Deep transitive import chains
(utility → cache → searchUtils → embeddingManager → brevilabsClient)
make mocking brittle and verbose. Dependency injection at function
boundaries keeps tests fast and stable.

### VII. Simplicity & Minimal Overhead

Every addition MUST justify its complexity.

- Do not add features, refactoring, or "improvements" beyond what was
  requested.
- Do not add error handling for scenarios that cannot occur. Validate
  only at system boundaries.
- Do not create helpers or abstractions for one-time operations.
- Functional React components only — no class components.
- Async/await over raw promises. Early returns for error conditions.
- Avoid language-specific lists (e.g., stopwords, action verbs) — use
  language-agnostic approaches instead.

**Rationale**: The plugin ships as a single minified bundle inside
Obsidian. Every unnecessary abstraction adds bundle size, cognitive
load, and maintenance burden.

### VIII. Documentation Discipline

User-facing documentation MUST stay current with code changes.

- When modifying user-facing behavior (new features, changed settings,
  removed functionality), update the corresponding doc in `docs/`.
- Docs are written for non-technical users — no source code
  references. Explain behavior and concepts.
- If a change affects multiple docs, update all of them.
- All functions and methods MUST have JSDoc comments.

**Rationale**: Obsidian Copilot has a broad, largely non-developer
user base. Stale docs erode trust and generate support burden.

## Technology Stack & Constraints

- **Language**: TypeScript (strict mode) targeting ES2018+
- **UI Framework**: React 18 (functional components only)
- **Styling**: Tailwind CSS with class variance authority (CVA);
  source file is `src/styles/tailwind.css` — NEVER edit `styles.css`
  directly (it is generated)
- **UI Primitives**: Radix UI
- **State Management**: Jotai (atomic settings state); React contexts
  for feature-specific state
- **AI Orchestration**: LangChain for chain/memory/tool integration
- **Build**: esbuild (production), Tailwind CLI
- **Testing**: Jest + `@testing-library/react`
- **Linting/Formatting**: ESLint + Prettier (enforced via husky
  pre-commit)
- **License**: AGPL-3.0
- **Platform**: Obsidian plugin environment — `app` is a globally
  available variable; use Obsidian's `requestUrl` over native `fetch`
  to avoid CORS/SSL issues
- **Build prohibition**: NEVER run `npm run dev` — the user handles
  all dev builds manually
- **Streaming**: All LLM responses MUST support real-time streaming
- **Rate limiting**: Implemented for all API calls
- **Caching**: Multi-layer caching for files, PDFs, and API responses

## Development Workflow & Quality Gates

### Before Starting Work

1. Read `AGENTS.md` or `CLAUDE.md` for runtime guidance.
2. Check `TODO.md` for current session context and priorities.
3. Check `designdocs/todo/TECHDEBT.md` for known issues.

### Before Every PR

1. Run `npm run format && npm run lint` — zero warnings, zero errors.
2. Run `npm run test` — all unit tests MUST pass.
3. Run `npm run build` — production build MUST succeed (includes
   TypeScript type-check).
4. If user-facing behavior changed, verify corresponding `docs/` file
   is updated.

### Code Review Expectations

- Every PR MUST be verifiable against this constitution's principles.
- Complexity additions MUST be justified (link to the principle that
  permits them or explain why an exception is warranted).
- AI prompt changes MUST be explicitly called out in the PR
  description.

### Session Management

- Maintain a `TODO.md` file as the single source of truth for
  session progress.
- Update it frequently with completed tasks, pending items,
  architecture decisions, and testing checklists.

## Governance

This constitution is the authoritative source for project standards.
It supersedes conflicting guidance in any other document. When a
conflict is detected, this constitution wins and the other document
SHOULD be updated to align.

- **Amendments**: Any change to this constitution MUST be documented
  with a version bump, a rationale, and a migration plan if existing
  code is affected.
- **Versioning**: MAJOR for principle removals/redefinitions, MINOR
  for new principles or material expansions, PATCH for clarifications
  and typo fixes.
- **Runtime guidance**: Use `AGENTS.md` and `CLAUDE.md` for
  day-to-day development details. Those files MUST NOT contradict
  this constitution.
- **Compliance review**: All PRs and code reviews MUST verify
  adherence to the Core Principles.

**Version**: 1.0.0 | **Ratified**: 2026-04-07 | **Last Amended**: 2026-04-07
