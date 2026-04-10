**PRODUCT REQUIREMENTS DOCUMENT**

**Obsidian Copilot Plus**

Self-Hosted Feature Implementation

April 2026

Stack: Next.js • TypeScript • Supabase • Tailwind CSS

Table of Contents

1\. Executive Summary

This PRD defines the full scope of features required to build a
self-hosted implementation of Obsidian Copilot's premium (Plus)
capabilities on top of the existing open-source plugin codebase. The
goal is to replicate and extend the paid feature set using ZnoApps'
existing infrastructure stack: Next.js, TypeScript, Supabase (with
pgvector), and Tailwind CSS.

The project replaces the Brevilabs backend dependency with self-hosted
services, giving ZnoApps full control over data processing, model
selection, and feature evolution. The implementation is broken into six
core feature modules, each described with user stories, technical
architecture, acceptance criteria, and phasing.

2\. Goals & Non-Goals

2.1 Goals

- Replicate all Copilot Plus premium features without dependency on
  Brevilabs servers

- Maintain full data privacy: no user content leaves self-hosted
  infrastructure

- Support BYOK (Bring Your Own Key) for all LLM and embedding
  providers

- Build a modular architecture where each feature can be developed and
  deployed independently

- Leverage Supabase pgvector for all embedding storage and similarity
  search

- Enable extensibility so features can be reused across other ZnoApps
  projects (e.g., DealRadar)

  2.2 Non-Goals

- Building a hosted SaaS offering for external users (this is internal
  tooling)

- Replacing the core open-source chat UI (we build on top of it)

- Mobile-native implementation (Obsidian desktop + web only for now)

- Replicating the bundled copilot-plus-flash model (users will always
  BYOK)

3\. Feature Overview

The following table summarizes all six feature modules, their priority,
and estimated complexity.

---

**\#** **Feature **Priority\*\* **Complexity** **Phase**
Module\*\*

F1 Document P0 --- High Phase 1
Conversion Critical  
 Service

F2 Enhanced Vault P0 --- High Phase 1
Search (Miyo) Critical

F3 AI Agent with P0 --- High Phase 2
Tool Use Critical

F4 Web & URL P1 --- Medium Phase 2
Context Engine Important

F5 YouTube P1 --- Medium Phase 2
Content Important  
 Processor

F6 Composer P1 --- High Phase 3
(In-Chat Note Important  
 Editing)

F7 Projects Mode P2 --- Nice to Medium Phase 3
Have

F8 Long-Term P2 --- Nice to Medium Phase 4
Memory Have

---

4\. F1 --- Document Conversion Service

4.1 Overview

The document conversion service is the backbone of multi-format support.
It converts PDF, EPUB, DOCX, images, and 50+ file types into markdown
that can be ingested by the chat and embedding pipeline. In the paid
Copilot Plus, this processing happens on Brevilabs servers. Our
implementation will be fully self-hosted.

4.2 User Stories

- **US-F1-01:** As a user, I can add a PDF to my chat context and ask
  questions about its content, so I can work with research papers
  without leaving Obsidian.

- **US-F1-02:** As a user, I can add EPUB books as context to chat, so
  I can discuss and take notes on books I'm reading.

- **US-F1-03:** As a user, I can add DOCX, PPTX, and other office
  files as context, so my workflow isn't limited to markdown.

- **US-F1-04:** As a user, converted documents are optionally saved as
  .md files in my vault, so they can be indexed for vault search.

  4.3 Technical Architecture

**Processing Pipeline:**

1.  User triggers file conversion via the Obsidian plugin (@context or
    +Add Context button)

2.  Plugin sends file to self-hosted conversion API endpoint

3.  API routes file to appropriate converter based on MIME type

4.  Converter produces structured markdown output

5.  Markdown is returned to plugin and injected into chat context

6.  Optionally persisted to vault as .md file for future indexing

**Recommended Libraries:**

---

**File Type** **Library / Tool** **Notes**

