"use client";

/**
 * Shared event bus for live Crazy Time results.
 * When a new result arrives from the CasinoScores API, the LiveResults
 * component broadcasts it here so the Game (prediction) component can
 * auto-select it as the actual result and trigger prediction recalibration.
 */

export interface LiveResultEvent {
  sector: string; // e.g. "1", "2", "5", "10", "Pachinko", "CoinFlip", "CashHunt", "CrazyTime"
  time: number;
  multiplier?: number;
  sourceTime?: number; // actual settledAt timestamp from the casino API (ms epoch)
  apiResponseTime?: number; // when our API responded (ms epoch)
  appReceivedTime?: number; // when the app received the event (ms epoch, via performance.now offset)
}

const listeners = new Set<(e: LiveResultEvent) => void>();
let lastResultKey: string | null = null;

export function subscribeLiveResults(cb: (e: LiveResultEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Broadcast a new live result. Only fires if the result is actually NEW
 * (different sector+time from the last one).
 */
export function broadcastLiveResult(e: LiveResultEvent): void {
  const key = `${e.sector}-${e.time}`;
  if (key === lastResultKey) return; // dedupe
  lastResultKey = key;
  listeners.forEach((l) => l(e));
}
