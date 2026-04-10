/**
 * Pure function module for filtering sensitive content from text before memory extraction.
 * Detects API keys, tokens, passwords, and other secrets.
 */

/** Default patterns that match common sensitive content formats. */
export const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  // Generic API keys (key=..., apikey=..., api_key=...)
  /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9\-_]{16,}["']?/gi,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9_.-]{20,}/gi,
  // AWS-style keys (AKIA...)
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  // Generic secret/password assignments
  /(?:secret|password|passwd|pwd|token|auth)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi,
  // JWT tokens (three base64 segments)
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // SSH private keys
  /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH)?\s*PRIVATE\s+KEY-----/g,
  // Connection strings with credentials
  /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@[^\s]+/gi,
  // Hex-encoded tokens (32+ chars)
  /\b[0-9a-f]{32,}\b/gi,
];

/**
 * Filter sensitive content from text before memory extraction.
 * Replaces matched patterns with [REDACTED].
 *
 * @param text - The text to filter
 * @param patterns - Array of RegExp patterns to match (defaults to DEFAULT_SENSITIVE_PATTERNS)
 * @returns Object with filtered text and whether any sensitive content was found
 */
export function filterSensitiveContent(
  text: string,
  patterns: RegExp[] = DEFAULT_SENSITIVE_PATTERNS
): { filtered: string; hadSensitive: boolean } {
  let filtered = text;
  let hadSensitive = false;

  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const replaced = filtered.replace(pattern, "[REDACTED]");
    if (replaced !== filtered) {
      hadSensitive = true;
      filtered = replaced;
    }
  }

  return { filtered, hadSensitive };
}