PDF Docling (IBM) or Docling handles complex
pdf-parse + Tesseract layouts, tables,
OCR figures. Fallback to
pdf-parse for simple
text PDFs.

EPUB epub2txt or pandoc Extract text + chapter
structure into markdown
sections.

DOCX mammoth.js or pandoc mammoth for Node.js
native; pandoc for CLI
pipeline.

PPTX python-pptx + custom Extract slide text,
extractor notes, and embedded
images.

Images Tesseract.js or LLM OCR for scanned docs;
vision API vision API for
diagrams/charts.

CSV/XLSX SheetJS (xlsx) Convert to markdown
tables.

---

**API Design:**

- Endpoint: POST /api/convert

- Input: multipart/form-data with file + options (output format, OCR
  toggle, save-to-vault flag)

- Output: JSON { markdown: string, metadata: { pages, wordCount, title
  } }

- Storage: Supabase Storage for temporary file holding; converted .md
  to vault folder

  4.4 Acceptance Criteria

- PDF files up to 100 pages convert to markdown in under 30 seconds

- OCR accurately extracts text from scanned PDFs with 90%+ accuracy

- Tables in PDFs/DOCX are converted to markdown tables, not flattened
  text

- EPUB chapter structure is preserved as markdown headings

- Converted markdown is immediately usable as chat context

- Optional vault persistence works with configurable output folder

5\. F2 --- Enhanced Vault Search (Miyo Equivalent)

5.1 Overview

The enhanced vault search replaces the basic free-tier vector search
with a production-grade retrieval pipeline. It supports multilingual
embeddings, time-based filtering, hybrid search (semantic + keyword),
and reranking. This is the "Miyo" equivalent in Copilot Plus.

5.2 User Stories

- **US-F2-01:** As a user, I can search my vault using natural
  language and get highly relevant results ranked by semantic
  similarity.

- **US-F2-02:** As a user, I can filter vault search by time range
  (e.g., "notes from last week about project X").

- **US-F2-03:** As a user, I can search across notes written in
  multiple languages and get accurate results.

- **US-F2-04:** As a user, search results are reranked for quality so
  the top results are actually the most useful.

  5.3 Technical Architecture

**Embedding Pipeline:**

7.  On vault open or note change, detect new/modified markdown files

8.  Chunk documents using sliding window (512 tokens, 128 overlap) with
    header-aware splitting

9.  Generate embeddings via configured provider (OpenAI, Cohere, Voyage,
    or local model)

10. Store embeddings in Supabase pgvector table with metadata (file
    path, modified date, headings, tags)

11. Maintain incremental index: only re-embed changed chunks

**Search Pipeline:**

12. Parse user query for time filters and intent

13. Generate query embedding

14. Execute hybrid search: pgvector cosine similarity + Supabase
    full-text search (tsvector)

15. Apply time-based and metadata filters via SQL WHERE clauses

16. Rerank top-N results using cross-encoder model or LLM-based
    reranking

17. Return ranked chunks with source note references

**Supabase Schema:**

---

**Table** **Key Columns** **Purpose**

vault_documents id, file_path, Track all vault
content_hash, documents and change
modified_at, title, detection
tags

vault_chunks id, document_id, Store chunked content
chunk_text, with embeddings
chunk_index,  
 heading_context,  
 embedding (vector)

vault_search_index id, document_id, Full-text search index
searchable_text for hybrid retrieval
(tsvector)

---

**Embedding Model Options:**

---

**Model** **Provider** **Dimensions** **Multilingual** **Notes**

text-embedding-3-small OpenAI 1536 Yes Cost-effective
default

text-embedding-3-large OpenAI 3072 Yes Higher quality,
more storage

embed-multilingual-v3 Cohere 1024 Yes (100+ Best
languages) multilingual
support

voyage-3-lite Voyage AI 512 Yes Fast and
lightweight

nomic-embed-text Local (Ollama) 768 Limited Fully private,
no API cost

---

5.4 Acceptance Criteria

- Incremental indexing re-embeds only changed files on vault open (not
  full re-index)

