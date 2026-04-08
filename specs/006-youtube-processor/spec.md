# Feature Specification: YouTube Content Processor

**Feature Branch**: `006-youtube-processor`  
**Created**: 2026-04-07  
**Status**: Draft  
**Input**: User description: "YouTube content processor that extracts transcripts from YouTube videos, supports summarization and Q&A about video content, and optionally saves transcripts as vault notes with timestamp markers"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Video Summarization (Priority: P1)

A user finds a long YouTube video (e.g., a 90-minute conference talk) and wants to quickly understand the key points without watching it. They paste the YouTube URL into the chat, and the system extracts the transcript, then the AI produces a structured summary with key takeaways.

**Why this priority**: Summarization is the primary use case — it delivers the most immediate value for the least user effort. A single URL paste should produce a useful result.

**Independent Test**: Paste 5 YouTube URLs of varying lengths (5 min, 20 min, 60 min, 90 min, 2 hr). Verify transcripts are extracted and summaries are generated for all.

**Acceptance Scenarios**:

1. **Given** a user pastes a YouTube URL with available captions, **When** the message is sent, **Then** the transcript is extracted and a summary is generated within 10 seconds.
2. **Given** a video longer than 60 minutes, **When** the summary is generated, **Then** it includes section headers or topic breakdowns rather than a single block of text.
3. **Given** a video in a non-English language with available captions, **When** summarized, **Then** the summary is provided in the user's preferred language.

---

### User Story 2 - Follow-Up Questions About Video Content (Priority: P2)

After receiving a summary, the user wants to ask specific questions about the video content (e.g., "What did the speaker say about distributed caching?" or "At what point did they discuss the budget?"). The transcript remains available as context, and the AI answers based on the video content, citing approximate timestamps.

**Why this priority**: Follow-up Q&A transforms a one-shot summary into an interactive research session. It makes the video content truly accessible without watching.

**Independent Test**: Paste a YouTube URL, get the summary, then ask 3 follow-up questions about specific details. Verify answers are grounded in the transcript and include timestamp references.

**Acceptance Scenarios**:

1. **Given** a video transcript is already in context, **When** the user asks a follow-up question, **Then** the answer references specific content from the transcript.
2. **Given** the transcript has timestamp markers, **When** the AI answers a question, **Then** the response includes approximate timestamps where the topic was discussed.
3. **Given** the user asks about something not covered in the video, **When** the answer is generated, **Then** the AI clearly states the topic was not found in the video.

---

### User Story 3 - Save Transcript to Vault (Priority: P3)

A user wants to keep a permanent record of a video's content in their vault. They choose to save the transcript (and optionally the summary) as a markdown note. The note includes the video title, URL, timestamp markers as headings, and the full transcript text.

**Why this priority**: Saving to vault creates a permanent, searchable knowledge artifact. It integrates YouTube content into the user's knowledge base for future reference.

**Independent Test**: Process a YouTube video, then invoke the save-to-vault action. Verify a well-formatted markdown note is created with title, URL, timestamps, and transcript.

**Acceptance Scenarios**:

1. **Given** a video has been processed, **When** the user requests saving the transcript, **Then** a markdown note is created in the vault with video title, URL, and full transcript.
2. **Given** the saved note includes timestamp markers, **When** the user reads the note, **Then** timestamps are formatted as headings or markers for easy navigation.
3. **Given** a note already exists for the same video URL, **When** the user saves again, **Then** the system prompts to overwrite or creates a new note with a disambiguated name.

---

### User Story 4 - Fallback Transcription for Videos Without Captions (Priority: P4)

A user pastes a YouTube URL for a video that has no available captions or subtitles. The system detects this, downloads the audio, and generates a transcript using speech-to-text, then proceeds with the normal summarization and Q&A flow.

**Why this priority**: Many valuable videos lack captions. Without fallback transcription, these videos would be completely inaccessible. However, this requires more infrastructure than caption-based extraction, making it a lower priority.

**Independent Test**: Find a YouTube video with no captions. Paste the URL and verify the system falls back to audio transcription and produces a usable transcript.

**Acceptance Scenarios**:

1. **Given** a video has no captions, **When** the transcript extraction fails, **Then** the system automatically falls back to audio-based transcription.
2. **Given** audio transcription is used, **When** the user is waiting, **Then** a progress indicator shows the transcription status (may take longer than caption extraction).
3. **Given** audio transcription fails (e.g., audio is music-only or corrupted), **When** the fallback fails, **Then** the user receives a clear error message explaining why the video cannot be transcribed.

---

### Edge Cases

- What happens when a YouTube URL is for a private or age-restricted video?
- How does the system handle live streams (in progress or ended)?
- What happens with very long videos (>4 hours) whose transcripts exceed the context window?
- How are videos with auto-generated (low-quality) captions handled — is there a quality indicator?
- What happens when the YouTube URL format is non-standard (e.g., short URLs, embedded URLs)?
- How does the system handle videos with multiple audio tracks or language options?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST extract transcripts from YouTube videos using available captions/subtitles.
- **FR-002**: System MUST support fallback audio-based transcription when captions are unavailable.
- **FR-003**: System MUST parse and normalize YouTube URLs in all common formats (full URLs, short URLs, embedded URLs, URLs with timestamps).
- **FR-004**: System MUST format transcripts with timestamp markers for easy navigation and citation.
- **FR-005**: System MUST support saving the transcript (and summary) as a markdown note in the user's vault.
- **FR-006**: System MUST keep the transcript available as conversation context for follow-up questions within the same chat session.
- **FR-007**: System MUST handle videos up to at least 2 hours with available captions within 10 seconds of processing time.
- **FR-008**: System MUST display a clear error when a video is private, age-restricted, or otherwise inaccessible.
- **FR-009**: System MUST extract video metadata (title, channel name, publication date, duration) alongside the transcript.

### Key Entities

- **YouTubeVideo**: Represents a YouTube video to be processed. Key attributes: video ID, URL, title, channel name, publication date, duration, caption availability.
- **VideoTranscript**: The extracted transcript. Key attributes: source video reference, language, segments (text + timestamp pairs), extraction method (captions vs. audio transcription).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Transcript extraction succeeds for 95% of public YouTube videos with available captions.
- **SC-002**: Processing completes within 10 seconds for captioned videos up to 2 hours long.
- **SC-003**: Saved vault notes include title, URL, timestamps, and full transcript in valid markdown format.
- **SC-004**: Follow-up Q&A responses reference specific timestamps from the transcript at least 80% of the time when the question targets a specific topic.
- **SC-005**: Fallback audio transcription produces usable (≥80% accuracy) transcripts for videos without captions.

## Assumptions

- The transcript extraction provider is configurable by the user. The system supports at least one caption-based and one audio-based transcription option.
- Caption-based extraction is significantly faster than audio transcription and is always attempted first.
- For the save-to-vault feature, the output folder is configurable in settings (not hardcoded).
- Video metadata (title, channel, date) is extracted alongside the transcript without requiring additional API calls when possible.
- The system does not download or store video files — only transcripts and metadata are persisted.
