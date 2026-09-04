# CHARTER demo runbook

A shot-by-shot script for the submission video. Every command here is real: it runs against the actual testnet venue, no fixtures or canned output. Run these in order, in a clean terminal, at a font size that reads well on video.

Before recording, reset to a known state is not required. It is fine to run this against the existing `data/audit.log.jsonl` and mandate, since the point is that everything shown is genuinely live, not that the numbers start at zero.

## Setup, two terminal windows

Terminal A: the CHARTER dashboard.

```bash
cd C:\Users\Admin\Desktop\charter
npx tsx src/index.ts dashboard
```

Terminal B: everything else.

```bash
cd C:\Users\Admin\Desktop\charter
```

## Shot 1: the thesis, on screen

Open `README.md` in an editor or just show it in a browser tab pointed at the GitHub repo. Read or caption the opening two paragraphs and the TechCrunch quote. This sets up why CHARTER exists before showing any code.

## Shot 2: the mandate

In terminal B, state both numbers explicitly so the outcome is predictable on camera rather than left to the compiler's own defaults:

```bash
npx tsx src/index.ts mandate compile "Hard cap of 300 dollars per order. Anything over 50 dollars needs my explicit confirmation. Daily spend cap 500 dollars. Spot only, halt at 8 percent drawdown. Only BTCUSDT and ETHUSDT, buys only."
```

Let the draft print, then type `ACTIVATE` when prompted. Narrate: a human wrote one sentence, CHARTER turned it into an enforced policy, and nothing is live until a human explicitly confirms it. Note the mandate id it prints, you will pass it to later commands with `--mandate <id>`.

## Shot 3: a rogue agent gets vetoed

Start the API in a third terminal if not already running:

```bash
npx tsx src/index.ts serve
```

Then, in terminal B:

```bash
npx tsx src/index.ts propose BTCUSDT BUY --usd 500 --mandate <the-new-mandate-id>
```

This exceeds the new mandate's $300 hard cap. Let the VETO print, and point at the line: no order was placed, and the audit log will show no `EXECUTION_ATTEMPTED` entry for it. This is the shot that proves the veto is real, not staged.

Switch to terminal A (the dashboard) and point out the VETO landing in the verdict feed within a few seconds, pulled from the same audit log, not a duplicate code path.

## Shot 4: a compliant trade actually fills

```bash
npx tsx src/index.ts propose BTCUSDT BUY --usd 15 --mandate <the-new-mandate-id> --execute
```

$15 is under the $50 confirm threshold, so this is a clean automatic PASS. Let it run through simulation, PASS, and a real fill with a real order id. Switch to the dashboard again and show the fill landing in the "Real fills" panel with the same order id.

## Shot 4.5: a mid-size trade needs a human, then gets one

```bash
npx tsx src/index.ts propose BTCUSDT BUY --usd 120 --mandate <the-new-mandate-id>
```

$120 is between the $50 confirm threshold and the $300 hard cap, so this comes back **ESCALATE**, not PASS or VETO: no violation, but a human sign-off is required before it can execute. Point at that distinction, it's the third real verdict, not just a synonym for PASS. Then supply the confirmation and show it actually fill:

```bash
npx tsx src/index.ts propose BTCUSDT BUY --usd 120 --mandate <the-new-mandate-id> --execute
```

`charter audit tail 4` afterward shows the full real sequence: `VERDICT_ISSUED (ESCALATE)` → `EXECUTION_CONFIRMED` (the human sign-off, logged) → `EXECUTION_ATTEMPTED` → `EXECUTION_FILLED`.

## Shot 5: the rogue-agent process

```bash
npm run rogue-agent
```

This is a genuinely separate OS process talking to CHARTER only over HTTP. Let it run through its scripted mix of proposals. Narrate that this process has no special access, no shortcuts, it gets the same real verdicts any other caller would.

## Shot 6: tamper-evidence

```bash
npx tsx src/index.ts audit verify
```

Show it passing. Then, only if you want the dramatic version, take a copy of `data/audit.log.jsonl`, hand-edit one character in one line, rerun `audit verify` to show it fails with the exact broken entry, then restore the original file and rerun to show it passes again. Do this on a copy, never on the live file, so nothing is actually lost.

## Shot 7: the close

Show the GitHub repo, the Skill Hub PR, and the test suite passing:

```bash
npm test
```

End on the tagline and the thesis line one more time.

## Timing

Aim for 60 to 90 seconds total. Shots 3 and 4 (a real veto and a real fill) are the two that matter most if you need to cut for time. Shot 4.5 (ESCALATE) is worth keeping if there's room, since it's the one verdict type nobody else will show. Everything else supports those.
