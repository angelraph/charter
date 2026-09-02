# CHARTER

CHARTER is a mandate and policy layer for AI trading agents on Binance. It is not a trading agent itself. Other agents' trade proposals have to pass through it before they can reach a Binance Agentic sub-account.

A human writes a covenant in plain English: spend caps, a symbol allowlist, leverage limits, a daily drawdown halt, a confirm-above-$X threshold. CHARTER compiles that into a live policy, simulates every proposal against real market data, and returns a real PASS, VETO, or ESCALATE verdict. Only a PASS, or a human-confirmed ESCALATE, ever reaches execution. Every step is written to a hash-chained audit log.

Built for the Binance Agent OS Mini Hackathon, Track A.

## Motivation

Binance's own coverage of the Agent OS launch names the problem this project addresses. TechCrunch's headline on the announcement: "Binance now lets AI agents trade, but keeping them in check is largely up to users." CHARTER takes that responsibility off the user and puts it in an enforced, auditable policy instead.

## Execution venue

CHARTER always executes against a real order-matching engine. It never fabricates fills or simulation numbers. Which engine it uses depends on the `EXECUTION_VENUE` setting.

`testnet` is the default: [Binance Spot Testnet](https://testnet.binance.vision), a real matching engine with virtual funds, at zero cost. This is what development and most of the demo footage run against.

`mainnet-mcp` points at the real [Binance Agent OS MCP server](https://developers.binance.com/en/docs/agent-native/mcp-server), against a real, self-funded Agentic sub-account. It's used only where explicitly stated, with a small amount of real funds.

Every audit log entry records which venue produced it. Check `data/audit.log.jsonl` to see exactly which fills were testnet and which, if any, were mainnet.

## Setup

```bash
npm install
cp .env.example .env
```

Get testnet credentials by logging into https://testnet.binance.vision with GitHub, then fill in `BINANCE_TESTNET_API_KEY` and `BINANCE_TESTNET_API_SECRET` in `.env`.

```bash
npm run testnet:smoke
```

That command should print a real balance and a real live order book, proving the connection actually works before you go further.

## Usage

```bash
npx tsx src/index.ts init
npx tsx src/index.ts propose BTCUSDT BUY --usd 15
npx tsx src/index.ts propose BTCUSDT BUY --usd 15 --execute
npx tsx src/index.ts mandate compile "Max 30 dollars per trade, spot only, halt at 8 percent drawdown"
npx tsx src/index.ts serve
npx tsx src/index.ts dashboard
npx tsx src/index.ts audit tail
npx tsx src/index.ts audit verify
```

`npm run rogue-agent` starts a separate process that submits a mix of compliant and violating proposals to a running `charter serve` instance, to demonstrate the veto working against a genuinely independent caller.

## Architecture

```
src/
  config.ts        env loading and validation
  mandate/         covenant schema, NL to policy compiler, mandate storage
  policy/          rule engine: evaluate(proposal, mandate, market) -> verdict
  market/          public market data, order-book simulator, NAV calculation
  venues/          ExecutionVenue interface, testnet and mainnet-mcp implementations
  execution/       PASS verdict to real order placement
  audit/           hash-chained, append-only audit log
  api/             local HTTP API other agents call: POST /propose
  cli/             CLI commands and the Ink terminal dashboard
  rogue-agent/     separate demo process that proposes trades, some violating policy
```

`venues/types.ts` defines the `ExecutionVenue` interface. That abstraction is what makes moving from testnet to mainnet a config change rather than a rewrite.

## License

MIT
