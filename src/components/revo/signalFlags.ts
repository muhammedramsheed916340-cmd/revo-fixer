/**
 * FEATURE FLAGS FOR THE NEW SIGNAL LAYERS (ADDITIVE — new file)
 * ============================================================
 *
 * TIME_SIGNAL   · DEALER_SIGNAL · PHYSICS_SIGNAL · FUSION
 *
 * DEFAULTS ARE ALL **OFF**. The existing production scorer is untouched and
 * continues to run exactly as before; each new layer can be exercised for
 * diagnostics and data collection without ever influencing a prediction.
 *
 * VALIDATION GATE (enforced, not merely documented)
 * -------------------------------------------------
 * Flipping a flag ON is REFUSED unless a passed out-of-sample validation
 * outcome has been registered for that exact signal (`registerValidation()`),
 * where "passed" requires:
 *     · enough paired rounds (≥ MIN_PAIRED_ROUNDS)
 *     · a positive, out-of-sample delta vs the comparison arm
 *     · a conclusive paired test (or a conclusive CI lower bound > 0)
 *     · a clean leakage audit and a clean duplicate audit
 *
 * `forceEnable()` exists for LOCAL debug only: it records the override so any
 * resulting number can never be presented as validated.
 */

export interface SignalFeatureFlags {
  TIME_SIGNAL: boolean;
  DEALER_SIGNAL: boolean;
  PHYSICS_SIGNAL: boolean;
  FUSION: boolean;
}

export type SignalFlagName = keyof SignalFeatureFlags;

export const SIGNAL_FLAG_KEY = "revo_signalFlags";
export const SIGNAL_VALIDATION_KEY = "revo_signalValidationLedger";

export const SIGNAL_FLAGS_OFF: SignalFeatureFlags = {
  TIME_SIGNAL: false,
  DEALER_SIGNAL: false,
  PHYSICS_SIGNAL: false,
  FUSION: false,
};

export const SIGNAL_FLAG_LABELS: Record<SignalFlagName, string> = {
  TIME_SIGNAL: "Time-based wheel analysis",
  DEALER_SIGNAL: "Dealer / agent analysis",
  PHYSICS_SIGNAL: "Wheel physics + motion",
  FUSION: "Ensemble fusion layer",
};

/** Minimum paired out-of-sample rounds before a signal may EVER be promoted. */
export const MIN_PAIRED_ROUNDS = 200;

/** Minimum out-of-sample improvement (percentage points) to consider promotion. */
export const MIN_DELTA_PP = 0;

export interface SignalValidationOutcome {
  signal: SignalFlagName | "ENSEMBLE";
  passed: boolean;
  reason: string;
  pairedRounds: number;
  deltaPp: number;
  mcnemarP: number;
  ciLowDeltaPp: number;
  leakageAuditPassed: boolean;
  duplicateAuditPassed: boolean;
  timestampAuditPassed: boolean;
  testedAt: number;
  dataset: string;
  modelVersion: string;
}

export type SignalValidationLedger = Partial<Record<SignalFlagName | "ENSEMBLE", SignalValidationOutcome>>;

let currentFlags: SignalFeatureFlags = { ...SIGNAL_FLAGS_OFF };
let validationLedger: SignalValidationLedger = {};
let flagVersion = 0;
const listeners = new Set<() => void>();

function notifyFlags(): void {
  flagVersion++;
  listeners.forEach((l) => l());
}

export function subscribeSignalFlags(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getSignalFlagsVersion(): number {
  return flagVersion;
}

export function getSignalFlags(): SignalFeatureFlags {
  return { ...currentFlags };
}

export function getValidationLedger(): SignalValidationLedger {
  return { ...validationLedger };
}

function loadFromStorage(): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    const rawFlags = window.localStorage.getItem(SIGNAL_FLAG_KEY);
    if (rawFlags) {
      const parsed = JSON.parse(rawFlags) as Partial<SignalFeatureFlags>;
      currentFlags = {
        TIME_SIGNAL: parsed.TIME_SIGNAL === true,
        DEALER_SIGNAL: parsed.DEALER_SIGNAL === true,
        PHYSICS_SIGNAL: parsed.PHYSICS_SIGNAL === true,
        FUSION: parsed.FUSION === true,
      };
    }
    const rawLedger = window.localStorage.getItem(SIGNAL_VALIDATION_KEY);
    if (rawLedger) validationLedger = JSON.parse(rawLedger) as SignalValidationLedger;
  } catch {
    currentFlags = { ...SIGNAL_FLAGS_OFF };
    validationLedger = {};
  }
}

function persist(): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(SIGNAL_FLAG_KEY, JSON.stringify(currentFlags));
    window.localStorage.setItem(SIGNAL_VALIDATION_KEY, JSON.stringify(validationLedger));
  } catch {
    /* storage unavailable — in-memory state still valid for this session */
  }
}

loadFromStorage();

