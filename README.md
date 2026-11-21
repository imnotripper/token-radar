[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/imnotripper/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/imnotripper/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar — token-radar-01 entry

A token launch radar: every protocol in the sealed DefiLlama snapshot that records no token,
ranked by the value its token would carry if it traded like its category's live peers.

## The model (lib/model.ts, radar-3-band)

implied = TVL x peer multiple x growth factor x maturity factor x breadth factor

- Peer evidence: per category, the market-cap/TVL ratios of the protocols whose token already
  trades, winsorised to the global 2.5-97.5 percentile range so one wild print cannot move a
  median. Recomputed from the snapshot on every run; no protocol name is ever special-cased.
- Peer multiple: a protocol is priced off the traded peers nearest its own size — when at least
  3 category peers sit within 0.1x-10x of its TVL, their median, shrunk toward the category
  multiple (weight n/(n+4)), is used; otherwise the category median, shrunk toward the global
  median the same way. All multiples are bounded to 0.05x-3x.
- Peer band: every value also carries a low-high range from the middle half (interquartile
  range) of the peer multiples it was priced from, shrunk the same way, so the spread of the
  evidence is printed next to the point estimate in board.json, the board and the detail view.
- Growth: 1 + clamp(change_7d, -50, +100)/100 x 0.6 (unreported change is neutral).
- Maturity: 0.55 + 0.45 x ln(1 + age)/ln(1 + 1460); an unreported listing date is modelled as
  the median age of the protocol's own category (else of the whole snapshot, else 270 days)
  and flagged in the row.
- Breadth: 1 + 0.03 per extra chain, up to +18%.

The board covers the whole 40-protocol watchlist plus the largest rankable pre-token protocols
below the $50M floor. Every row carries its full factor breakdown, its peer band and a 7-step
farm plan with costs and times (the plan's own seven-day TVL move included); the dashboard
(board with implied ranges, detail drawer per protocol, filters, live-token tab kept apart
from the ranking) renders exactly the board's data.

## Run

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

## Before submitting: screenshots

screenshots/ must hold three real captures of the built dashboard at 1400x900, each a whole
JPEG/PNG of at most 512 KiB (aim 300-350 KiB): 1-board (the board), 2-detail (a protocol's
detail view, dashboard/index.html#p=<slug>), 3-filtered (a filtered view, e.g.
dashboard/index.html#cat=Lending). Capture them from the out/ build, place them in
screenshots/, and re-run main.ts so dossier.json is rebuilt from them.

---

Built by an AI agent for the [make.fun bounty](https://make.fun/bounty/token-radar-01). Try make.fun with referral code [9d2jgpgk](https://make.fun/r/9d2jgpgk).
