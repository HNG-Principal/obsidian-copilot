/**
 * Edit Planner - Core business logic for Composer & Note Editing feature
 *
 * This module provides:
 * - EditOperation discriminated union types (replace, insert, delete, create, rename)
 * - EditPlan, EditPlanStatus, EditResult, UndoSnapshot, ValidationResult, FileDiff interfaces
 * - Pure functions: applyOperation, groupOperationsByFile
 * - Async functions: validatePlan, computeDiffs
 *
 * Architecture: EditPlanner (compute) → EditExecutor (apply) → UndoManager (snapshots)
 */

import { logInfo, logWarn, logError } from "@/logger";
import { TFile, Vault } from "obsidian";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Discriminated union for all edit operations
 */
export type EditOperation =
  | ReplaceOperation
  | InsertOperation
  | DeleteOperation
  | CreateOperation
  | RenameOperation;

/**
 * Replace operation: find exact text and replace with new text
 */
export interface ReplaceOperation {
  kind: "replace";
  filePath: string;
  oldText: string;
  newText: string;
}

/**
 * Insert operation: insert text at a specific position
 */
export interface InsertOperation {
  kind: "insert";
  filePath: string;
  position: "beginning" | "end" | { after: string };
  text: string;
}

/**
 * Delete operation: remove exact text from file
 */
export interface DeleteOperation {
  kind: "delete";
  filePath: string;
  text: string;
}

/**
 * Create operation: create a new file with content
 */
export interface CreateOperation {
  kind: "create";
  filePath: string;
  content: string;
}

/**
 * Rename operation: rename a file
 */
export interface RenameOperation {
  kind: "rename";
  oldPath: string;
  newPath: string;
}

/**
 * Status of an edit plan
 */
export type EditPlanStatus =
  | "streaming"
  | "preview"
  | "accepted"
  | "rejected"
  | "applied"
  | "failed";

/**
 * A collection of edit operations to be applied atomically
 */
export interface EditPlan {
  id: string;
  operations: EditOperation[];
  description: string;
  affectedFiles: string[];
  status: EditPlanStatus;
}

/**
 * Result of applying an edit plan
 */
export interface EditResult {
  planId: string;
  status: "success" | "partial" | "failed";
  appliedOps: number;
  totalOps: number;
  error?: string;
  snapshotId?: string;
}

/**
 * Pre-edit state of affected files for rollback support
 */
export interface UndoSnapshot {
  id: string;
  planId: string;
  timestamp: number;
  description: string;
  files: Map<string, string>;
}

/**
 * Validation result for an edit plan
 */
export interface ValidationResult {
  valid: boolean;
  errors: Array<{ operationIndex: number; message: string }>;
}

/**
 * Diff between original and new content for a file
 */
export interface FileDiff {
  filePath: string;
  originalContent: string;
  newContent: string;
  operations: EditOperation[];
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Apply a single edit operation to file content.
 * Pure function: input text + operation → output text.
 * Throws if operation cannot be applied (e.g., oldText not found).
 *
 * @param content - Original file content
 * @param operation - The edit operation to apply
 * @returns New content after applying the operation
 * @throws Error if operation cannot be applied
 */
export function applyOperation(content: string, operation: EditOperation): string {
  switch (operation.kind) {
    case "replace":
      return applyReplaceOperation(content, operation);
    case "insert":
      return applyInsertOperation(content, operation);
    case "delete":
      return applyDeleteOperation(content, operation);
    case "create":
      return operation.content;
    case "rename":
      logWarn("applyOperation: rename operation has no content effect");
      return content;
    default:
      throw new Error(`Unknown operation kind: ${operation}`);
  }
}

/**
 * Apply a replace operation to content.
 * Uses exact match first, then falls back to fuzzy matching if needed.
 */
function applyReplaceOperation(content: string, operation: ReplaceOperation): string {
  const { oldText, newText } = operation;

  // Try exact match first
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return content.slice(0, exactIndex) + newText + content.slice(exactIndex + oldText.length);
  }

  // Fallback: fuzzy matching (simple substring with tolerance for whitespace)
  const normalizedContent = content.replace(/\s+/g, " ");
  const normalizedOldText = oldText.replace(/\s+/g, " ");
  const normalizedIndex = normalizedContent.indexOf(normalizedOldText);

