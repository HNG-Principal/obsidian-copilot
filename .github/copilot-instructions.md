# obsidian-copilot Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-08

## Active Technologies

- TypeScript (strict mode) targeting ES2018+ + React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API, MiniSearch (BM25+ full-text engine), existing `EmbeddingManager` (supports OpenAI, Cohere, Google, Ollama, etc.) (003-enhanced-vault-search)
- JSONL snapshot index files in `.copilot/` (existing v3 pattern), index metadata persisted via `indexMetadata.ts`, in-memory MiniSearch ephemeral indices per query (003-enhanced-vault-search)

- TypeScript (strict mode) targeting ES2018+ + React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API (009-long-term-memory)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript (strict mode) targeting ES2018+: Follow standard conventions

## Recent Changes

- 003-enhanced-vault-search: Added TypeScript (strict mode) targeting ES2018+ + React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API, MiniSearch (BM25+ full-text engine), existing `EmbeddingManager` (supports OpenAI, Cohere, Google, Ollama, etc.)

- 009-long-term-memory: Added TypeScript (strict mode) targeting ES2018+ + React 18, Radix UI, Tailwind CSS + CVA, LangChain, Jotai, Obsidian Plugin API

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
