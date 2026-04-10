/**
 * Undo Manager - Manages undo snapshots for Composer & Note Editing feature
 *
 * Features:
 * - Stack-based in-memory snapshot storage
 * - Configurable maxUndoSnapshots limit (default 20)
 * - Automatic rollback on failure
 * - Concurrent edit detection
 */

import { logInfo, logWarn, logError } from "@/logger";
import { EditPlan, UndoSnapshot, generateId } from "@/core/editPlanner";
import { Vault, Notice, App, TFile } from "obsidian";
import { getSettings } from "@/settings/model";

// ============================================================================
// UndoManager Class
// ============================================================================

/**
 * Manages undo snapshots for Composer edits.
 * Stores snapshots in memory (per session).
 */
export class UndoManager {
  private static instance: UndoManager | null = null;
  private snapshots: UndoSnapshot[] = [];
  private maxUndoSnapshots: number;

  /**
   * Get the singleton instance of UndoManager.
   * Creates a new instance if one doesn't exist.
   * @param maxUndoSnapshots - Maximum undo history depth (default: 20, range: 5-50)
   */
  static getInstance(maxUndoSnapshots?: number): UndoManager {
    if (!UndoManager.instance) {
      const snapshotsLimit = maxUndoSnapshots ?? getSettings().maxUndoSnapshots;
      UndoManager.instance = new UndoManager(snapshotsLimit);
    }
    return UndoManager.instance;
  }

  /**
   * Reset the singleton instance (for testing or plugin reload).
   */
  static reset(): void {
    if (UndoManager.instance) {
      UndoManager.instance.clear();
    }
    UndoManager.instance = null;
  }

  /**
   * Create a new UndoManager instance (for testing).
   * @param maxUndoSnapshots - Maximum undo history depth (default: 20, range: 5-50)
   */
  constructor(maxUndoSnapshots: number = 20) {
    this.maxUndoSnapshots = Math.max(5, Math.min(50, maxUndoSnapshots));
    logInfo(`UndoManager initialized with maxUndoSnapshots=${this.maxUndoSnapshots}`);
  }

  /**
   * Create a snapshot of all files affected by the plan.
   * Reads current file contents from the vault before applying edits.
   *
   * @param plan - The edit plan to snapshot
   * @param description - Human-readable description of the edit
   * @param vault - Obsidian Vault instance for reading files
   * @returns The created UndoSnapshot
   */
  async createSnapshot(plan: EditPlan, description: string, vault: Vault): Promise<UndoSnapshot> {
    const snapshotId = generateId("undo");
    const timestamp = Date.now();
    const files = new Map<string, string>();

    // Read current content of all affected files
    for (const filePath of plan.affectedFiles) {
      const file = vault.getAbstractFileByPath(filePath);

      if (file && file instanceof TFile) {
        try {
          const content = await vault.read(file);
          files.set(filePath, content);
        } catch (error) {
          logError(`createSnapshot: failed to read file ${filePath}: ${error}`);
          throw new Error(`Failed to read file ${filePath} for snapshot: ${error}`);
        }
      } else {
        logWarn(`createSnapshot: file not found, skipping: ${filePath}`);
      }
    }

    const snapshot: UndoSnapshot = {
      id: snapshotId,
      planId: plan.id,
      timestamp,
      description,
      files,
    };

    // Add to stack, respecting max limit
    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.maxUndoSnapshots) {
      this.snapshots.shift();
      logInfo(`UndoManager: dropped oldest snapshot (stack exceeded maxUndoSnapshots)`);
    }

    logInfo(`UndoManager: created snapshot ${snapshotId} for plan ${plan.id}`);
    return snapshot;
  }

  /**
   * Undo the most recent edit by restoring from snapshot.
   *
   * @param vault - Obsidian Vault instance for writing files
   * @param app - Obsidian App instance for showing notices
   * @returns The undone snapshot, or undefined if nothing to undo
   */
  async undo(vault: Vault, app: App): Promise<UndoSnapshot | undefined> {
    const snapshot = this.snapshots.pop();

    if (!snapshot) {
      logInfo("UndoManager: nothing to undo");
      new Notice("Nothing to undo");
      return undefined;
    }

    try {
      // Check for concurrent edits (F17)
      for (const [filePath, originalContent] of snapshot.files) {
        const file = vault.getAbstractFileByPath(filePath);

        if (file && file instanceof TFile) {
          const currentContent = await vault.read(file);

          if (currentContent !== originalContent) {
            logWarn(`UndoManager: concurrent edit detected for ${filePath}`);
            new Notice(
              `Concurrent edit detected for ${filePath}. Undo may overwrite manual changes.`
            );
            break;
          }
        }
      }

      // Restore all files from snapshot
      for (const [filePath, content] of snapshot.files) {
        const file = vault.getAbstractFileByPath(filePath);

        if (file && file instanceof TFile) {
          await vault.modify(file, content);
          logInfo(`UndoManager: restored ${filePath} from snapshot`);
        } else if (!file) {
          // File was deleted, recreate it
          await vault.create(filePath, content);
          logInfo(`UndoManager: recreated ${filePath} from snapshot`);
        }
      }

      logInfo(`UndoManager: successfully undone snapshot ${snapshot.id}`);
      new Notice(`Undo successful: ${snapshot.description}`);
      return snapshot;
    } catch (error) {
      logError(`UndoManager: failed to undo snapshot ${snapshot.id}: ${error}`);
      new Notice(`Undo failed: ${error}`);
      // Put snapshot back if undo failed
      if (snapshot) {
        this.snapshots.push(snapshot);
      }
      return undefined;
    }
  }

  /**
   * Check if there are any snapshots available to undo.
   */
  canUndo(): boolean {
    return this.snapshots.length > 0;
  }

  /**
   * Get the description of the most recent undoable edit.
   */
  peekDescription(): string | undefined {
    if (this.snapshots.length === 0) {
      return undefined;
    }
    return this.snapshots[this.snapshots.length - 1].description;
  }

  /**
   * Clear all undo snapshots (e.g., on session end).
   */
  clear(): void {
    const count = this.snapshots.length;
    this.snapshots = [];
    logInfo(`UndoManager: cleared ${count} snapshots`);
  }

  /**
   * Get the current stack size.
   */
  getStackSize(): number {
    return this.snapshots.length;
  }

  /**
   * Get the max undo snapshots limit.
   */
  getMaxUndoSnapshots(): number {
    return this.maxUndoSnapshots;
  }
}