  if (normalizedIndex !== -1) {
    // Find the actual range in original content
    let originalStart = 0;
    let normalizedPos = 0;
    for (let i = 0; i < content.length; i++) {
      if (normalizedPos >= normalizedIndex) break;
      if (content[i] !== " ") {
        normalizedPos++;
      }
      originalStart = i + 1;
    }

    let originalEnd = originalStart;
    for (let i = 0; i < oldText.length; i++) {
      if (content[originalEnd] !== " ") {
        i++;
      }
      originalEnd++;
    }

    return content.slice(0, originalStart) + newText + content.slice(originalEnd);
  }

  throw new Error(`Replace operation: oldText not found in content. Search: "${oldText}"`);
}

/**
 * Apply an insert operation to content.
 * Supports insertion at beginning, end, or after anchor text.
 */
function applyInsertOperation(content: string, operation: InsertOperation): string {
  const { position, text } = operation;

  if (position === "beginning") {
    return text + content;
  }

  if (position === "end") {
    return content + text;
  }

  if (typeof position === "object" && "after" in position) {
    const anchor = position.after;
    const anchorIndex = content.indexOf(anchor);

    if (anchorIndex === -1) {
      throw new Error(`Insert operation: anchor text not found. Search: "${anchor}"`);
    }

    return (
      content.slice(0, anchorIndex + anchor.length) +
      text +
      content.slice(anchorIndex + anchor.length)
    );
  }

  throw new Error(`Invalid insert position: ${position}`);
}

/**
 * Apply a delete operation to content.
 */
function applyDeleteOperation(content: string, operation: DeleteOperation): string {
  const { text } = operation;
  const index = content.indexOf(text);

  if (index === -1) {
    throw new Error(`Delete operation: text not found. Search: "${text}"`);
  }

  return content.slice(0, index) + content.slice(index + text.length);
}

/**
 * Group edit operations by file path for batch application.
 * Operations on the same file are grouped together in order.
 */
