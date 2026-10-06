# Bit Tic-Tac-Toe — Survivor Protocol

Tic-Tac-Toe as a multi-round elimination game. **The board never resets.** After each round, the result changes the board and play continues on it.

> **Win → one winning piece survives. Draw → 2 pieces from each player are eliminated.**

## Rules

| Event | What happens |
|---|---|
| **Start** | Empty 3×3 board. X moves first. |
| **Round win** | The winning line is detected. One random piece from it **survives** and the other winning pieces are removed. The loser's pieces stay where they are. The **loser moves next**. If one move completes two lines at once, a single piece survives from all of them. |
| **Round draw** | The board is full with no line. **2 random X** and **2 random O** are eliminated. Turns keep alternating. |
| **Persistence** | Survivors and leftover pieces stay on the board and can form lines in later rounds. Pieces from earlier rounds are tagged `R1`, `R2`, … in the UI. |
| **Modes** | **7 rounds** or **13 rounds**. A draw counts as a round played. |
| **Match winner** | Most round wins. The match ends early once the leader can't be caught in the remaining rounds. |
| **Tie after the last round** | **Overtime**: rounds continue until someone wins one, and that player takes the match. |

### Edge cases
- **Board nearly empty / a player has no pieces:** no special case is needed. You place pieces as usual, and an empty board is just a fresh start.
- **Draw with fewer than 2 pieces of a colour:** removes as many as exist. This can only happen once a board has been reshaped by earlier rounds.
- **Can the board start a round already won?** No. After a win only one piece from the line remains, and after a draw the board is a subset of a full board that had no line.
- **Round counter:** goes up on every win or draw and is shown as `ROUND n / 7` (or `/ 13`, or `OT1`, `OT2`, … in overtime).

## Features
- Local two-player or **vs CPU** (Easy: random · Medium: win/block · Hard: minimax on the current round)
- Animated resolution: the winning line glows, removed pieces shatter and the survivor is badged
- A round log with exact coordinates (`A1`–`C3`) of kept and removed pieces
- Keyboard play (`1`–`9`), reduced-motion support, responsive down to phone width
- A dark "hunter" visual theme: carbon black, acid lime (X), blood orange (O), cut-corner panels

## Run it

It's a static site with no build step.

```bash
npm start          # serves on http://localhost:5173
# or
python3 -m http.server 5173
```

Open `index.html` through a server rather than `file://`, because ES modules need one.

## Deploy (Vercel)

`vercel.json` sets the project up as a static site with no build step. `.vercelignore` keeps tests and CI files out of the deployment.

1. At [vercel.com/new](https://vercel.com/new), import the GitHub repo `Smitesh24/bit-toe`.
2. Leave **Framework Preset** on *Other*, with the build command and output directory empty, then click **Deploy**.

After that, Vercel redeploys on every push: the production branch goes live and other branches get preview URLs.

Or from a terminal: `npx vercel --prod`.

## Test

```bash
npm test           # node --test, no dependencies
```

The engine tests cover win/draw resolution, turn handoff, multi-line wins, early clinch, overtime and the CPU's win/block logic. They also run 400 randomized full matches that check every move for invariants: the board is never full while a round is in play, and no line is ever left standing.

## Structure

```
index.html          markup, dialogs, SVG piece sprites
css/style.css       theme and layout
js/engine.js        pure game logic + CPU (no DOM, testable in Node)
js/ui.js            rendering, animation sequencing, input
tests/              node:test suite for the engine
```

`playMove(state, index, rng)` returns `{ state, event }`. The event (`move` / `win` / `draw`) includes `boardBefore`, the winning cells, the survivor and the removed cells, so the UI can animate the resolution before showing the new state.
