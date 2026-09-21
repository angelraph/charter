import { auditLog } from "../audit/log.js";
import type { ExecutionVenue, OpenOrder } from "../venues/types.js";

/** Orders CHARTER placed carry this client id prefix (see execution/adapter.ts), so it never touches an order it did not place. */
const CHARTER_PREFIX = "charter-";

export async function listOpenCharterOrders(venue: ExecutionVenue): Promise<OpenOrder[]> {
  const open = await venue.getOpenOrders();
  return open.filter((o) => o.clientOrderId.startsWith(CHARTER_PREFIX));
}

export async function cancelCharterOrder(venue: ExecutionVenue, symbol: string, orderId: string, by: string, reason?: string): Promise<void> {
  const result = await venue.cancelOrder(symbol, orderId);
  await auditLog.append("ORDER_CANCELLED", venue.name, {
    orderId,
    symbol,
    by,
    reason,
    status: result.status,
    executedQty: result.executedQty,
  });
}

/** Cancels every resting CHARTER order. Returns what was cancelled and what failed to cancel. */
export async function cancelAllCharterOrders(
  venue: ExecutionVenue,
  by: string,
  reason?: string
): Promise<{ cancelled: OpenOrder[]; failed: Array<{ order: OpenOrder; error: string }> }> {
  const cancelled: OpenOrder[] = [];
  const failed: Array<{ order: OpenOrder; error: string }> = [];
  for (const order of await listOpenCharterOrders(venue)) {
    try {
      await cancelCharterOrder(venue, order.symbol, order.orderId, by, reason);
      cancelled.push(order);
    } catch (err) {
      failed.push({ order, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { cancelled, failed };
}