- Search results return in under 2 seconds for vaults up to 10,000
  notes

- Time-based queries correctly filter by modified date and
  date-formatted titles

- Hybrid search outperforms pure vector search on keyword-heavy
  queries

- Multilingual search returns relevant results across at least 5 major
  languages

- Reranking measurably improves top-5 result relevance vs. raw cosine
  similarity

6\. F3 --- AI Agent with Tool Use

6.1 Overview

The AI agent is the orchestration layer that routes user intent to
specialized tools. It uses LLM function calling (tool use) to dispatch
to vault search, web search, YouTube processing, composer, and other
capabilities. This is the core "@" tool palette in Copilot Plus.

6.2 User Stories

- **US-F3-01:** As a user, I can type @ in the chat to see available
  tools and select one to invoke.

- **US-F3-02:** As a user, the agent automatically decides which tools
  to use based on my query without me having to explicitly select
  them.

- **US-F3-03:** As a user, the agent can chain multiple tools in
  sequence (e.g., search vault then search web for gaps).

  6.3 Technical Architecture

**Tool Registry:**

---

**Tool ID** **Trigger** **Description** **Backend Dependency**

\@vault Vault search Enhanced Supabase pgvector
queries semantic +  
 keyword search  
 over vault

\@websearch Real-time info Web search via Firecrawl / SearXNG /
needs API Tavily

\@youtube YouTube URL in Transcript Supadata /
query extraction + youtube-transcript-api
summarization

\@composer Note editing Apply diffs to Local file system
requests notes from chat

\@url URL in message Fetch and parse Firecrawl / Jina Reader
web page content

\@memory Recall past Query long-term Supabase
context memory store

---

**Agent Loop (using Anthropic / OpenAI tool-use API):**

18. User message arrives in chat

19. System prompt includes tool definitions as JSON schema

20. LLM returns either a text response or a tool_use block

21. If tool_use: execute the tool, return tool_result to LLM

22. LLM synthesizes final response incorporating tool results

23. Support multi-step: LLM can call multiple tools in sequence

**Implementation Notes:**

- Use the Anthropic Messages API with tools parameter for Claude
  models

- Use OpenAI function_call for GPT models

- Abstract tool definitions so they work with both APIs via a unified
  adapter

- Each tool is a standalone module with: schema definition, execute()
  function, and result formatter

  6.4 Acceptance Criteria

- @ palette shows all available tools with descriptions

- Agent correctly routes queries to appropriate tools without explicit
  user selection 90%+ of the time

- Multi-tool chaining works (e.g., vault search followed by web
  search)

- Tool execution errors are gracefully handled and shown to user

- Works with both Anthropic and OpenAI model providers

7\. F4 --- Web & URL Context Engine

7.1 Overview

This module enables two capabilities: (1) real-time web search from
within chat, and (2) fetching and parsing any URL dropped into the chat
as context. Both feed structured content into the LLM context window.

7.2 User Stories

- **US-F4-01:** As a user, I can use \@websearch to get real-time
  information from the internet within my Obsidian chat.

- **US-F4-02:** As a user, I can drop any URL into the chat and the
  content is automatically fetched, parsed, and available as context.

- **US-F4-03:** As a user, I can pull content from X/Twitter posts by
  URL.

  7.3 Technical Architecture

**Web Search Pipeline:**

- Search Provider Options: SearXNG (self-hosted, free), Tavily API
  (paid, high quality), Brave Search API (paid), or Perplexity API
  (paid with built-in summarization)

- Flow: User query → Search API → Top-N result URLs → Fetch + extract
  content → Inject into LLM context

- Rate limiting and caching layer to avoid redundant fetches

**URL Parsing Pipeline:**

- Primary: Firecrawl (self-hostable, handles JS-rendered pages)

