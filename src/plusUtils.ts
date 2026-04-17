import {
  ChatModelProviders,
  ChatModels,
  DEFAULT_SETTINGS,
  EmbeddingModelProviders,
  EmbeddingModels,
} from "@/constants";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logInfo } from "@/logger";
import { getSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { Notice } from "obsidian";
import React from "react";

export const DEFAULT_COPILOT_PLUS_CHAT_MODEL = ChatModels.COPILOT_PLUS_FLASH;
export const DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_CHAT_MODEL + "|" + ChatModelProviders.COPILOT_PLUS;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL = EmbeddingModels.COPILOT_PLUS_SMALL;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL + "|" + EmbeddingModelProviders.COPILOT_PLUS;

// Default models for free users (imported from DEFAULT_SETTINGS)
export const DEFAULT_FREE_CHAT_MODEL_KEY = DEFAULT_SETTINGS.defaultModelKey;
export const DEFAULT_FREE_EMBEDDING_MODEL_KEY = DEFAULT_SETTINGS.embeddingModelKey;

// ============================================================================
// SELF-HOST MODE VALIDATION
// ============================================================================
// Self-host mode allows Believer/Supporter users to use their own infrastructure.
//
// Validation flow:
// 1. User enables toggle → validateSelfHostMode() → count = 1, timestamp set
// 2. Every 15+ days on plugin load → refreshSelfHostModeValidation() → count++
// 3. After 3 successful validations → permanent (no more checks needed)
//
// Offline support:
// - Within 15-day grace period: Full functionality, can toggle off/on
// - Permanent (count >= 3): Full functionality forever
// - Grace expired while offline: Must go online to revalidate
//
// Settings section visibility (useIsSelfHostEligible):
// - Shown if: permanent OR within grace period OR API confirms eligibility
// - Hidden if: no license key OR grace expired + offline + not permanent
// ============================================================================

/** Grace period for self-host mode: 15 days */
const SELF_HOST_GRACE_PERIOD_MS = 15 * 24 * 60 * 60 * 1000;

/** Number of successful validations required for permanent self-host mode */
const SELF_HOST_PERMANENT_VALIDATION_COUNT = 3;

/** Plans that qualify for self-host mode */
const SELF_HOST_ELIGIBLE_PLANS = ["believer", "supporter"];

/**
 * Check if self-host access is valid.
 * Valid if: permanently validated (3+ successful checks) OR within 15-day grace period.
 */
export function isSelfHostAccessValid(): boolean {
  const settings = getSettings();
  if (settings.selfHostModeValidatedAt == null) {
    return false;
  }
  // Permanently valid after 3 successful validations
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    return true;
  }
  // Otherwise, check grace period
  return Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS;
}

/**
 * Check if self-host mode is valid and enabled.
 * Requires the toggle to be on and access to be within the grace period or permanently validated.
 */
export function isSelfHostModeValid(): boolean {
  const settings = getSettings();
  if (!settings.enableSelfHostMode) {
    return false;
  }
  return isSelfHostAccessValid();
}

/** Check if the model key is a Copilot Plus model. */
export function isPlusModel(modelKey: string): boolean {
  return modelKey.split("|")[1] === EmbeddingModelProviders.COPILOT_PLUS;
}

/**
 * Personal build: all Plus features permanently unlocked.
 */
export function isPlusEnabled(): boolean {
  return true;
}

/**
 * Personal build: always return true so all gated UI renders.
 */
export function useIsPlusUser(): boolean | undefined {
  return true;
}

/**
 * Personal build: skip license validation entirely.
 */
export async function checkIsPlusUser(
  _context?: Record<string, any>
): Promise<boolean | undefined> {
  return true;
}

/** Check if the user is on a plan that qualifies for self-host mode. */
export async function isSelfHostEligiblePlan(): Promise<boolean> {
  if (!getSettings().plusLicenseKey) {
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey();
  const planName = result.plan?.toLowerCase();
  return planName != null && SELF_HOST_ELIGIBLE_PLANS.includes(planName);
}

/**
 * Hook to check if user should see the self-host mode settings section.
 * Returns undefined while loading, boolean once checked.
 *
 * Eligibility rules:
 * 1. No license key: Not eligible (immediately revokes access)
 * 2. Has license key: Verify via API (handles key changes, e.g. believer → plus)
 *    - API success: Use result (revoke self-host mode if not eligible)
 *    - API failure (offline): Fall back to cached validation
 *      (permanent count >= 3 OR within 15-day grace period)
 */
export function useIsSelfHostEligible(): boolean | undefined {
  const settings = useSettingsValue();
  const [isEligible, setIsEligible] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    // No license key = not eligible, regardless of cached validation state.
    // Also force self-host mode OFF so the toggle reflects the revoked state.
    if (!settings.plusLicenseKey) {
      if (settings.enableSelfHostMode) {
        updateSetting("enableSelfHostMode", false);
      }
      setIsEligible(false);
      return;
    }

    // Has license key - always verify via API to handle key changes (e.g. believer → plus).
    // Fall back to cached validation only when offline.
    isSelfHostEligiblePlan()
      .then((eligible) => {
        if (!eligible && settings.enableSelfHostMode) {
          updateSetting("enableSelfHostMode", false);
        }
        setIsEligible(eligible);
      })
      .catch(() => {
        // Offline fallback: trust cached validation state
        if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
          setIsEligible(true);
          return;
        }
        if (
          settings.selfHostModeValidatedAt != null &&
          Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS
        ) {
          setIsEligible(true);
          return;
        }
        setIsEligible(false);
      });
  }, [
    settings.plusLicenseKey,
    settings.enableSelfHostMode,
    settings.selfHostModeValidatedAt,
    settings.selfHostValidationCount,
  ]);

  return isEligible;
}