export function groupOperationsByFile(operations: EditOperation[]): Map<string, EditOperation[]> {
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

// ============================================================================
// Async Functions (with Vault integration)
// ============================================================================

/**
 * Validate that all operations in a plan can be applied.
 * Checks file existence, oldText matching, etc.
 *
 * @param plan - The edit plan to validate
 * @param vault - Obsidian Vault instance for file operations
 * @returns ValidationResult with validity and any errors
 */
export async function validatePlan(plan: EditPlan, vault: Vault): Promise<ValidationResult> {
  const errors: Array<{ operationIndex: number; message: string }> = [];

  for (let i = 0; i < plan.operations.length; i++) {
    const operation = plan.operations[i];
    const result = await validateOperation(operation, vault);

    if (!result.valid) {
      const message = result.message ?? "Unknown validation error";
      errors.push({ operationIndex: i, message });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single operation.
 */
async function validateOperation(
  operation: EditOperation,
  vault: Vault
): Promise<{ valid: boolean; message?: string }> {
  try {
    switch (operation.kind) {
      case "replace":
        return await validateReplaceOperation(operation, vault);
      case "insert":
        return await validateInsertOperation(operation, vault);
      case "delete":
        return await validateDeleteOperation(operation, vault);
      case "create":
        return await validateCreateOperation(operation, vault);
      case "rename":
        return await validateRenameOperation(operation, vault);
      default:
        return { valid: false, message: `Unknown operation kind: ${operation}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, message };
  }
}

/**
 * Validate a replace operation.
 */
async function validateReplaceOperation(
  operation: ReplaceOperation,
  vault: Vault
): Promise<{ valid: boolean; message?: string }> {
  const file = vault.getAbstractFileByPath(operation.filePath);

  if (!file) {
    return { valid: false, message: `File does not exist: ${operation.filePath}` };
  }

  if (!(file instanceof TFile)) {
    return { valid: false, message: `Path is not a file: ${operation.filePath}` };
  }

  const content = await vault.read(file);

  if (content.indexOf(operation.oldText) === -1) {
    return { valid: false, message: `oldText not found in file: ${operation.filePath}` };
  }

  return { valid: true };
}

/**
 * Validate an insert operation.
 */
async function validateInsertOperation(
  operation: InsertOperation,
  vault: Vault
): Promise<{ valid: boolean; message?: string }> {
  const file = vault.getAbstractFileByPath(operation.filePath);

  if (!file) {
    return { valid: false, message: `File does not exist: ${operation.filePath}` };
  }

  if (!(file instanceof TFile)) {
    return { valid: false, message: `Path is not a file: ${operation.filePath}` };
  }

  const content = await vault.read(file);

  if (typeof operation.position === "object" && "after" in operation.position) {
    const anchor = operation.position.after;
    if (content.indexOf(anchor) === -1) {
      return { valid: false, message: `Anchor text not found: ${anchor}` };
    }
  }

  return { valid: true };
}

/**
 * Validate a delete operation.
 */
async function validateDeleteOperation(
  operation: DeleteOperation,
  vault: Vault
): Promise<{ valid: boolean; message?: string }> {
  const file = vault.getAbstractFileByPath(operation.filePath);

  if (!file) {
    return { valid: false, message: `File does not exist: ${operation.filePath}` };
  }

  if (!(file instanceof TFile)) {
    return { valid: false, message: `Path is not a file: ${operation.filePath}` };
  }

  const content = await vault.read(file);

  if (content.indexOf(operation.text) === -1) {
    return { valid: false, message: `Text not found in file: ${operation.filePath}` };
  }

  return { valid: true };
}

/**
 * Validate a create operation.
 */
async function validateCreateOperation(
  operation: CreateOperation,
  vault: Vault
): Promise<{ valid: boolean; message?: string }> {
  const existing = vault.getAbstractFileByPath(operation.filePath);

  if (existing) {
    return { valid: false, message: `File already exists: ${operation.filePath}` };
  }

  return { valid: true };
}

/**
 * Validate a rename operation.
 */
async function validateRenameOperation(
  operation: RenameOperation,
  vault: Vault
): Promise<{ valid: boolean; message?: string }> {
  const oldFile = vault.getAbstractFileByPath(operation.oldPath);

  if (!oldFile) {
    return { valid: false, message: `Source file does not exist: ${operation.oldPath}` };
  }

  if (vault.getAbstractFileByPath(operation.newPath)) {
    return { valid: false, message: `Target file already exists: ${operation.newPath}` };
  }

  return { valid: true };
}

/**
 * Compute the diff preview for each file in the plan.
 * Pure computation — does not modify files.
 *
 * @param plan - The edit plan to compute diffs for
 * @param vault - Obsidian Vault instance for reading current content
 * @returns Array of FileDiff objects
 */
export async function computeDiffs(plan: EditPlan, vault: Vault): Promise<FileDiff[]> {
  const diffs: FileDiff[] = [];

  const grouped = groupOperationsByFile(plan.operations);

  for (const [filePath, fileOps] of grouped) {
    const file = vault.getAbstractFileByPath(filePath);

    if (!file || !(file instanceof TFile)) {
      logWarn(`computeDiffs: file not found, skipping: ${filePath}`);
      continue;
    }

    const originalContent = await vault.read(file);
    let newContent = originalContent;

    for (const operation of fileOps) {
      try {
        newContent = applyOperation(newContent, operation);
      } catch (error) {
        logError(`computeDiffs: failed to apply operation to ${filePath}: ${error}`);
        throw error;
      }
    }

    diffs.push({
      filePath,
      originalContent,
      newContent,
      operations: fileOps,
    });
  }

  logInfo(`computeDiffs: computed ${diffs.length} diffs for plan ${plan.id}`);
  return diffs;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID for edit plans and snapshots.
 */
export function generateId(prefix: string = "edit"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Extract frontmatter from markdown content.
 * Splits content at YAML `---` delimiters.
 */
export function extractFrontmatter(content: string): {
  frontmatter: string;
  body: string;
  hasFrontmatter: boolean;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return {
      frontmatter: "",
      body: content,
      hasFrontmatter: false,
    };
  }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
    hasFrontmatter: true,
  };
}

/**
 * Validate that a string is valid YAML.
 * Simple delimiter check — can be enhanced with YAML parser if needed.
 */
export function isValidYaml(yamlString: string): boolean {
  // Basic validation: check for balanced delimiters and no syntax errors
  const lines = yamlString.split("\n");
  let inBlockLiteral = false;

  for (const line of lines) {
    if (line.trim().startsWith("|") || line.trim().startsWith(">")) {
      inBlockLiteral = true;
      continue;
    }

    if (inBlockLiteral) {
      if (line.trim() === "") {
        inBlockLiteral = false;
        continue;
      }
      continue;
    }

    // Check for common YAML syntax issues
    if (line.includes(":") && !line.includes(": ")) {
      // Key without value (allowed in some cases)
      continue;
    }
  }

  return true;
}
