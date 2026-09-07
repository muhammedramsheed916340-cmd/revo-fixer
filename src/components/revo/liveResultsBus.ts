"use client";

/**
 * Shared event bus for live Crazy Time results — STRICT SINGLE-PROCESSING GUARD.
 *
 * Deduplication happens HERE, before any listener is notified.
 * This is the SINGLE GATE: if a result key has already been processed,
 * it is silently ignored — no popup, no broadcast, no history, no prediction.
 *
 * The guard uses:
 *   1. A Set of ALL processed result keys (not just the last one)
 *   2. Synchronous check (no race condition possible in single-threaded JS)
 *
 * Result key = `${sector}-${time}` where `time` is the settledAt timestamp.
 * Consecutive identical results (1@T1, 1@T2, 1@T3) have DIFFERENT keys → NOT deduped.
 * Same result from multiple polls (1@T1, 1@T1, 1@T1) → SAME key → deduped to 1.
 */

export interface LiveResultEvent {
  sector: string;
  time: number;
  multiplier?: number;
  sourceTime?: number;
  apiResponseTime?: number;
  appReceivedTime?: number;
}

const listeners = new Set<(e: LiveResultEvent) => void>();

// STRICT DEDUP: Set of ALL processed result keys (not just last).
// This prevents the same result from being processed twice even if
// it arrives via multiple concurrent polling cycles.
const processedKeys = new Set<string>();

// Keep only the last 100 keys to prevent unbounded memory growth.
const MAX_PROCESSED_KEYS = 100;

/**
 * Broadcast a new live result.
 *
 * STRICT SINGLE-PROCESSING: if this result key has EVER been processed,
 * it is silently ignored. No listener is called. No popup. No history.
 *
 * This is checked BEFORE any UI/event/prediction logic runs.
 */
export function broadcastLiveResult(e: LiveResultEvent): void {
  const key = `${e.sector}-${e.time}`;

  // STRICT DEDUP CHECK — before any processing
  if (processedKeys.has(key)) {
    return; // Already processed — ignore completely
  }

  // Mark as processed IMMEDIATELY (before notifying listeners)
  processedKeys.add(key);

  // Prevent unbounded growth
  if (processedKeys.size > MAX_PROCESSED_KEYS) {
    // Remove the oldest entry (first inserted)
    const firstKey = processedKeys.values().next().value;
    if (firstKey) processedKeys.delete(firstKey);
  }

  // Now notify all listeners — exactly once per unique result key
  listeners.forEach((l) => l(e));
}

export function subscribeLiveResults(cb: (e: LiveResultEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Check if a result key has already been processed (for external pre-checks).
 */
export function isResultProcessed(sector: string, time: number): boolean {
  return processedKeys.has(`${sector}-${time}`);
}

/**
 * Clear the processed keys set (for testing/reset purposes).
 */
export function clearProcessedKeys(): void {
  processedKeys.clear();
}
