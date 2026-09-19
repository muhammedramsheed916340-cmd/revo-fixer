/**
 * SHARED WHEEL SECTOR ↔ OUTCOME MAP (ADDITIVE — new file)
 * ======================================================
 *
 * One canonical mapping used by the new signal layers so the live API sector
 * names, the engine's 8 outcome names, and the display labels can never drift
 * apart. Nothing existing is changed — the older components keep their own
 * local copies untouched.
 */

export const LIVE_RESULT_SECTOR_TO_OUTCOME: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  CoinFlip: "COIN FLIP",
  Pachinko: "PACHINKO",
  CashHunt: "CASH HUNT",
  CrazyTime: "CRAZY TIME",
  CrazyBonus: "CRAZY TIME",
};

export const OUTCOME_TO_LIVE_SECTOR: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  "COIN FLIP": "CoinFlip",
  PACHINKO: "Pachinko",
  "CASH HUNT": "CashHunt",
  "CRAZY TIME": "CrazyTime",
};

export const OUTCOME_DISPLAY: Record<string, string> = {
  "1": "1",
  "2": "2",
  "5": "5",
  "10": "10",
  "COIN FLIP": "COIN FLIP",
  PACHINKO: "PACHINKO",
  "CASH HUNT": "CASH HUNT",
  "CRAZY TIME": "CRAZY TIME",
};

export const OUTCOME_COLORS: Record<string, string> = {
  "1": "#448AFF",
  "2": "#2ed573",
  "5": "#ffa502",
  "10": "#ff4757",
  PACHINKO: "#00d4ff",
  "COIN FLIP": "#a78bfa",
  "CASH HUNT": "#FFD700",
  "CRAZY TIME": "#ff6b9d",
};
