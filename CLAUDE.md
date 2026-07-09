# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Vanilla JS Tetris. HTML5 Canvas + CSS. No dependencies, no build, no bundler, no package.json, no tests.

## Run

Open `index.html` directly, or serve statically:

```bash
open index.html               # macOS
python3 -m http.server 8000   # then visit http://localhost:8000
```

No build/lint/test tooling exists.

## Architecture

Three files: `index.html` (DOM + two canvases), `style.css` (dark theme), `game.js` (all logic, ~300 lines, single global scope, `'use strict'`).

Key invariants in `game.js`:

- **Board model**: `ROWS x COLS` matrix. Each cell is `0` (empty) or color index `1-7`. Color index doubles as piece id — `COLORS` and `PIECES` are 1-indexed arrays with `null` at index 0.
- **Pieces are mutated in place**: `current.shape` is reassigned on rotation (`rotateCW` returns new matrix). `randomPiece()` deep-copies from `PIECES` so the templates stay pristine.
- **Coupled dimensions**: canvas `width`/`height` in `index.html` (300x600) must equal `COLS*BLOCK` x `ROWS*BLOCK`. Changing `COLS`/`ROWS`/`BLOCK` in `game.js` requires editing the `<canvas id="board">` attributes too.
- **Game loop**: single `requestAnimationFrame(loop)`, time-accumulator drives gravity via `dropAccum >= dropInterval`. Pause/gameOver both `cancelAnimationFrame`; resume restarts the loop and resets `lastTime` (else a huge `dt` spike). `animId` holds the frame handle.
- **State reset**: `init()` re-inits every global and is also the restart handler (`restartBtn` click). All game state lives in module-level `let` vars declared line ~43.
- **`collide(shape, x, y)`** is the single source of truth for movement/rotation/lock/ghost checks — reused everywhere, don't duplicate bounds logic.