/**
 * Validate self-host mode when user enables the toggle.
 * Called from UI when toggle is switched ON.
 *
 * Flow:
 * 1. If permanently validated (count >= 3): Allow immediately (offline-safe)
 * 2. If within grace period: Allow immediately (offline-safe)
 * 3. Otherwise: Require API validation (online only)
 *    - Success: Set count = max(current, 1), update timestamp
 *    - Failure: Return false, UI should revert toggle
 *
 * @returns true if validation passed, false if user should not enable
 */
export async function validateSelfHostMode(): Promise<boolean> {
  const settings = getSettings();

  // Already permanently validated - allow re-enable (offline-safe)
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    updateSetting("selfHostModeValidatedAt", Date.now());
    logInfo("Self-host mode re-enabled (permanently validated)");
    return true;
  }

  // Within grace period - allow re-enable (offline-safe)
  if (
    settings.selfHostModeValidatedAt != null &&
    Date.now() - settings.selfHostModeValidatedAt < SELF_HOST_GRACE_PERIOD_MS
  ) {
    logInfo("Self-host mode re-enabled (within grace period)");
    return true;
  }

  // Not in grace period - require API validation (online only)
  const isEligible = await isSelfHostEligiblePlan();
  if (!isEligible) {
    logInfo("Self-host mode requires an eligible plan (Believer, Supporter)");
    new Notice("Self-host mode is only available for Believer and Supporter plan subscribers.");
    return false;
  }

  // First-time or expired - set timestamp and initialize count
  const newCount = Math.max(settings.selfHostValidationCount || 0, 1);
  updateSetting("selfHostModeValidatedAt", Date.now());
  updateSetting("selfHostValidationCount", newCount);
  logInfo(`Self-host mode validation successful (${newCount}/3)`);
  return true;
}

/**
 * Refresh self-host mode validation on plugin startup.
 * Called from main.ts on plugin load.
 *
 * Flow:
 * 1. If toggle OFF or permanently validated: No-op
 * 2. API check:
 *    - Eligible + 15+ days since last: Increment count, update timestamp
 *    - Eligible + <15 days: Log only (preserve countdown)
 *    - Not eligible: Disable toggle, reset count to 0
 *    - Offline/error: No-op (grace period continues)
 *
 * Count progression: 1 → 2 → 3 (permanent) over minimum 28 days.
 */
export async function refreshSelfHostModeValidation(): Promise<void> {
  const settings = getSettings();
  if (!settings.enableSelfHostMode && !settings.enableMiyo) {
    return;
  }

  // Already permanently validated, no need to refresh
  if (settings.selfHostValidationCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
    logInfo("Self-host mode permanently validated, skipping refresh");
    return;
  }

  try {
    const isEligible = await isSelfHostEligiblePlan();
    if (isEligible) {
      const now = Date.now();
      const timeSinceLastValidation = now - (settings.selfHostModeValidatedAt || 0);
      const shouldIncrementCount = timeSinceLastValidation >= SELF_HOST_GRACE_PERIOD_MS;

      if (shouldIncrementCount) {
        // 15+ days since last validation - increment count and update timestamp
        const newCount = (settings.selfHostValidationCount || 0) + 1;
        updateSetting("selfHostModeValidatedAt", now);
        updateSetting("selfHostValidationCount", newCount);

        if (newCount >= SELF_HOST_PERMANENT_VALIDATION_COUNT) {
          logInfo("Self-host mode permanently validated (3/3)");
          new Notice("Self-host mode is now permanently enabled!");
        } else {
          logInfo(`Self-host mode validation refreshed (${newCount}/3)`);
        }
      } else {
        // Less than 15 days - don't update timestamp (preserve interval countdown)
        logInfo("Self-host mode validated (waiting for 15-day interval to increment count)");
      }
    } else {
      // User is no longer on an eligible plan, disable self-host mode
      updateSetting("enableSelfHostMode", false);
      updateSetting("enableMiyo", false);
      updateSetting("selfHostModeValidatedAt", null);
      updateSetting("selfHostValidationCount", 0);
      logInfo("Self-host mode disabled - user is no longer on an eligible plan");
      new Notice("Self-host mode has been disabled. An eligible plan is required.");
    }
  } catch (error) {
    // Offline or API error - keep existing validation (grace period still applies)
    logInfo("Could not refresh self-host mode validation (offline?):", error);
  }
}

export function turnOnPlus(): void {
  updateSetting("isPlusUser", true);
}

/**
 * No-op in this build: Plus is permanently unlocked.
 * Kept only so legacy call sites (e.g. Brevilabs license expiry handler) don't throw.
 */
export function turnOffPlus(): void {
  logInfo("turnOffPlus called but Plus is permanently unlocked in this build; ignoring.");
}
