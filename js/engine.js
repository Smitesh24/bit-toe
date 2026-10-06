// Bit Tic-Tac-Toe — pure game engine (no DOM).
//
// Rules
//  - Standard 3×3 board. X opens round 1.
//  - The board is NOT reset between rounds; pieces persist.
//  - Round WIN: one random piece from the winning cells survives, the
//    other winning pieces are removed. The loser moves next.
//  - Round DRAW (board full, no line): 2 random X and 2 random O pieces
//    are removed. Turns keep alternating.
//  - The match lasts N rounds (7 or 13). Most round wins takes the match.
//    The match ends early once the leader can no longer be caught.
//    A tie after the last round goes to sudden-death overtime: the next
//    round won decides it.

export const PLAYERS = ['X', 'O'];
export const MODES = [7, 13];
export const DRAW_REMOVALS = 2;

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

export const other = (player) => (player === 'X' ? 'O' : 'X');

/** Pick `k` distinct random items from `items` (Fisher–Yates prefix). */
export function pickRandom(items, k, rng = Math.random) {
  const pool = items.slice();
  const n = Math.min(k, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Lines completed by `player`, and the union of their cells. */
export function findWinningCells(board, player) {
  const lines = LINES.filter((line) => line.every((i) => board[i]?.player === player));
  const cells = [...new Set(lines.flat())].sort((a, b) => a - b);
  return { lines, cells };
}

export const cellsOf = (board, player) =>
  board.reduce((acc, cell, i) => (cell?.player === player ? [...acc, i] : acc), []);

export const emptyCells = (board) =>
  board.reduce((acc, cell, i) => (cell ? acc : [...acc, i]), []);

export function createGame({ rounds = 7, starter = 'X' } = {}) {
  if (!MODES.includes(rounds)) throw new Error(`Unsupported mode: ${rounds} rounds`);
  return {
    board: Array(9).fill(null),
    turn: starter,
    round: 1,
    totalRounds: rounds,
    overtime: false,
    scores: { X: 0, O: 0 },
    draws: 0,
    moveCount: 0,
    history: [],
    status: 'playing', // 'playing' | 'over'
    winner: null,
  };
}

/** True once the leader's margin exceeds the regulation rounds left. */
function isClinched(state) {
  if (state.overtime) return false;
  const remaining = state.totalRounds - state.round; // rounds still to play after this one
  return Math.abs(state.scores.X - state.scores.O) > remaining;
}

function leader(scores) {
  if (scores.X === scores.O) return null;
  return scores.X > scores.O ? 'X' : 'O';
}

/**
 * Place the current player's piece at `index`.
 * Returns { state, event } where `state` is a new state object and
 * `event` describes what happened (for UI animation):
 *   { type: 'move', index, player }
 *   { type: 'win',  index, player, round, lines, cells, survivor, removed, boardBefore, gameOver }
 *   { type: 'draw', index, player, round, removed: {X, O}, boardBefore, gameOver }
 */
export function playMove(state, index, rng = Math.random) {
  if (state.status !== 'playing') throw new Error('Game is over');
  if (!Number.isInteger(index) || index < 0 || index > 8) throw new Error(`Bad cell: ${index}`);
  if (state.board[index]) throw new Error(`Cell ${index} is occupied`);

  const player = state.turn;
  const board = state.board.slice();
  board[index] = { player, round: state.round, id: state.moveCount + 1 };
  const next = { ...state, board, moveCount: state.moveCount + 1, scores: { ...state.scores } };

  const { lines, cells } = findWinningCells(board, player);

  if (lines.length) {
    const boardBefore = board.slice();
    const [survivor] = pickRandom(cells, 1, rng);
    const removed = cells.filter((i) => i !== survivor);
    for (const i of removed) board[i] = null;
    board[survivor] = { ...board[survivor], survivals: (board[survivor].survivals ?? 0) + 1 };

    next.scores[player] += 1;
    next.turn = other(player);
    const event = { type: 'win', index, player, round: state.round, lines, cells, survivor, removed, boardBefore };
    return finishRound(next, event);
  }

  if (board.every(Boolean)) {
    const boardBefore = board.slice();
    const removed = {
      X: pickRandom(cellsOf(board, 'X'), DRAW_REMOVALS, rng),
      O: pickRandom(cellsOf(board, 'O'), DRAW_REMOVALS, rng),
    };
    for (const i of [...removed.X, ...removed.O]) board[i] = null;

    next.draws += 1;
    next.turn = other(player);
    const event = { type: 'draw', index, player, round: state.round, removed, boardBefore };
    return finishRound(next, event);
  }

  next.turn = other(player);
  return { state: next, event: { type: 'move', index, player } };
}

function finishRound(next, event) {
  next.history = [...next.history, {
    round: event.round,
    overtime: next.overtime,
    result: event.type,
    player: event.type === 'win' ? event.player : null,
  }];

  const regulationDone = !next.overtime && next.round >= next.totalRounds;
  const overtimeDecided = next.overtime && event.type === 'win';

  if (overtimeDecided || isClinched(next) || (regulationDone && leader(next.scores))) {
    next.status = 'over';
    next.winner = leader(next.scores);
  } else {
    if (regulationDone) next.overtime = true;
    next.round += 1;
  }

  return { state: next, event: { ...event, gameOver: next.status === 'over' } };
}

// ───────────────────────── CPU opponent ─────────────────────────

/**
 * Choose a move for `state.turn`.
 * level: 'easy' (random), 'medium' (win/block, otherwise random), 'hard' (minimax on the round).
 */
export function cpuMove(state, level = 'hard', rng = Math.random) {
  const me = state.turn;
  const free = emptyCells(state.board);
  if (!free.length) return null;
  if (level === 'easy') return pickRandom(free, 1, rng)[0];

  const winNow = free.find((i) => completes(state.board, i, me));
  if (winNow !== undefined) return winNow;
  const block = free.find((i) => completes(state.board, i, other(me)));
  if (block !== undefined) return block;
  if (level === 'medium') return pickRandom(free, 1, rng)[0];

  // Minimax over the current round. Ties broken randomly so play stays varied.
  let best = -Infinity;
  let bestMoves = [];
  for (const i of free) {
    const b = state.board.slice();
    b[i] = { player: me };
    const score = minimax(b, other(me), me, 1);
    if (score > best) { best = score; bestMoves = [i]; }
    else if (score === best) bestMoves.push(i);
  }
  return pickRandom(bestMoves, 1, rng)[0];
}

function completes(board, index, player) {
  const b = board.slice();
  b[index] = { player };
  return findWinningCells(b, player).lines.length > 0;
}

function minimax(board, toMove, me, depth) {
  const last = other(toMove);
  if (findWinningCells(board, last).lines.length) return last === me ? 10 - depth : depth - 10;
  const free = emptyCells(board);
  if (!free.length) return 0;

  const scores = free.map((i) => {
    const b = board.slice();
    b[i] = { player: toMove };
    return minimax(b, other(toMove), me, depth + 1);
  });
  return toMove === me ? Math.max(...scores) : Math.min(...scores);
}
