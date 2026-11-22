# token-radar-v3

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kriptmwan/token-radar-v3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kriptmwan/token-radar-v3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar v3 — which pre-token protocol is worth farming next, and what its token would be worth if it launched. Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.

The program reads a sealed DefiLlama snapshot, fits a comps curve on the protocols that already trade — log10(market cap) on log10(TVL) — and values every farmable pre-token protocol on that curve, adjusted by its 7-day TVL growth, by how long it has run with no token, and by the token odds of its age peers. It ranks 391 protocols by expected value (fitted value × token odds) and gives each a costed farm verdict — FARM (17), THIN (228) or SKIP (146) — with a farm plan. The held-out test is on the board: leaving each traded protocol out in turn, the curve misses by a median factor of ×3.399; a time-split backtest misses by ×3.078. Top expected value: Steakhouse Financial, $18.01M. Exchanges, bridges, liquid-staking and wrapped products are left off the board — no reader can farm a token out of them — while all 40 watchlist protocols are scored.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22 or later, standard library only, no install, no network. The program writes `board.json`, `data.js`, the dashboard and screenshots, and `dossier.json` to the output directory. It is deterministic: the same snapshot writes the same bytes on every run.

## Layout

- `main.ts` — entry program: reads the snapshot, scores the board, writes the output.
- `lib/model.ts` — the comps-fitted expected-value model.
- `dashboard/` — the board UI (`index.html`, `app.js`, `app.css`).
- `screenshots/` — three verified screenshots of the board.
- `vendor/makefun-board.ts` — the vendored make.fun board library.

---

<sub>Entered on [make.fun](https://make.fun/?ref=emz2619t&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
