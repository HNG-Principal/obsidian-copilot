import { ProjectConfig } from "@/aiParams";

interface SearchPathFilter {
  include: string[];
  exclude: string[];
}

/**
 * Normalize a pinned-file list to unique, trimmed vault-relative paths.
 */
export function normalizePinnedFiles(paths?: string[]): string[] {
  if (!Array.isArray(paths)) {
    return [];
  }

  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
}

/**
 * Split project include and exclude strings into normalized path filters.
 */
export function computeSearchPathFilter(
  inclusions: string = "",
  exclusions: string = ""
): SearchPathFilter {
  const toPatterns = (value: string) =>
    value
      .split("\n")
      .map((pattern) => pattern.trim())
      .filter(Boolean);

  return {
    include: [...new Set(toPatterns(inclusions))],
    exclude: [...new Set(toPatterns(exclusions))],
  };
}

/**
 * Validate a fully-materialized project configuration.
 */
export function validateProjectConfig(project: ProjectConfig): string[] {
  const errors: string[] = [];

  if (!project.name.trim()) {
    errors.push("Project name is required.");
  }

  if (!project.projectModelKey.trim()) {
    errors.push("A project model is required.");
  }

  const temperature = project.modelConfigs?.temperature;
  if (
    typeof temperature !== "number" ||
    Number.isNaN(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    errors.push("Project temperature must be between 0 and 2.");
  }

  const maxTokens = project.modelConfigs?.maxTokens;
  if (typeof maxTokens !== "number" || Number.isNaN(maxTokens) || maxTokens < 1) {
    errors.push("Project token limit must be greater than 0.");
  }

  computeSearchPathFilter(
    project.contextSource?.inclusions || "",
    project.contextSource?.exclusions || ""
  );

  for (const pinnedPath of normalizePinnedFiles(project.pinnedFiles)) {
    if (pinnedPath.startsWith("/")) {
      errors.push(`Pinned file path must be vault-relative: ${pinnedPath}`);
    }
  }

  return errors;
}
