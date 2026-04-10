import ProjectManager from "@/LLMProviders/projectManager";

const executeWithProcessTracking = jest.fn();
const extractTranscript = jest.fn();
const buildYouTubeContextBlock = jest.fn();
const noticeMock = jest.fn();

jest.mock("@/aiParams", () => ({
  getChainType: jest.fn(),
  isProjectMode: jest.fn(() => false),
  setProjectLoading: jest.fn(),
  subscribeToChainTypeChange: jest.fn(),
  subscribeToModelKeyChange: jest.fn(),
  subscribeToProjectChange: jest.fn(),
}));

jest.mock("@/cache/projectContextCache", () => ({
  ProjectContextCache: {
    getInstance: jest.fn(() => ({
      getOrInitializeCache: jest.fn(),
      setCacheSafely: jest.fn(),
      get: jest.fn(),
      invalidateMarkdownContext: jest.fn(),
      removeWebUrls: jest.fn(),
      removeYoutubeUrls: jest.fn(),
    })),
  },
}));

jest.mock("@/chainFactory", () => ({
  ChainType: {},
}));

jest.mock("@/components/CopilotView", () => ({}));
jest.mock("@/constants", () => ({
  CHAT_VIEWTYPE: "copilot-chat",
  VAULT_VECTOR_STORE_STRATEGY: {
    ON_MODE_SWITCH: "on-mode-switch",
  },
}));

jest.mock("@/contextProcessor", () => ({
  buildYouTubeContextBlock: (...args: unknown[]) => buildYouTubeContextBlock(...args),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

jest.mock("@/main", () => class CopilotPlugin {});
jest.mock("@/mentions/Mention", () => ({
  Mention: {
    getInstance: jest.fn(() => ({
      processUrls: jest.fn(),
    })),
  },
}));

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(() => []),
  shouldIndexFile: jest.fn(() => false),
}));

jest.mock("@/services/youtubeTranscriptFormatter", () => ({
  formatYouTubeTimestamp: jest.fn(() => "01:05"),
}));

jest.mock("@/services/youtubeExtractor", () => ({
  YouTubeExtractor: {
    getInstance: () => ({
      extractTranscript,
    }),
  },
}));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({
    projectList: [],
    enableSemanticSearchV3: false,
  })),
  subscribeToSettingsChange: jest.fn(),
  updateSetting: jest.fn(),
}));

jest.mock("@/tools/FileParserManager", () => ({
  FileParserManager: jest.fn().mockImplementation(() => ({})),
  saveConvertedDocOutput: jest.fn(),
}));

jest.mock("@/utils", () => ({
  err2String: jest.fn((error: Error) => error.message),
}));

jest.mock("@/utils/rateLimitUtils", () => ({
  isRateLimitError: jest.fn(() => false),
}));

jest.mock("@/utils/recentUsageManager", () => ({
  RecentUsageManager: jest.fn().mockImplementation(() => ({
    touch: jest.fn(),
    shouldPersist: jest.fn(() => null),
    markPersisted: jest.fn(),
  })),
}));

jest.mock("obsidian", () => ({
  App: class {},
  Notice: function Notice(message: string) {
    noticeMock(message);
  },
  TFile: class {},
}));

jest.mock("./brevilabsClient", () => ({
  BrevilabsClient: {
    getInstance: jest.fn(() => ({})),
  },
}));

jest.mock("./chainManager", () => {
  return jest.fn().mockImplementation(() => ({
    createChainWithNewModel: jest.fn(),
  }));
});

jest.mock("./projectLoadTracker", () => ({
  ProjectLoadTracker: {
    getInstance: jest.fn(() => ({
      executeWithProcessTracking: (...args: unknown[]) => executeWithProcessTracking(...args),
      clearAllLoadStates: jest.fn(),
      preComputeAllItems: jest.fn(),
      markAllCachedItemsAsSuccess: jest.fn(),
    })),
  },
}));

describe("ProjectManager YouTube context loading", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ProjectManager as unknown as { instance?: ProjectManager }).instance = undefined;
    executeWithProcessTracking.mockImplementation(
      async (_id: string, _kind: string, runner: () => Promise<unknown>) => runner()
    );
    extractTranscript.mockResolvedValue({
      video: {
        title: "Video Title",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        videoId: "dQw4w9WgXcQ",
        channelName: "Channel Name",
        description: "Description",
        publicationDate: "2026-04-01",
        durationSeconds: 65,
      },
      transcript: {
        plainText: "plain transcript",
        formattedMarkdown: "[00:00] plain transcript",
      },
    });
    buildYouTubeContextBlock.mockReturnValue(
      "<youtube_video_context>context</youtube_video_context>"
    );
  });

  it("formats extracted transcripts into youtube_video_context blocks for project loading", async () => {
    const manager = ProjectManager.getInstance(
      {} as never,
      {
        autosaveCurrentChat: jest.fn(),
        chatUIState: { handleProjectSwitch: jest.fn() },
      } as never
    );

    const context = await (
      manager as unknown as { processYoutubeUrlContext: (url: string) => Promise<string> }
    ).processYoutubeUrlContext("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(executeWithProcessTracking).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "youtube",
      expect.any(Function)
    );
    expect(extractTranscript).toHaveBeenCalledWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(buildYouTubeContextBlock).toHaveBeenCalledWith({
      title: "Video Title",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
      channel: "Channel Name",
      description: "Description",
      uploadDate: "2026-04-01",
      duration: "01:05",
      transcript: "[00:00] plain transcript",
    });
    expect(context).toBe("<youtube_video_context>context</youtube_video_context>");
  });

  it("returns an empty string and notifies the user when extraction fails", async () => {
    extractTranscript.mockRejectedValueOnce(new Error("boom"));

    const manager = ProjectManager.getInstance(
      {} as never,
      {
        autosaveCurrentChat: jest.fn(),
        chatUIState: { handleProjectSwitch: jest.fn() },
      } as never
    );

    const context = await (
      manager as unknown as { processYoutubeUrlContext: (url: string) => Promise<string> }
    ).processYoutubeUrlContext("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(context).toBe("");
    expect(noticeMock).toHaveBeenCalledWith(
      "Failed to process YouTube URL https://www.youtube.com/watch?v=dQw4w9WgXcQ: boom"
    );
  });
});
