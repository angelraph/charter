import { auditLog, type AuditEntry } from "../audit/log.js";
import type { ExecutionVenue } from "../venues/types.js";
import { computeApproxNavUsd } from "../market/nav.js";

function todayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Returns today's opening NAV baseline for the drawdown-halt rule. If no
 * NAV_SNAPSHOT has been recorded yet today, computes one from the venue
 * right now and logs it — so the very first proposal of the day sets the
 * baseline everything else is measured against.
 */
export async function getOrCreateStartOfDayNav(venue: ExecutionVenue, marketBaseUrl: string): Promise<number> {
  const todayStart = todayStartIso();
  const entries = await auditLog.all();
  const todaysSnapshot = entries.find((e: AuditEntry) => e.type === "NAV_SNAPSHOT" && e.timestamp >= todayStart);

  if (todaysSnapshot) {
    return (todaysSnapshot.payload as { navUsd: number }).navUsd;
  }

  const navUsd = await computeApproxNavUsd(venue, marketBaseUrl);
  await auditLog.append("NAV_SNAPSHOT", venue.name, { navUsd, reason: "start-of-day baseline" });
  return navUsd;
}