- Fallback: Jina Reader API (https://r.jina.ai/{url}) for simple
  extraction

- Output: Clean markdown with title, author, date, and main content

- For X/Twitter: Use official API or Nitter instance for tweet
  extraction

**API Design:**

- POST /api/web/search --- { query, maxResults } → { results: \[{
  title, url, snippet, content }\] }

- POST /api/web/fetch --- { url } → { markdown, metadata }

  7.4 Acceptance Criteria

- Web search returns relevant results in under 5 seconds

- URL parsing correctly extracts main content (not nav, ads, footers)

- JS-rendered pages (SPAs) are correctly handled by Firecrawl

- Twitter/X URLs return tweet text, author, and date

- Content is truncated to fit within LLM context window limits

8\. F5 --- YouTube Content Processor

8.1 Overview

Extracts transcripts from YouTube videos and makes them available as
chat context. Users can summarize, ask questions about, and take notes
on video content without watching the full video.

8.2 User Stories

- **US-F5-01:** As a user, I can paste a YouTube URL in chat and get a
  summary of the video content.

- **US-F5-02:** As a user, I can ask follow-up questions about a
  YouTube video's content.

- **US-F5-03:** As a user, I can save the transcript as a note in my
  vault.

  8.3 Technical Architecture

**Transcript Extraction Options:**

---

**Service** **Type** **Pros** **Cons**

Supadata API Paid API Reliable, handles \$0.001/request
all video types

youtube-transcript-api Self-hosted Free, no API key May break with
(Python) needed YouTube changes

yt-dlp + whisper Self-hosted Works for videos Slow, requires
without captions GPU for Whisper

Innertube API Self-hosted Direct YouTube Fragile, may
(unofficial) data break

---

**Processing Flow:**

24. Extract video ID from YouTube URL

25. Fetch transcript via configured provider

26. Clean and format transcript (remove filler, add timestamps as
    markdown headers)

27. If no transcript available, fall back to yt-dlp + Whisper
    transcription

28. Inject formatted transcript into LLM context

29. Optionally save to vault as timestamped .md note

8.4 Acceptance Criteria

- Transcript extraction works for 95%+ of public YouTube videos with
  captions

- Processing completes in under 10 seconds for videos up to 2 hours

- Timestamp markers allow users to reference specific parts of the
  video

- Fallback to audio transcription works when captions are unavailable

9\. F6 --- Composer (In-Chat Note Editing)

9.1 Overview

The Composer enables users to edit notes directly from the chat
interface using natural language commands. It's conceptually similar to
how Cursor's Apply or Claude Code's file editing works: the LLM
generates a targeted diff and applies it to the file.

9.2 User Stories

- **US-F6-01:** As a user, I can ask the AI to reorganize, tag, or
  clean up a note and see the changes applied directly.

- **US-F6-02:** As a user, I can review proposed changes before
  they're applied (diff preview).

- **US-F6-03:** As a user, I can undo any Composer changes with a
  single action.

- **US-F6-04:** As a user, I can use Composer to generate new content
  and insert it at a specific location in a note.

  9.3 Technical Architecture

**Edit Pipeline:**

30. User invokes \@composer with an editing instruction and target note
    reference

31. Plugin reads current note content and sends it with the instruction
    to LLM

32. LLM returns structured edit operations (via tool use): editFile({
    path, old_text, new_text }) or replaceAll({ path, content })

33. Plugin shows diff preview in chat (green/red highlighting)

34. User accepts or rejects the changes

35. On accept: apply edits to note, create undo snapshot

36. On reject: discard and allow user to refine instruction

**Edit Operation Types:**

---

**Operation** **LLM Tool Schema** **Use Case**

Targeted Edit editFile({ path, Replace specific
old_text, new_text }) section of a note

Full Rewrite replaceAll({ path, Complete reorganization
content }) or reformat

Insert insertAt({ path, Add new content at
position, content }) cursor or heading

Append appendTo({ path, Add content to end of
content }) note

Add Tags updateFrontmatter({ Modify YAML frontmatter
path, frontmatter })

---

9.4 Acceptance Criteria

- Diff preview accurately shows all proposed changes before
  application

- Targeted edits preserve all unchanged content exactly

- Undo restores the note to its exact pre-edit state

- Frontmatter edits don't break YAML formatting

- Multiple sequential edits work without corruption

10\. F7 --- Projects Mode

10.1 Overview

Projects Mode allows users to define scoped contexts (work, personal,
research, etc.) that filter which notes, files, and settings are active
during a chat session. This prevents cross-contamination between
different knowledge domains.

10.2 User Stories

- **US-F7-01:** As a user, I can create named projects with specific
  folder scopes, so vault search only returns notes relevant to my
  current project.

- **US-F7-02:** As a user, each project can have its own system
  prompt, preferred model, and context files.

- **US-F7-03:** As a user, I can switch between projects from the chat
  sidebar.

  10.3 Technical Architecture

**Data Model (Supabase):**

---

**Field** **Type** **Description**

id uuid Primary key

name text Project display name

folder_scopes text\[\] Array of vault folder
paths included in this
project

system_prompt text Custom system prompt
for this project's chat

preferred_model text LLM model identifier

context_files text\[\] Pinned files always
included in context

created_at timestamptz Creation timestamp

---

**Integration Points:**

- Vault search (F2): filter by project's folder_scopes in WHERE clause

- Agent (F3): inject project's system_prompt as prefix to all agent
  calls

- Chat UI: project selector in sidebar header, persist last-used
  project

  10.4 Acceptance Criteria

- Creating a project with folder scopes correctly filters vault search
  results

- Project system prompts are applied to all chat interactions within
  that project

- Switching projects immediately updates the active context

- Projects persist across Obsidian restarts

11\. F8 --- Long-Term Memory

11.1 Overview

Long-term memory gives the AI agent persistent knowledge about the user
across chat sessions. It stores facts, preferences, and context that the
agent can retrieve to provide more personalized and informed responses.

11.2 User Stories

- **US-F8-01:** As a user, the AI remembers facts I've told it in
  previous conversations (e.g., my role, preferences, project
  context).

- **US-F8-02:** As a user, I can view, edit, and delete stored
  memories.

- **US-F8-03:** As a user, memories are automatically extracted from
  conversations without me having to explicitly save them.

  11.3 Technical Architecture

**Memory Pipeline:**

37. After each chat session, run an extraction prompt against the
    conversation

38. LLM extracts structured facts: { category, fact, confidence,
    source_chat_id }

39. Deduplicate against existing memories (semantic similarity check)

40. Store in Supabase with embedding for retrieval

41. On new chat, retrieve top-K relevant memories based on initial user
    message

42. Inject memories into system prompt as background context

**Supabase Schema:**

---

**Field** **Type** **Description**

id uuid Primary key

category text preference \| fact \|
project_context \|
relationship

content text The memory content

embedding vector(1536) For semantic retrieval

confidence float Extraction confidence
score

source_chat_id uuid Reference to
originating chat

created_at timestamptz When the memory was
stored

updated_at timestamptz Last update

---

11.4 Acceptance Criteria

- Memories persist across Obsidian restarts and new chat sessions

- Relevant memories are retrieved and used in context within 1 second

- Users can view all stored memories in a settings/management UI

- Users can edit or delete individual memories

- Duplicate facts are merged rather than creating redundant entries

12\. Technical Infrastructure

12.1 System Architecture

The self-hosted backend runs as a Next.js API route layer (or standalone
Express/Fastify service) alongside Supabase for persistence. The
Obsidian plugin communicates with this backend instead of Brevilabs
servers.

**Component Map:**

---

**Component** **Technology** **Purpose**

Plugin (Frontend) TypeScript + Obsidian Chat UI, tool palette,
API file access, diff
preview

API Server Next.js API Routes or Document conversion,
Fastify search, web fetch,
YouTube

Database Supabase (PostgreSQL + Embeddings, memories,
pgvector) projects, chat history

Object Storage Supabase Storage Temporary file uploads,
converted documents

Embedding Service OpenAI / Cohere / Local Generate text
(Ollama) embeddings

LLM Provider Anthropic / OpenAI / Chat completions + tool
OpenRouter / Ollama use

Web Scraper Firecrawl (self-hosted) URL content extraction
or Jina

Search Engine SearXNG (self-hosted) Web search results
or Tavily

---

12.2 Configuration Schema

All services are configured via a single JSON config in the plugin
settings, mapping to environment variables on the backend:

---

**Config Key** **Required** **Default** **Description**

api.baseUrl Yes http://localhost:3000 Self-hosted
backend URL

llm.provider Yes anthropic LLM provider
(anthropic,
openai,
openrouter,
ollama)

llm.apiKey Yes --- API key for LLM
provider

llm.model Yes claude-sonnet-4-20250514 Model identifier

embedding.provider Yes openai Embedding
provider

embedding.model Yes text-embedding-3-small Embedding model

search.provider No searxng Web search
provider

search.apiKey Conditional --- API key if using
paid search

youtube.provider No youtube-transcript-api YouTube
transcript
provider

scraper.provider No jina URL scraper
provider

---

13\. Phasing & Roadmap

---

**Phase** **Timeline** **Features** **Milestone**

Phase 1 Weeks 1--4 F1 (Document Core retrieval
Conversion) + F2 pipeline
(Enhanced Search) operational

Phase 2 Weeks 5--8 F3 (Agent) + F4 Full agent with
(Web/URL) + F5 external data
(YouTube) sources

Phase 3 Weeks 9--12 F6 (Composer) + Complete editing
F7 (Projects) and scoping
capabilities

Phase 4 Weeks 13--14 F8 (Long-Term Persistent
Memory) personalization
layer

---

**Dependencies Between Features:**

- F3 (Agent) depends on F2 (Search) for \@vault tool

- F3 (Agent) depends on F4 (Web) for \@websearch and \@url tools

- F3 (Agent) depends on F5 (YouTube) for \@youtube tool

- F6 (Composer) depends on F3 (Agent) for tool dispatch

- F7 (Projects) depends on F2 (Search) for scoped search filtering

- F8 (Memory) depends on F3 (Agent) for \@memory tool and extraction
  pipeline

14\. Risks & Mitigations

---

**Risk** **Impact** **Likelihood** **Mitigation**

YouTube F5 unavailable Medium Implement fallback
transcript API chain: Supadata →
breaks due to youtube-transcript-api →
upstream changes yt-dlp+Whisper

Obsidian plugin Plugin breaks on Low Pin Obsidian version in
API changes break update dev, test against beta
integration releases

pgvector Slow search Medium Use IVFFlat or HNSW
performance index, partition by
degrades at scale project
(100K+ chunks)

LLM tool-use Agent routing Medium Normalize tool schemas,
inconsistency fails add provider-specific
across providers adapters

Document Poor context High Implement quality
conversion quality scoring; fallback to LLM
quality varies by vision for complex
file type layouts

Self-hosted infra Dev time sink Medium Use Docker Compose for
adds maintenance single-command
burden for deployment; defer
2-person team self-hosting search to
Phase 2+

---

15\. Success Metrics

---

**Metric** **Target** **Measurement**

Vault search relevance \> 80% Manual evaluation on 50
(top-5 precision) test queries

Document conversion \> 95% Automated test suite
success rate across file types

Agent tool routing \> 90% Log and review 100
accuracy agent interactions

End-to-end response \< 8 seconds P95 latency monitoring
latency (with tools)

Memory retrieval \> 75% Manual evaluation on
relevance recall accuracy

---

16\. Open Questions

- Should document conversion run in-process (Node.js) or as a separate
  Python microservice for access to Docling/Tesseract?

- Should we use Obsidian's built-in search API as a complement to
  pgvector, or fully replace it?

- Is there a need for a standalone desktop app (like Copilot's Miyo
  app) or is the plugin + backend sufficient?

- Should chat history be stored in Supabase or kept as local .md files
  in the vault?

- How should we handle token budget management when combining vault
  context + web context + memory in a single prompt?
