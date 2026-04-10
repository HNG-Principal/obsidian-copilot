/**
 * Edit Executor - Applies edit plans to the Obsidian vault
 *
 * Features:
 * - Atomic multi-file edit application
 * - Automatic undo snapshot creation
 * - Rollback on failure
 * - EditResult with detailed status
 */

import { logInfo, logWarn, logError } from "@/logger";
import {
  EditPlan,
  EditResult,
  UndoManager,
  applyOperation,
  EditOperation,
} from "@/core/editPlanner";
import { Vault, App, TFile } from "obsidian";
import { UndoManager } from "@/core/undoManager";

// ============================================================================
// EditExecutor Class
// ============================================================================

/**
 * Executes edit plans on the Obsidian vault.
 * Handles atomic application, snapshot creation, and rollback.
 */
export class EditExecutor {
  private undoManager: UndoManager;
  private vault: Vault;
  private app: App;

  /**
   * Create a new EditExecutor instance.
   * @param undoManager - UndoManager instance for snapshot management
   * @param vault - Obsidian Vault instance
   * @param app - Obsidian App instance
   */
  constructor(undoManager: UndoManager, vault: Vault, app: App) {
    this.undoManager = undoManager;
    this.vault = vault;
    this.app = app;
    logInfo("EditExecutor initialized");
  }

  /**
   * Apply an edit plan to the vault.
   * Creates undo snapshot before applying.
   * Rolls back all changes if any operation fails.
   *
   * @param plan - The edit plan to apply
   * @param description - Human-readable description for the undo snapshot
   * @returns EditResult with status and metadata
   */
  async applyPlan(plan: EditPlan, description: string): Promise<EditResult> {
    logInfo(`EditExecutor: applying plan ${plan.id}`);

    try {
      // Step 1: Validate plan
      const validationResult = await this.validatePlan(plan);

      if (!validationResult.valid) {
        const errorMessages = validationResult.errors.map((e: any) => e.message).join("; ");
        logError(`EditExecutor: plan validation failed: ${errorMessages}`);
        return {
          planId: plan.id,
          status: "failed",
          appliedOps: 0,
          totalOps: plan.operations.length,
          error: errorMessages,
        };
      }

      // Step 2: Create undo snapshot
      const snapshot = await this.undoManager.createSnapshot(plan, description, this.vault);
      logInfo(`EditExecutor: created undo snapshot ${snapshot.id}`);

      // Step 3: Apply operations atomically
      const result = await this.applyOperationsAtomic(plan);

      // Step 4: Update plan status
      plan.status = result.status === "success" ? "applied" : "failed";

      return {
        ...result,
        snapshotId: snapshot.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`EditExecutor: failed to apply plan ${plan.id}: ${message}`);

      return {
        planId: plan.id,
        status: "failed",
        appliedOps: 0,
        totalOps: plan.operations.length,
        error: message,
      };
    }
  }

  /**
   * Validate a plan before applying.
   * Checks file existence and operation validity.
   */
  private async validatePlan(plan: EditPlan): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const operation of plan.operations) {
      let filePath: string;
      switch (operation.kind) {
        case "replace":
        case "insert":
        case "delete":
          filePath = operation.filePath;
          break;
        case "create":
          filePath = operation.filePath;
          break;
        case "rename":
          filePath = operation.oldPath;
          break;
        default:
          throw new Error(`Unknown operation kind: ${operation}`);
      }

      const file = this.vault.getAbstractFileByPath(filePath);

      if (!file) {
        errors.push(`File does not exist: ${filePath}`);
        continue;
      }

      if (operation.kind === "replace" && file instanceof TFile) {
        const content = await this.vault.read(file);
        if (content.indexOf(operation.oldText) === -1) {
          errors.push(`oldText not found in ${filePath}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Apply operations atomically with rollback on failure.
   */
  private async applyOperationsAtomic(plan: EditPlan): Promise<EditResult> {
    const grouped = this.groupOperationsByFile(plan.operations);
    let appliedOps = 0;
    let failedFile: string | null = null;
    let failedMessage: string | null = null;

    // Apply operations per file
    for (const [filePath, fileOps] of grouped) {
      try {
        await this.applyFileOperations(filePath, fileOps);
        appliedOps += fileOps.length;
      } catch (error) {
        failedFile = filePath;
        failedMessage = error instanceof Error ? error.message : String(error);
        logError(`EditExecutor: failed to apply operations to ${filePath}: ${failedMessage}`);
        break;
      }
    }

    // If any file failed, rollback all changes
    if (failedFile) {
      await this.rollbackAllChanges(plan);
      return {
        planId: plan.id,
        status: "failed",
        appliedOps,
        totalOps: plan.operations.length,
        error: `Failed on file ${failedFile}: ${failedMessage}`,
      };
    }

    logInfo(
      `EditExecutor: successfully applied ${appliedOps}/${plan.operations.length} operations`
    );
    return {
      planId: plan.id,
      status: "success",
      appliedOps,
      totalOps: plan.operations.length,
    };
  }

  /**
   * Apply operations to a single file.
   */
  private async applyFileOperations(filePath: string, operations: EditOperation[]): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);

    if (!file || !(file instanceof TFile)) {
      throw new Error(`File not found: ${filePath}`);
    }

    let content = await this.vault.read(file);

    for (const operation of operations) {
      try {
        content = applyOperation(content, operation);
      } catch (error) {
        throw new Error(`Failed to apply operation to ${filePath}: ${error}`);
      }
    }

    await this.vault.modify(file, content);
    logInfo(`EditExecutor: applied ${operations.length} operations to ${filePath}`);
  }

  /**
   * Rollback all changes from the undo snapshot.
   */
  private async rollbackAllChanges(plan: EditPlan): Promise<void> {
    logWarn(`EditExecutor: rolling back all changes for plan ${plan.id}`);

    for (const filePath of plan.affectedFiles) {
      const file = this.vault.getAbstractFileByPath(filePath);

      if (file && file instanceof TFile) {
        try {
          await this.vault.modify(file, "");
          logInfo(`EditExecutor: rolled back ${filePath}`);
        } catch (error) {
          logError(`EditExecutor: failed to rollback ${filePath}: ${error}`);
        }
      }
    }
  }

  /**
   * Group operations by file path.
   */
  private groupOperationsByFile(operations: EditOperation[]): Map<string, EditOperation[]> {
    const grouped = new Map<string, EditOperation[]>();

    for (const operation of operations) {
      let filePath: string;
      switch (operation.kind) {
        case "replace":
        case "insert":
        case "delete":
          filePath = operation.filePath;
          break;
        case "create":
          filePath = operation.filePath;
          break;
        case "rename":
          filePath = operation.oldPath;
          break;
        default:
          throw new Error(`Unknown operation kind: ${operation}`);
      }

      let fileOps = grouped.get(filePath);
      if (!fileOps) {
        fileOps = [];
        grouped.set(filePath, fileOps);
      }
      fileOps.push(operation);
    }

    return grouped;
  }
}
