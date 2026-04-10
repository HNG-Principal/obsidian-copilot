import { filterSensitiveContent, DEFAULT_SENSITIVE_PATTERNS } from "./sensitivePatternFilter";

describe("sensitivePatternFilter", () => {
  describe("filterSensitiveContent", () => {
    it("should pass through clean text unchanged", () => {
      const result = filterSensitiveContent("The user prefers dark mode and lives in Berlin.");
      expect(result.filtered).toBe("The user prefers dark mode and lives in Berlin.");
      expect(result.hadSensitive).toBe(false);
    });

    it("should detect API key assignments", () => {
      const result = filterSensitiveContent('My api_key = "sk-1234567890abcdef1234"');
      expect(result.filtered).toContain("[REDACTED]");
      expect(result.hadSensitive).toBe(true);
    });

    it("should detect Bearer tokens", () => {
      const result = filterSensitiveContent(
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature"
      );
      expect(result.hadSensitive).toBe(true);
      expect(result.filtered).not.toContain("eyJhbG");
    });

    it("should detect AWS access keys", () => {
      const result = filterSensitiveContent("AWS key: AKIAIOSFODNN7EXAMPLE");
      expect(result.hadSensitive).toBe(true);
      expect(result.filtered).toContain("[REDACTED]");
    });

    it("should detect password assignments", () => {
      const result = filterSensitiveContent('password = "myS3cretP@ss!"');
      expect(result.hadSensitive).toBe(true);
      expect(result.filtered).toContain("[REDACTED]");
    });

    it("should detect secret/token assignments", () => {
      const result = filterSensitiveContent("secret: abcdefg12345678hijklmn");
      expect(result.hadSensitive).toBe(true);
    });

    it("should detect SSH private key headers", () => {
      const result = filterSensitiveContent("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ...");
      expect(result.hadSensitive).toBe(true);
    });

    it("should detect connection strings with credentials", () => {
      const result = filterSensitiveContent("mongodb://admin:password123@localhost:27017/mydb");
      expect(result.hadSensitive).toBe(true);
    });

    it("should detect JWT tokens", () => {
      const result = filterSensitiveContent(
        "Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
      );
      expect(result.hadSensitive).toBe(true);
    });

    it("should handle multiple sensitive items in one text", () => {
      const text = 'api_key = "sk-abc123def456ghi789" and password: mypassword123';
      const result = filterSensitiveContent(text);
      expect(result.hadSensitive).toBe(true);
      // Both should be redacted
      expect(result.filtered).not.toContain("sk-abc123def456ghi789");
      expect(result.filtered).not.toContain("mypassword123");
    });

    it("should accept custom patterns", () => {
      const customPatterns = [/SECRET-\d+/g];
      const result = filterSensitiveContent("code: SECRET-42", customPatterns);
      expect(result.hadSensitive).toBe(true);
      expect(result.filtered).toBe("code: [REDACTED]");
    });

    it("should work with empty text", () => {
      const result = filterSensitiveContent("");
      expect(result.filtered).toBe("");
      expect(result.hadSensitive).toBe(false);
    });

    it("should export default patterns array", () => {
      expect(DEFAULT_SENSITIVE_PATTERNS).toBeInstanceOf(Array);
      expect(DEFAULT_SENSITIVE_PATTERNS.length).toBeGreaterThan(0);
    });

    it("should handle repeated calls correctly (regex lastIndex reset)", () => {
      // Call twice to ensure global regex lastIndex is properly reset
      const text = 'token = "abc123456789012345678901"';
      const result1 = filterSensitiveContent(text);
      const result2 = filterSensitiveContent(text);
      expect(result1.hadSensitive).toBe(result2.hadSensitive);
      expect(result1.filtered).toBe(result2.filtered);
    });
  });
});
