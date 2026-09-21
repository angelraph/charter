# Threat model

What CHARTER is meant to protect, who it assumes can do what, and where the protection stops. This is written to be checked against the code, not to reassure.

## What is being protected

An exchange account's funds, from an autonomous agent that trades on it. The specific risks are an agent placing trades outside what its operator meant to allow, an agent talking its way past a human check, and the record of what happened being changed afterward.

## Actors

- **Agent.** Software that proposes trades. Untrusted. It may be buggy, manipulated by its inputs, or hostile.
- **Approver / operator.** A person who decides escalations and can halt trading. Trusted to act in good faith, and identified.
- **CHARTER host.** The machine running CHARTER, holding the audit log and the exchange credentials. Trusted.
- **The exchange.** Trusted to execute correctly. Out of scope.

## Trust boundary

CHARTER enforces limits only on trades that go through it. For that to mean anything, CHARTER must be the only holder of the exchange credentials. An agent that holds its own exchange key can trade without CHARTER, and nothing in this codebase can stop it. This is a property of how it is deployed, not something the software can guarantee. If you are not prepared to keep exchange credentials away from agents, CHARTER is advisory, not enforcing.

## Controls, and what each defends against

| Threat | Control | Where |
| --- | --- | --- |
| Agent exceeds size, symbol, side, spend, slippage, or drawdown limits | Six rules evaluated against a live simulation; any violation is a VETO and nothing reaches the exchange | `src/policy/engine.ts`, `src/policy/rules/` |
| Agent reaches the exchange without a passing verdict | Execution has a single entry point that refuses anything but PASS or an approved ESCALATE; a test asserts a VETO never calls the venue | `src/execution/adapter.ts` |
| Agent approves its own escalation | Deciding needs a separate credential the agent does not hold; the approver may not be the proposing agent | `src/api/server.ts`, `src/approval/service.ts` |
| Agent impersonates another agent | Identity comes from the agent's own key, never from the request body; a body naming another agent is refused | `src/api/server.ts` |
| Agent uses a mandate it was not given | Each agent is bound to specific mandates at registration | `src/agents/` |
| Agent reads another agent's results | Status and escalation lookups are scoped to the caller; someone else's is reported as not found | `src/api/server.ts` |
| A leaked or retired agent key keeps working | Keys are revocable and rotatable with immediate effect; only a hash is stored, and the key is shown once | `src/agents/service.ts` |
| Revoking the last agent reopens the API to everyone | Once any agent has been registered, an unauthenticated call is refused even if all are revoked | `registryInUse` in `src/agents/service.ts` |
| Approval replayed, or two approvals race | An approval is granted once; a per-id guard covers simultaneous requests | `src/approval/service.ts` |
| Approval acted on after conditions changed | The proposal is evaluated again, with fresh market data, spend, drawdown, and kill switch, at the moment of approval | `src/approval/service.ts` |
| Approval acted on after it went stale | Approvals expire | `src/approval/state.ts` |
| Trading must stop now | Kill switch vetoes everything, including an already-approved trade not yet executed | `src/policy/rules/killSwitch.ts` |
| The record is edited after the fact | Hash-chained log; edits, reordering, and deletions are detected by `audit verify` | `src/audit/log.ts` |
| Acting on a tampered record | The chain is verified before an approval is acted on | `src/approval/service.ts` |
| Timing attacks on key comparison | Constant-time comparison for every credential | `constantTimeEquals` |
| Error responses leak internals | Malformed input returns a plain 400; unexpected errors return no stack trace or paths | `src/api/server.ts` |

## What this does not protect against

- **An agent with its own exchange credentials.** See the trust boundary above.
- **A compromised CHARTER host.** Whoever controls the machine controls the audit file, the keys, and the process. The hash chain detects editing by someone who cannot recompute it; it does not stop someone who can rewrite the whole file from the beginning. There is no external anchor for the chain.
- **A bad approver.** A person with the approver credential can approve something they should not. The approval is attributed and logged, which is accountability, not prevention.
- **Approver identity over the API is asserted, not proven.** The approver key proves someone holds it; the `X-Charter-Approver` name is whatever they claim. Separate approvers should hold separate credentials, which today means separate deployments. The CLI records the operating-system username.
- **One shared approver key.** Unlike agents, approvers do not yet each have their own key.
- **Denial of service.** There is no rate limiting on the API beyond what the mandate rules impose on trading.
- **Transport security.** The server speaks plain HTTP. Put it behind TLS if it is reachable beyond localhost.
- **Testnet only.** Everything here has been exercised against Binance Spot Testnet. The mainnet execution path has not been run.
- **Simulation is an estimate.** It walks a sampled order book and can understate the impact of a large order; it now says so when the depth ran out, but it does not predict moves between simulation and fill.

## Assumptions worth stating

- The audit file is only written by CHARTER. Two CHARTER processes writing the same file concurrently is not supported.
- Agent keys and the approver key are kept secret by whoever holds them.
- The system clock is roughly right; approval expiry depends on it.
