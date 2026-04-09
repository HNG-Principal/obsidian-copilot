# Tasks: YouTube Content Processor

**Input**: Design documents from `/specs/006-youtube-processor/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md, contracts/interfaces.md

**Tests**: The specification includes mandatory independent test scenarios for each user story, so story-specific tests are included below.

**Organization**: Tasks are grouped by user story to keep each increment independently implementable and verifiable.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the shared feature scaffolding and align settings entry points before deeper implementation.

- [x] T001 Create shared YouTube feature type definitions in src/services/youtubeContextTypes.ts
- [x] T002 [P] Create canonical YouTube URL parsing utilities in src/services/youtubeUrlParser.ts
- [x] T003 [P] Add canonical YouTube URL parser tests in src/services/youtubeUrlParser.test.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the reusable extractor, cache, formatter, and settings infrastructure required by every story.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [x] T004 Implement disk-backed transcript caching in src/cache/youtubeCache.ts
- [x] T005 [P] Implement transcript formatting and chapter parsing in src/services/youtubeTranscriptFormatter.ts
- [x] T006 [P] Add formatter and chapter parsing tests in src/services/youtubeTranscriptFormatter.test.ts
- [x] T007 Implement caption-provider selection and normalization in src/services/youtubeTranscriptProvider.ts and src/LLMProviders/selfHostServices.ts
- [x] T008 Update YouTube transcript settings defaults and settings UI in src/constants.ts, src/settings/model.ts, and src/settings/v2/components/CopilotPlusSettings.tsx
- [x] T009 Implement the shared extractor orchestration shell in src/services/youtubeExtractor.ts

**Checkpoint**: Shared YouTube processing infrastructure is ready for story-specific integration.

---

## Phase 3: User Story 1 - Video Summarization (Priority: P1) 🎯 MVP

**Goal**: Users can paste a YouTube URL and get a summary-ready transcript context within the expected caption-processing budget.

**Independent Test**: Paste 5 YouTube URLs of varying lengths (5 min, 20 min, 60 min, 90 min, 2 hr) and verify transcript extraction plus structured summaries for each.

### Tests for User Story 1

- [x] T010 [P] [US1] Add extractor success and cache-path tests in src/services/youtubeExtractor.test.ts
- [ ] T011 [P] [US1] Add YouTube tool output tests in src/tools/YoutubeTools.test.ts

### Implementation for User Story 1

- [x] T012 [P] [US1] Complete transcript extraction orchestration and metadata normalization in src/services/youtubeExtractor.ts
- [x] T013 [US1] Route agent YouTube transcript tool calls through the shared extractor in src/tools/YoutubeTools.ts
- [x] T014 [US1] Update tool result formatting for transcript summaries in src/tools/ToolResultFormatter.ts
- [x] T015 [US1] Route pasted and mentioned YouTube URLs through the shared extractor in src/mentions/Mention.ts
- [x] T016 [US1] Build summary-ready YouTube context blocks in src/contextProcessor.ts and src/constants.ts

**Checkpoint**: Pasted or mentioned YouTube URLs produce normalized transcript context that the chat flow can summarize independently.

---

## Phase 4: User Story 2 - Follow-Up Questions About Video Content (Priority: P2)

**Goal**: Processed transcript context stays available for follow-up Q&A with timestamp-aware grounding.

**Independent Test**: Paste a YouTube URL, get the summary, then ask 3 follow-up questions and verify grounded answers with timestamp references.

### Tests for User Story 2

- [ ] T017 [P] [US2] Add YouTube context block compatibility tests in src/context/contextBlockRegistry.test.ts and src/contextProcessor.youtube.test.ts
- [x] T018 [P] [US2] Add project YouTube context loading regression tests in src/LLMProviders/projectManager.youtube.test.ts

### Implementation for User Story 2

- [x] T019 [US2] Update project YouTube URL processing to use the shared extractor in src/LLMProviders/projectManager.ts
- [ ] T020 [US2] Preserve recoverable YouTube context handling in src/context/contextBlockRegistry.ts, src/context/ChatHistoryCompactor.ts, and src/core/ContextCompactor.ts
- [x] T021 [US2] Add timestamp-aware transcript content shaping for follow-up answers in src/services/youtubeTranscriptFormatter.ts and src/contextProcessor.ts
- [x] T022 [US2] Normalize inaccessible-video and not-found errors across transcript callers in src/services/youtubeExtractor.ts, src/tools/YoutubeTools.ts, and src/mentions/Mention.ts

**Checkpoint**: Follow-up chat questions can rely on retained YouTube transcript context without breaking compaction or project loading.

---

## Phase 5: User Story 3 - Save Transcript to Vault (Priority: P3)

**Goal**: Users can save a processed transcript as a structured markdown note with metadata, timestamps, and duplicate handling.

**Independent Test**: Process a YouTube video, invoke the save flow, and verify a markdown note is created with title, URL, timestamps, and transcript content.

### Tests for User Story 3

- [x] T023 [P] [US3] Add transcript note writer tests in src/services/youtubeTranscriptNoteWriter.test.ts
- [x] T024 [P] [US3] Add modal transcript export flow tests in src/components/modals/YoutubeTranscriptModal.test.tsx

### Implementation for User Story 3

- [x] T025 [P] [US3] Implement transcript note writing and collision handling in src/services/youtubeTranscriptNoteWriter.ts
- [x] T026 [US3] Add transcript output folder settings and defaults in src/constants.ts, src/settings/model.ts, and src/settings/v2/components/CopilotPlusSettings.tsx
- [x] T027 [US3] Update the YouTube transcript modal to use the shared extractor and note writer in src/components/modals/YoutubeTranscriptModal.tsx
- [ ] T028 [US3] Update the YouTube transcript command flow to support vault export in src/commands/index.ts

**Checkpoint**: Users can export processed transcripts into the vault as stable markdown notes without overwriting unrelated content accidentally.

---

## Phase 6: User Story 4 - Fallback Transcription for Videos Without Captions (Priority: P4)

**Goal**: Videos without captions can fall back to a configurable remote audio transcription path with progress and clear failures.

**Independent Test**: Use a video without captions and verify the extractor attempts configured audio fallback and returns either a usable transcript or a clear failure message.

### Tests for User Story 4

- [ ] T029 [P] [US4] Add audio transcription provider contract tests in src/services/audioTranscriptionProvider.test.ts
- [ ] T030 [P] [US4] Add no-caption fallback extractor tests in src/services/youtubeExtractor.audioFallback.test.ts

### Implementation for User Story 4

- [x] T031 [P] [US4] Add audio transcription provider contracts and settings in src/services/audioTranscriptionProvider.ts, src/services/youtubeContextTypes.ts, and src/settings/model.ts
- [x] T032 [US4] Implement extractor fallback orchestration for no-caption videos in src/services/youtubeExtractor.ts and src/services/youtubeTranscriptProvider.ts
- [ ] T033 [US4] Surface fallback progress and final status in src/tools/YoutubeTools.ts, src/tools/ToolResultFormatter.ts, and src/components/modals/YoutubeTranscriptModal.tsx
- [x] T034 [US4] Route fallback-capable error handling through mentions and project context in src/mentions/Mention.ts and src/LLMProviders/projectManager.ts

**Checkpoint**: Captionless videos have a defined fallback path and user-visible status, without introducing bundled binaries.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finish feature-wide docs, quality gates, and quickstart validation.

- [x] T035 [P] Update YouTube feature documentation in docs/context-and-mentions.md, docs/agent-mode-and-tools.md, docs/copilot-plus-and-self-host.md, and docs/chat-interface.md
- [ ] T036 Run quickstart validation and repository quality gates via specs/006-youtube-processor/quickstart.md, npm run lint, npm run test, and npm run build

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup**: No dependencies.
- **Phase 2: Foundational**: Depends on Phase 1 completion and blocks all user stories.
- **Phase 3: US1**: Depends on Phase 2 completion.
- **Phase 4: US2**: Depends on Phase 2 completion and reuses US1 transcript/context outputs.
- **Phase 5: US3**: Depends on Phase 2 completion and reuses US1 transcript outputs.
- **Phase 6: US4**: Depends on Phase 2 completion and extends the extractor built for US1.
- **Phase 7: Polish**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: No user-story dependency after foundational work.
- **US2 (P2)**: Requires the shared transcript context pipeline from US1.
- **US3 (P3)**: Requires the processed transcript objects from US1.
- **US4 (P4)**: Requires the extractor/provider stack from US1 and shared settings infrastructure.

### Within Each User Story

- Tests should be added before or alongside implementation and must fail before the implementation is considered complete.
- Provider/parser/cache work comes before UI or integration wiring.
- Context and tool integration should happen before story-level validation.

### Parallel Opportunities

- `T002` and `T003` can run in parallel after `T001`.
- `T005` and `T006` can run in parallel while `T004` and `T007` proceed independently.
- US1 test tasks `T010` and `T011` can run in parallel.
- US2 test tasks `T017` and `T018` can run in parallel.
- US3 test tasks `T023` and `T024` can run in parallel.
- US4 test tasks `T029` and `T030` can run in parallel.
- Documentation `T035` can proceed once the user-facing behaviors are stable.

---

## Parallel Example: User Story 1

```bash
# Run US1 test authoring in parallel:
Task: "Add extractor success and cache-path tests in src/services/youtubeExtractor.test.ts"
Task: "Add YouTube tool output tests in src/tools/YoutubeTools.test.ts"

