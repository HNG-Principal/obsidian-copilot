# Copilot Plus and Self-Host

**Copilot Plus** is a premium tier that unlocks advanced features beyond the free, API-key-based experience. **Self-Host Mode** is an additional option for Copilot Plus Lifetime/Believer subscribers who want to run their own infrastructure.

---

## Copilot Plus

### What Is Copilot Plus?

Copilot Plus is a subscription that enables:

- **Autonomous agent mode** — AI that reasons step-by-step and uses tools automatically
- **File editing tools** — Write to File and Replace in File for AI-driven note editing
- **Web search** — Search the internet from chat
- **YouTube transcription** — Fetch video transcripts and use them as context
- **Memory system** — Persistent memory across conversations
- **Copilot Plus Flash model** — A built-in model that requires no separate API key
- **URL processing** — Fetch and summarize web pages as context
- **Copilot Plus embedding models** — High-quality embeddings for semantic search

### Setting Up Copilot Plus

1. Get a license key from your dashboard at **https://www.obsidiancopilot.com/en/dashboard**
2. Go to **Settings → Copilot → Basic** (or the Plus banner in the settings)
3. Enter your license key in the **Copilot Plus License Key** field
4. Features unlock automatically

---

## Copilot Plus Flash Model

**Copilot Plus Flash** is a built-in AI model included with your Copilot Plus subscription:

- No separate API key needed
- Works out of the box once your license key is active
- Supports vision (image inputs)
- Good for general-purpose tasks

It appears as `copilot-plus-flash` in the model selector.

---

## Memory System

The memory system lets Copilot remember things across conversations, so you don't have to repeat yourself.

### Recent Conversations

Copilot can reference your recent conversation history to provide more contextually relevant responses. This is separate from the current chat window — it's a summary of what you've been working on.

- **Enable**: **Settings → Copilot → Plus → Reference Recent Conversation** (on by default)
- **How many**: **Settings → Copilot → Plus → Max Recent Conversations** — default 30, range 10–50
- All history is stored locally in your vault (no data leaves your machine for this feature)

### Saved Memories

You can ask Copilot to explicitly remember specific facts about you:

```
@memory remember that I'm preparing for JLPT N3 and prefer bullet-point summaries
```

Copilot saves this to a memory file in your vault and references it in future conversations.

- **Enable**: **Settings → Copilot → Plus → Reference Saved Memories** (on by default)
- **Memory folder**: **Settings → Copilot → Plus → Memory Folder Name** — default: `copilot/memory`
- **Update memory tool**: The AI can add, update, or remove memories when you ask

---

## Document Processor

When Copilot processes supported non-markdown files in Plus mode, it converts them to markdown for the AI to read.

Supported formats include:

- **PDFs**
- **Word documents** (`.docx`, `.doc`)
- **PowerPoint presentations** (`.pptx`, `.ppt`)
- **Excel spreadsheets** (`.xlsx`, `.xls`)
- **Delimited text files** (`.csv`, `.tsv`)
- **EPUB ebooks**
- **Supported image files** such as `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, and `.webp` (some setups may also support `.svg`)

Image attachments are read with OCR. Some image types may also depend on your current parser support.

Copilot keeps each converted attachment grouped with its source filename and basic document details so the AI can stay oriented while answering questions about it.

You can optionally save the converted markdown to a folder in your vault:

- **Setting**: **Settings → Copilot → Plus → Store converted markdown at**
- Leave empty to skip saving (conversion still happens, it just isn't persisted)
- If you explicitly choose to save a converted attachment and this setting is empty at that moment, Copilot uses a default folder named **Converted Documents** in your vault root

---

## Self-Host Mode

### What Is Self-Host Mode?

Self-Host Mode lets you replace Copilot's cloud services with your own infrastructure. Instead of relying on Copilot's Plus backend, you run everything locally or on your own server.

**Requires**: A Copilot Plus Lifetime or Believer license (not available on monthly subscriptions).

### What Self-Host Mode Enables

- Use local or custom LLM servers
- Custom web search via Firecrawl, Perplexity Sonar, or SearXNG
- Local YouTube transcript extraction via Supadata
- Miyo desktop app for local PDF parsing, semantic search, and more

### Enabling Self-Host Mode

1. Go to **Settings → Copilot → Plus**
2. Under **Self-Host Mode**, toggle **Enable Self-Host Mode**
3. Copilot validates your license. If valid, the toggle activates.
4. Toggle **Enable Miyo** to use the Miyo desktop app for local search, PDF parsing, and context.
5. _(Optional)_ Set **Remote Miyo Server URL (Optional)** only if Miyo is running on a remote machine. Leave blank to use automatic local service discovery.

### Web Search in Self-Host Mode

Choose your web search provider:

- **Firecrawl** — A web crawling and scraping API. Get a key at firecrawl.dev. Enter it in **Settings → Copilot → Plus → Firecrawl API Key**.
- **Perplexity Sonar** — An AI-powered search API. Get a key at perplexity.ai. Enter it in **Settings → Copilot → Plus → Perplexity API Key**.
- **SearXNG** — Your own metasearch instance. Enter the base URL in **Settings → Copilot → Plus → SearXNG URL**.

Additional self-host web context settings:

- **URL cache TTL (hours)** — Controls how long fetched URL content stays in the local `.copilot/url-cache` directory before it is refreshed.
- **Max URL cache entries** — Caps the number of cached URL entries kept on disk.
- **URL extraction timeout (ms)** — Sets how long Copilot waits for page extraction before returning a timeout error.

Regular URL mentions do not need a separate cloud URL-processing service anymore. Copilot extracts readable page content locally, routes PDF links through document conversion, and uses a rendered fallback when a page is open in Web Viewer and the raw HTML looks incomplete.

### YouTube Transcription in Self-Host Mode

Use your own Supadata API key for YouTube transcript extraction:

- Get a key at supadata.ai
- Enter it in **Settings → Copilot → Plus → Supadata API Key**

---

## Miyo Desktop App

Miyo is a companion desktop app from the same developer that enhances Copilot with local, offline capabilities:

### What Miyo Provides

- **Local semantic search** — Fast vector search without embedding API calls
- **Local PDF parsing** — Converts PDFs to markdown on your machine
- **Context hub** — Manages your indexed documents locally
- **Custom server URL** — Run Miyo on any machine (local or server)

If you use Miyo in Self-Host Mode, PDF parsing stays local. OCR for image attachments may still use the vision-capable model endpoint you configured, because image reading depends on your selected vision model.

### Setting Up Miyo

1. Download and install the Miyo desktop app
2. Start the Miyo server
3. In Copilot, go to **Settings → Copilot → Plus → Enable Miyo Search**
4. Miyo automatically connects to the local server (or use **Remote Miyo Server URL (Optional)** if Miyo is running elsewhere)
5. Index your vault — Copilot will use Miyo to generate and store embeddings locally

### Remote Miyo Server URL (Optional)

If Miyo is running on a different machine (e.g., a home server), enter its address:

```
http://192.168.1.10:8742
```

Leave empty to use automatic local discovery.

---

## Related

- [Agent Mode and Tools](agent-mode-and-tools.md) — Using the autonomous agent
- [Vault Search and Indexing](vault-search-and-indexing.md) — How Miyo enhances semantic search
- [Getting Started](getting-started.md) — First-time setup
