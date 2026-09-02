/**
 * Public, unauthenticated market data. Venue-aware: pass the base URL of
 * whichever venue is active so displayed reference prices always match
 * the venue that will actually execute (testnet and mainnet order books
 * differ — mixing them would make CHARTER's own numbers dishonest).
 */

export interface Ticker {
  symbol: string;
  price: number;
}

export async function getTickerPrice(baseUrl: string, symbol: string): Promise<Ticker> {
  const res = await fetch(`${baseUrl}/api/v3/ticker/price?symbol=${symbol}`);
  if (!res.ok) throw new Error(`ticker/price failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { symbol: string; price: string };
  return { symbol: json.symbol, price: parseFloat(json.price) };
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export async function getKlines(baseUrl: string, symbol: string, interval = "1m", limit = 50): Promise<Kline[]> {
  const res = await fetch(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`klines failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as Array<
    [number, string, string, string, string, string, number, string, number, string, string, string]
  >;
  return json.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}
