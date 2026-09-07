"use client";

/**
 * Shared live-spin store — keeps the latest batch of REAL Crazy Time spins
 * fetched from the CasinoScores API by RevoLiveResults.
 *
 * RevoGame reads from this store to drive its prediction engine with REAL
 * casino data (not just the tiny user-verified round history).
 *
 * Uses a useSyncExternalStore-friendly API: subscribe() + getSnapshot().
 */

import type { SpinData } from "./aiStats";

const listeners = new Set<() => void>();
let currentSpins: SpinData[] = [];
let version = 0;

export function setLiveSpins(spins: SpinData[]): void {
  // Only update if the spin set actually changed (compare by latest settledAt).
  const newLatest = spins[0]?.settledAt ?? "";
  const oldLatest = currentSpins[0]?.settledAt ?? "";
  if (newLatest === oldLatest && spins.length === currentSpins.length) {
    return; // no change
  }
  currentSpins = spins;
  version++;
  listeners.forEach((l) => l());
}

export function getLiveSpins(): SpinData[] {
  return currentSpins;
}

export function getLiveSpinsVersion(): number {
  return version;
}

export function subscribeLiveSpins(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
