/**
 * Conway Credits Management
 *
 * Monitors the automaton's compute credit balance and triggers
 * survival mode transitions.
 */

import type {
  ConwayClient,
  FinancialState,
  SurvivalTier,
} from "../types.js";
import { SURVIVAL_THRESHOLDS } from "../types.js";
import type Database from "better-sqlite3";

/**
 * Check the current financial state of the automaton.
 * Includes sanity check: if API suddenly returns 0 but we had > $1 last check,
 * use cached balance instead of trusting a potentially bugged API response.
 * (Conway issue #202: API returns 0 even when credits exist)
 */
export async function checkFinancialState(
  conway: ConwayClient,
  usdcBalance: number,
  db?: Database.Database,
): Promise<FinancialState> {
  let creditsCents = await conway.getCreditsBalance();

  // Sanity check: protect against API returning 0 erroneously (issue #202)
  if (db) {
    try {
      const lastKnownRaw = db
        .prepare("SELECT value FROM kv WHERE key = 'last_known_credits'")
        .get() as { value: string } | undefined;
      const lastKnown = lastKnownRaw ? parseInt(lastKnownRaw.value, 10) : 0;

      if (creditsCents === 0 && lastKnown > 100) {
        // API says 0 but we had > $1 last time — likely a bugged response
        // Use cached value, don't let a single bad read trigger critical mode
        creditsCents = lastKnown;
      } else if (creditsCents > 0) {
        // Good read — cache it
        db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
          .run("last_known_credits", String(creditsCents));
      }
    } catch { /* best effort — don't break if kv table missing */ }
  }

  return {
    creditsCents,
    usdcBalance,
    lastChecked: new Date().toISOString(),
  };
}

/**
 * Determine the survival tier based on current credits.
 * Thresholds are checked in descending order: high > normal > low_compute > critical > dead.
 *
 * Zero credits = "critical" (broke but alive — can still accept funding, send distress).
 * Only negative balance (API-confirmed debt) = "dead".
 */
export function getSurvivalTier(creditsCents: number): SurvivalTier {
  if (creditsCents > SURVIVAL_THRESHOLDS.high) return "high";
  if (creditsCents > SURVIVAL_THRESHOLDS.normal) return "normal";
  if (creditsCents > SURVIVAL_THRESHOLDS.low_compute) return "low_compute";
  if (creditsCents >= 0) return "critical";
  return "dead";
}

/**
 * Format a credit amount for display.
 */
export function formatCredits(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
