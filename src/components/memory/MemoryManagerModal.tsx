import { Button } from "@/components/ui/button";
import { LongTermMemoryManager } from "@/memory/LongTermMemoryManager";
import { Memory, MemoryCategory } from "@/memory/longTermMemoryTypes";
import { logError } from "@/logger";
import { App, Modal } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { Pencil, Search, Trash2, X } from "lucide-react";

const CATEGORY_OPTIONS: MemoryCategory[] = ["preference", "fact", "instruction", "context"];

/**
 * Format a timestamp as a readable date string.
 */
function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface MemoryItemProps {
  memory: Memory;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleSensitive: (id: string, sensitive: boolean) => void;
  isEditing: boolean;
  editContent: string;
  editCategory: MemoryCategory;
  onEditContentChange: (value: string) => void;
  onEditCategoryChange: (value: MemoryCategory) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}

/**
 * Individual memory row with inline editing.
 */
function MemoryItem({
  memory,
  onEdit,
  onDelete,
  onToggleSensitive,
  isEditing,
  editContent,
  editCategory,
  onEditContentChange,
  onEditCategoryChange,
  onSaveEdit,
  onCancelEdit,
}: MemoryItemProps) {
  if (isEditing) {
    return (
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-p-3">
        <textarea
          className="tw-mb-2 tw-w-full tw-resize-y tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-p-2 tw-text-sm tw-text-normal"
          rows={3}
          value={editContent}
          onChange={(e) => onEditContentChange(e.target.value)}
        />
        <div className="tw-flex tw-items-center tw-gap-2">
          <select
            className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-px-2 tw-py-1 tw-text-sm"
            value={editCategory}
            onChange={(e) => onEditCategoryChange(e.target.value as MemoryCategory)}
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="tw-flex-1" />
          <Button variant="secondary" size="sm" onClick={onCancelEdit}>
            Cancel
          </Button>
          <Button variant="default" size="sm" onClick={onSaveEdit}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-group tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3">
      <div className="tw-min-w-0 tw-flex-1">
        <div className="tw-text-sm tw-text-normal">{memory.content}</div>
        <div className="tw-mt-1 tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-faint">
          <span className="tw-rounded tw-bg-secondary tw-px-1.5 tw-py-0.5">{memory.category}</span>
          <span>{formatDate(memory.createdAt)}</span>
          {memory.sensitive && (
            <span className="tw-rounded tw-px-1.5 tw-py-0.5 tw-text-error tw-bg-modifier-error/20">
              sensitive
            </span>
          )}
        </div>
      </div>
      <div className="tw-flex tw-items-center tw-gap-1 tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100">
        <Button
          variant="ghost2"
          size="icon"
          title={memory.sensitive ? "Mark as not sensitive" : "Mark as sensitive"}
          onClick={() => onToggleSensitive(memory.id, !memory.sensitive)}
        >
          <span className="tw-text-xs">{memory.sensitive ? "🔓" : "🔒"}</span>
        </Button>
        <Button variant="ghost2" size="icon" title="Edit" onClick={() => onEdit(memory.id)}>
          <Pencil className="tw-size-3.5" />
        </Button>
        <Button variant="ghost2" size="icon" title="Delete" onClick={() => onDelete(memory.id)}>
          <Trash2 className="tw-size-3.5" />
        </Button>
      </div>
    </div>
  );
}

interface MemoryManagerContentProps {
  manager: LongTermMemoryManager;
}

/**
 * Main content component for the memory management modal.
 */
function MemoryManagerContent({ manager }: MemoryManagerContentProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState<MemoryCategory>("fact");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMemories = useCallback(async () => {
    try {
      const loaded = await manager.getAllMemories();
      setMemories(loaded);
    } catch (error) {
      logError("[MemoryManagerModal] Failed to load memories:", error);
    } finally {
      setLoading(false);
    }
  }, [manager]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const filtered = memories.filter(
    (m) =>
      !searchQuery ||
      m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleEdit = (id: string) => {
    const memory = memories.find((m) => m.id === id);
    if (memory) {
      setEditingId(id);
      setEditContent(memory.content);
      setEditCategory(memory.category);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await manager.updateMemory(editingId, {
        content: editContent,
        category: editCategory,
      });
      await loadMemories();
      setEditingId(null);
    } catch (error) {
      logError("[MemoryManagerModal] Failed to update memory:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }
    try {
      await manager.deleteMemory(id);
      setDeleteConfirmId(null);
      await loadMemories();
    } catch (error) {
      logError("[MemoryManagerModal] Failed to delete memory:", error);
    }
  };

  const handleToggleSensitive = async (id: string, sensitive: boolean) => {
    try {
      await manager.updateMemory(id, { sensitive });
      await loadMemories();
    } catch (error) {
      logError("[MemoryManagerModal] Failed to toggle sensitive:", error);
    }
  };

  if (loading) {
    return <div className="tw-p-4 tw-text-center tw-text-faint">Loading memories...</div>;
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      {/* Header stats */}
      <div className="tw-flex tw-items-center tw-justify-between tw-text-sm tw-text-faint">
        <span>{memories.length} memories stored</span>
      </div>

      {/* Search bar */}
      <div className="tw-relative">
        <Search className="tw-absolute tw-left-2.5 tw-top-2.5 tw-size-4 tw-text-faint" />
        <input
          type="text"
          className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary-alt tw-py-2 tw-pl-9 tw-pr-8 tw-text-sm"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <Button
            variant="ghost2"
            size="icon"
            className="tw-absolute tw-right-1 tw-top-1"
            onClick={() => setSearchQuery("")}
          >
            <X className="tw-size-3.5" />
          </Button>
        )}
      </div>

      {/* Memory list */}
      <div className="tw-flex tw-max-h-[400px] tw-flex-col tw-gap-2 tw-overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="tw-p-4 tw-text-center tw-text-sm tw-text-faint">
            {memories.length === 0 ? "No memories stored yet." : "No memories match your search."}
          </div>
        ) : (
          filtered.map((memory) => (
            <MemoryItem
              key={memory.id}
              memory={memory}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleSensitive={handleToggleSensitive}
              isEditing={editingId === memory.id}
              editContent={editContent}
              editCategory={editCategory}
              onEditContentChange={setEditContent}
              onEditCategoryChange={setEditCategory}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={() => setEditingId(null)}
            />
          ))
        )}
      </div>

      {/* Delete confirmation banner */}
      {deleteConfirmId && (
        <div className="tw-flex tw-items-center tw-justify-between tw-rounded-md tw-p-2 tw-text-sm tw-bg-modifier-error/10">
          <span>Delete this memory permanently?</span>
          <div className="tw-flex tw-gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => handleDelete(deleteConfirmId)}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Obsidian modal wrapper for the memory management UI.
 */
export class MemoryManagerModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private manager: LongTermMemoryManager
  ) {
    super(app);
    // @ts-ignore — Obsidian TS types don't include setTitle
    this.setTitle("Long-Term Memories");
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createRoot(contentEl);
    this.root.render(<MemoryManagerContent manager={this.manager} />);
  }

  onClose() {
    this.root.unmount();
  }
}
