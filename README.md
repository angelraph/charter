# CHARTER

**Nothing reaches Binance until it survives your charter.**

CHARTER is not a trading agent. It's a mandate/policy layer other AI agents must pass their trade proposals through before those trades can touch a Binance Agentic sub-account. A human writes a plain-English covenant (spend caps, leverage limits, drawdown halt, confirm-above-$X); CHARTER compiles it into a live policy, simulates every proposal against real market data, issues a real **PASS / VETO / ESCALATE** verdict, executes only on PASS, and keeps a tamper-evident audit log.

Built for the Binance Agent OS Mini Hackathon, Track A.

## Why

Binance's own Agent OS launch coverage names the gap directly — TechCrunch: *"Binance now lets AI agents trade, but keeping them in check is largely up to users."* CHARTER is the layer that takes that responsibility off the user and puts it in an enforced, auditable policy.

## Status: real execution, disclosed venue

CHARTER executes real orders against a real order-matching engine at all times — it never fabricates fills or simulation numbers. Which engine depends on `EXECUTION_VENUE`:

- `testnet` (default) — [Binance Spot Testnet](https://testnet.binance.vision), a real matching engine with virtual funds, zero cost. Used for all development and most demo footage.
- `mainnet-mcp` — the real [Binance Agent OS MCP server](https://developers.binance.com/en/docs/agent-native/mcp-server), against a real, self-funded Agentic sub-account. Used only where explicitly stated, with real (small) funds.

Every audit log entry is tagged with the venue that produced it — check `data/audit.log.jsonl` to see exactly which fills were testnet and which (if any) were mainnet.

## Setup

```bash
npm install
cp .env.example .env
```

Get testnet credentials by logging into https://testnet.binance.vision with GitHub, then fill `BINANCE_TESTNET_API_KEY` / `BINANCE_TESTNET_API_SECRET` into `.env`.

```bash
npm run testnet:smoke   # proves a real balance + real live order book
```

## Architecture

```
src/
  config.ts        # env loading + validation
  mandate/         # covenant schema + NL -> policy compiler
  policy/          # rule engine: evaluate(proposal, mandate, market) -> Verdict
  market/          # public market data + order-book simulator
  venues/          # ExecutionVenue interface + testnet/mainnet-mcp implementations
  execution/       # PASS verdict -> real order placement
  audit/           # hash-chained, append-only audit log
  api/             # local HTTP API other agents call: POST /propose
  cli/             # Ink terminal dashboard
  rogue-agent/     # separate demo process that proposes trades, some violating policy
```

See `venues/types.ts` for the `ExecutionVenue` interface — the abstraction that makes testnet → mainnet a one-line config change, not a rewrite.

## License

MIT