/** Evaluate whether a signal may be promoted using ONLY the validation ledger. */
export function canPromote(signal: SignalFlagName): { allowed: boolean; reasons: string[] } {
  const outcome = validationLedger[signal];
  const reasons: string[] = [];
  if (!outcome) {
    reasons.push("no out-of-sample validation outcome registered for this signal");
    return { allowed: false, reasons };
  }
  if (!outcome.passed) reasons.push(`validation did not pass (${outcome.reason})`);
  if (outcome.pairedRounds < MIN_PAIRED_ROUNDS) reasons.push(`only ${outcome.pairedRounds} paired rounds (need ≥${MIN_PAIRED_ROUNDS})`);
  if (outcome.deltaPp <= MIN_DELTA_PP) reasons.push(`out-of-sample delta ${outcome.deltaPp.toFixed(2)} pp is not positive`);
  if (!(outcome.ciLowDeltaPp > 0)) reasons.push(`95% CI lower bound on the delta is ${outcome.ciLowDeltaPp.toFixed(2)} pp (must be > 0)`);
  if (!(outcome.mcnemarP < 0.05)) reasons.push(`paired McNemar p=${outcome.mcnemarP.toFixed(4)} is not significant`);
  if (!outcome.leakageAuditPassed) reasons.push("leakage audit failed");
  if (!outcome.duplicateAuditPassed) reasons.push("duplicate audit failed");
  if (!outcome.timestampAuditPassed) reasons.push("timestamp audit failed");
  return { allowed: reasons.length === 0, reasons };
}

/** Register the outcome of an out-of-sample validation run (called by the harness/UI). */
export function registerValidation(outcome: SignalValidationOutcome): void {
  validationLedger = { ...validationLedger, [outcome.signal]: outcome };
  persist();
  notifyFlags();
}

export function clearValidationLedger(): void {
  validationLedger = {};
  persist();
  notifyFlags();
}

/**
 * Set a signal flag. Enabling is refused unless the validation gate passes.
 * Disabling is always allowed (safe direction).
 */
export function setSignalFlag(
  flag: SignalFlagName,
  value: boolean,
): { ok: boolean; reason: string; forced: boolean } {
  if (!value) {
    currentFlags = { ...currentFlags, [flag]: false };
    persist();
    notifyFlags();
    return { ok: true, reason: `DISABLED ${flag}.`, forced: false };
  }
  const gate = canPromote(flag);
  if (!gate.allowed) {
    return {
      ok: false,
      reason: `REFUSED — ${flag} cannot be enabled: ${gate.reasons.join("; ")}. Use forceEnableSignalFlag() for local debugging only.`,
      forced: false,
    };
  }
  currentFlags = { ...currentFlags, [flag]: true };
  persist();
  notifyFlags();
  return { ok: true, reason: `ENABLED ${flag} (validation gate passed).`, forced: false };
}

/** LOCAL DEBUG ONLY. Records an explicit override entry so no result from this
 *  session can be presented as validated. */
export function forceEnableSignalFlag(flag: SignalFlagName, actor = "local-debug"): { ok: boolean; reason: string; forced: boolean } {
  currentFlags = { ...currentFlags, [flag]: true };
  validationLedger = {
    ...validationLedger,
    [flag]: {
      signal: flag,
      passed: false,
      reason: `FORCED ENABLE by ${actor} at ${new Date().toISOString()} — NOT validated. Any output is diagnostic only.`,
      pairedRounds: validationLedger[flag]?.pairedRounds ?? 0,
      deltaPp: validationLedger[flag]?.deltaPp ?? 0,
      mcnemarP: validationLedger[flag]?.mcnemarP ?? 1,
      ciLowDeltaPp: validationLedger[flag]?.ciLowDeltaPp ?? -1,
      leakageAuditPassed: validationLedger[flag]?.leakageAuditPassed ?? false,
      duplicateAuditPassed: validationLedger[flag]?.duplicateAuditPassed ?? false,
      timestampAuditPassed: validationLedger[flag]?.timestampAuditPassed ?? false,
      testedAt: Date.now(),
      dataset: "none (forced)",
      modelVersion: "n/a",
    },
  };
  persist();
  notifyFlags();
  return { ok: true, reason: `FORCED ${flag} ON (debug only — flagged as not validated).`, forced: true };
}

export function resetSignalFlags(): void {
  currentFlags = { ...SIGNAL_FLAGS_OFF };
  persist();
  notifyFlags();
}

/** True when at least one experimental signal is enabled. */
export function anySignalEnabled(): boolean {
  return currentFlags.TIME_SIGNAL || currentFlags.DEALER_SIGNAL || currentFlags.PHYSICS_SIGNAL || currentFlags.FUSION;
}

/** Test-only: replace the in-memory state without touching storage. */
export function __setFlagsForTest(flags: SignalFeatureFlags, ledger: SignalValidationLedger = {}): void {
  currentFlags = { ...flags };
  validationLedger = { ...ledger };
  notifyFlags();
}
