import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { LongTermMemoryManager } from "@/memory/LongTermMemoryManager";
import { Memory } from "@/memory/longTermMemoryTypes";
import { MemoryManagerModal } from "@/components/memory/MemoryManagerModal";
import { BookOpen, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import React, { memo, useCallback, useEffect, useState } from "react";

/**
 * Format a timestamp as a short readable date.
 */
function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Maximum memories to show in the collapsed preview. */
const MAX_PREVIEW = 3;
/** Maximum memories to show in the expanded list. */
const MAX_EXPANDED = 8;

interface LongTermMemoryStatusProps {
  manager: LongTermMemoryManager;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Collapsible panel showing long-term memory status and recent memories.
 * Follows the same visual pattern as RelevantNotes.
 */
export const LongTermMemoryStatus: React.FC<LongTermMemoryStatusProps> = memo(
  ({ manager, defaultOpen = false, className }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [memories, setMemories] = useState<Memory[]>([]);
    const [loading, setLoading] = useState(true);

    const loadMemories = useCallback(async () => {
      try {
        const all = await manager.getAllMemories();
        // Sort by most recent first
        all.sort((a, b) => b.createdAt - a.createdAt);
        setMemories(all);
      } catch (error) {
        logError("[LongTermMemoryStatus] Failed to load memories:", error);
      } finally {
        setLoading(false);
      }
    }, [manager]);

    useEffect(() => {
      loadMemories();
    }, [loadMemories]);

    const handleOpenManager = () => {
      new MemoryManagerModal(app, manager).open();
    };

    const previewMemories = memories.slice(0, MAX_PREVIEW);
    const expandedMemories = memories.slice(0, MAX_EXPANDED);
    const totalCount = memories.length;

    return (
      <div
        className={cn(
          "tw-w-full tw-border tw-border-solid tw-border-transparent tw-border-b-border tw-pb-2",
          className
        )}
      >
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <div className="tw-flex tw-items-center tw-justify-between tw-pb-2 tw-pl-1">
            <div className="tw-flex tw-flex-1 tw-items-center tw-gap-2">
              <BookOpen className="tw-size-4 tw-text-accent" />
              <span className="tw-font-semibold tw-text-normal">Long-Term Memory</span>
              {!loading && (
                <Badge variant="outline" className="tw-text-xs tw-text-muted">
                  {totalCount} {totalCount === 1 ? "memory" : "memories"}
                </Badge>
              )}
            </div>
            <div className="tw-flex tw-items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost2" size="icon" onClick={handleOpenManager}>
                    <ExternalLink className="tw-size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Manage Memories</TooltipContent>
              </Tooltip>
              {totalCount > 0 && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost2" size="icon">
                    {isOpen ? (
                      <ChevronUp className="tw-size-5" />
                    ) : (
                      <ChevronDown className="tw-size-5" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>

          {/* Collapsed preview — show category badges */}
          {!isOpen && totalCount > 0 && (
            <div className="tw-flex tw-max-h-6 tw-flex-wrap tw-gap-x-2 tw-gap-y-1 tw-overflow-y-hidden tw-px-1">
              {previewMemories.map((m) => (
                <Badge
                  key={m.id}
                  variant="outline"
                  className="tw-max-w-52 tw-truncate tw-text-xs tw-text-muted"
                >
                  {m.content}
                </Badge>
              ))}
              {totalCount > MAX_PREVIEW && (
                <span className="tw-text-xs tw-text-faint">+{totalCount - MAX_PREVIEW} more</span>
              )}
            </div>
          )}

          {totalCount === 0 && !loading && (
            <div className="tw-flex tw-items-center tw-gap-2 tw-px-1">
              <span className="tw-text-xs tw-text-muted">
                No memories yet — memories are learned from your conversations
              </span>
            </div>
          )}

          {/* Expanded list */}
          <CollapsibleContent>
            <div className="tw-mt-1 tw-flex tw-flex-col tw-gap-1.5 tw-px-1">
              {expandedMemories.map((m) => (
                <div
                  key={m.id}
                  className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2 tw-text-sm"
                >
                  <div className="tw-min-w-0 tw-flex-1">
                    <div className="tw-text-normal">{m.content}</div>
                    <div className="tw-mt-0.5 tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-faint">
                      <span className="tw-rounded tw-bg-secondary tw-px-1.5 tw-py-0.5">
                        {m.category}
                      </span>
                      <span>{formatShortDate(m.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {totalCount > MAX_EXPANDED && (
                <Button
                  variant="ghost2"
                  size="sm"
                  className="tw-w-full tw-text-xs tw-text-muted"
                  onClick={handleOpenManager}
                >
                  View all {totalCount} memories
                </Button>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }
);

LongTermMemoryStatus.displayName = "LongTermMemoryStatus";