# Then parallelize leaf implementation work:
Task: "Complete transcript extraction orchestration and metadata normalization in src/services/youtubeExtractor.ts"
Task: "Build summary-ready YouTube context blocks in src/contextProcessor.ts and src/constants.ts"
```

## Parallel Example: User Story 2

```bash
Task: "Add YouTube context block compatibility tests in src/context/contextBlockRegistry.test.ts and src/contextProcessor.youtube.test.ts"
Task: "Add project YouTube context loading regression tests in src/LLMProviders/projectManager.youtube.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Add transcript note writer tests in src/services/youtubeTranscriptNoteWriter.test.ts"
Task: "Add modal transcript export flow tests in src/components/modals/YoutubeTranscriptModal.test.tsx"
```

## Parallel Example: User Story 4

```bash
Task: "Add audio transcription provider contract tests in src/services/audioTranscriptionProvider.test.ts"
Task: "Add no-caption fallback extractor tests in src/services/youtubeExtractor.audioFallback.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate transcript extraction and summary-ready context with the US1 independent test.

### Incremental Delivery

1. Deliver US1 to establish transcript extraction and summarization.
2. Layer US2 on top of the shared transcript context for follow-up Q&A.
3. Add US3 transcript export once transcript payloads are stable.
4. Finish with US4 fallback transcription once primary caption extraction is solid.

### Suggested MVP Scope

- **MVP**: Phase 1 + Phase 2 + Phase 3 (US1 only).
- This delivers the primary user value with the least infrastructure risk.

---

## Notes

- Every task follows the required checklist format: checkbox, task ID, optional `[P]`, required `[US#]` for story tasks, and explicit file paths.
- Story phases are designed to remain independently testable even when they reuse foundational extractor infrastructure.
- The checklist above reflects the implementation state as of 2026-04-09. Remaining open items are intentionally left unchecked because they still need dedicated fallback tests, additional compatibility coverage, command-flow updates, or full repository-wide quality-gate completion.
- No extension hooks are registered for this repository, so no pre- or post-task hook execution is required.
