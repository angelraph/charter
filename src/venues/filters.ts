/**
 * Exchange precision rules. Binance rejects an order whose quantity is not
 * a multiple of the symbol's step size, or whose price is not a multiple of
 * its tick size, so both are rounded down to what the exchange will accept.
 */

export interface SymbolFilters {
  stepSize: string;
  tickSize: string;
  minQty: number;
  minNotional: number;
}

interface RawFilter {
  filterType: string;
  stepSize?: string;
  tickSize?: string;
  minQty?: string;
  minNotional?: string;
}

export function decimalsOf(step: string): number {
  const trimmed = step.includes(".") ? step.replace(/0+$/, "") : step;
  const dot = trimmed.indexOf(".");
  return dot === -1 ? 0 : trimmed.length - dot - 1;
}

/** Rounds down to a multiple of `step`, never up, so a quantity is never larger than what was approved. */
export function roundDownToStep(value: number, step: string): number {
  const stepNum = parseFloat(step);
  if (!(stepNum > 0)) return value;
  const units = Math.floor(value / stepNum + 1e-9);
  return Number((units * stepNum).toFixed(decimalsOf(step)));
}

export function parseFilters(filters: RawFilter[]): SymbolFilters {
  const lot = filters.find((f) => f.filterType === "LOT_SIZE");
  const price = filters.find((f) => f.filterType === "PRICE_FILTER");
  const notional = filters.find((f) => f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL");
  return {
    stepSize: lot?.stepSize ?? "0",
    tickSize: price?.tickSize ?? "0",
    minQty: parseFloat(lot?.minQty ?? "0"),
    minNotional: parseFloat(notional?.minNotional ?? "0"),
  };
}
