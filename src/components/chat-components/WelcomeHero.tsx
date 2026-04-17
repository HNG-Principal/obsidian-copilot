import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { useSettingsValue } from "@/settings/model";
import {
  AtSign,
  BookOpen,
  FileText,
  MessageSquare,
  Search,
  Slash,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import React from "react";

interface QuickActionItem {
  icon: React.ReactNode;
  label: string;
  description: string;
  prompt: string;
}

/**
 * Returns quick action suggestions tailored to the current chain type.
 */
function getQuickActions(chainType: ChainType): QuickActionItem[] {
  if (chainType === ChainType.VAULT_QA_CHAIN) {
    return [
      {
        icon: <Search className="tw-size-4" />,
        label: "Ask your vault",
        description: "Search across all your notes",
        prompt: "What are the main themes across my notes?",
      },
      {
        icon: <FileText className="tw-size-4" />,
        label: "Summarize a topic",
        description: "Pull together related notes",
        prompt: "Summarize everything I've written about ",
      },
      {
        icon: <Sparkles className="tw-size-4" />,
        label: "Find connections",
        description: "Uncover hidden links in your notes",
        prompt: "What unexpected connections exist between my notes on ",
      },
    ];
  }
  if (chainType === ChainType.COPILOT_PLUS_CHAIN) {
    return [
      {
        icon: <Zap className="tw-size-4" />,
        label: "Research a topic",
        description: "Use web + vault with agent tools",
        prompt: "Research the latest on ",
      },
      {
        icon: <FileText className="tw-size-4" />,
        label: "Draft with active note",
        description: "Edit or extend what you're writing",
        prompt: "Help me expand {activeNote} with more detail",
      },
      {
        icon: <Wand2 className="tw-size-4" />,
        label: "Compose & edit",
        description: "Multi-step edits across notes",
        prompt: "Review {activeNote} and suggest improvements",
      },
    ];
  }
  // LLM_CHAIN (default) and others
  return [
    {
      icon: <MessageSquare className="tw-size-4" />,
      label: "Chat about anything",
      description: "Free-form conversation with AI",
      prompt: "",
    },
    {
      icon: <FileText className="tw-size-4" />,
      label: "Work with active note",
      description: "Summarize, rewrite, or expand it",
      prompt: "Give me a quick recap of {activeNote} in two sentences.",
    },
    {
      icon: <Sparkles className="tw-size-4" />,
      label: "Try a custom prompt",
      description: "Type / to access your library",
      prompt: "",
    },
  ];
}

interface TipItem {
  icon: React.ReactNode;
  label: string;
  hint: string;
}

const TIPS: TipItem[] = [
  {
    icon: <AtSign className="tw-size-3.5" />,
    label: "@",
    hint: "to mention notes, tags, or folders",
  },
  {
    icon: <Slash className="tw-size-3.5" />,
    label: "/",
    hint: "to run a custom prompt command",
  },
  {
    icon: <BookOpen className="tw-size-3.5" />,
    label: "Long-term memory",
    hint: "automatically learns your preferences",
  },
];

interface WelcomeHeroProps {
  onSendPrompt: (prompt: string) => void;
  hasLongTermMemory: boolean;
}

/**
 * Polished welcome hero shown on empty chat state with quick actions and tips.
 */
export const WelcomeHero: React.FC<WelcomeHeroProps> = ({ onSendPrompt, hasLongTermMemory }) => {
  const [chainType] = useChainType();
  const settings = useSettingsValue();
  const actions = getQuickActions(chainType);

  const tips = TIPS.filter((t) => {
    if (t.label === "Long-term memory") {
      return hasLongTermMemory && settings.enableLongTermMemory;
    }
    return true;
  });

  const modeLabel =
    chainType === ChainType.VAULT_QA_CHAIN
      ? "Vault Q&A"
      : chainType === ChainType.COPILOT_PLUS_CHAIN
        ? "Copilot Plus"
        : chainType === ChainType.PROJECT_CHAIN
          ? "Projects"
          : "Chat";

  return (
    <div className="tw-flex tw-flex-col tw-gap-4 tw-rounded-xl tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-p-4 tw-shadow-sm">
      <div className="tw-flex tw-items-center tw-gap-3">
        <div className="tw-flex tw-size-10 tw-items-center tw-justify-center tw-rounded-full tw-text-accent tw-bg-accent/10">
          <Sparkles className="tw-size-5" />
        </div>
        <div className="tw-flex tw-flex-col">
          <span className="tw-text-xs tw-font-medium tw-uppercase tw-tracking-wider tw-text-muted">
            {modeLabel}
          </span>
          <h2 className="tw-m-0 tw-text-lg tw-font-semibold tw-text-normal">
            How can I help today?
          </h2>
        </div>
      </div>

      <div className="tw-grid tw-gap-2">
        {actions.map((action, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => onSendPrompt(action.prompt)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSendPrompt(action.prompt);
              }
            }}
            className="hover:tw-border-accent tw-group tw-flex tw-cursor-pointer tw-items-start tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3 tw-text-left tw-transition-colors hover:tw-bg-interactive-hover"
          >
            <div className="tw-mt-0.5 tw-flex tw-size-7 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted group-hover:tw-text-accent group-hover:tw-bg-accent/10">
              {action.icon}
            </div>
            <div className="tw-min-w-0 tw-flex-1">
              <div className="tw-text-sm tw-font-medium tw-text-normal">{action.label}</div>
              <div className="tw-text-xs tw-text-muted">{action.description}</div>
            </div>
          </div>
        ))}
      </div>

      {tips.length > 0 && (
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-1 tw-border-t tw-border-solid tw-border-border tw-pt-3 tw-text-xs tw-text-muted">
          {tips.map((tip, i) => (
            <div key={i} className="tw-flex tw-items-center tw-gap-1.5">
              {typeof tip.label === "string" && tip.label.length <= 2 ? (
                <kbd className="tw-rounded tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-1.5 tw-py-0.5 tw-font-mono tw-text-[0.7rem] tw-text-normal">
                  {tip.label}
                </kbd>
              ) : (
                <span className="tw-flex tw-items-center tw-gap-1 tw-text-normal">
                  {tip.icon}
                  {tip.label}
                </span>
              )}
              <span>{tip.hint}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
