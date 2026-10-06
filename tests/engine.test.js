import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, playMove, findWinningCells, pickRandom, cellsOf, emptyCells, cpuMove,
} from '../js/engine.js';

// Deterministic RNG: always picks the first remaining candidate.
const first = () => 0;

const play = (state, moves, rng = first) => {
  let event;
  for (const m of moves) ({ state, event } = playMove(state, m, rng));
  return { state, event };
};

const boardFrom = (str) =>
  [...str.replace(/\s/g, '')].map((c) => (c === '.' ? null : { player: c }));

test('pickRandom returns k distinct items and caps at length', () => {
  const picked = pickRandom([1, 2, 3, 4, 5], 3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  assert.deepEqual(pickRandom([1], 2), [1]);
  assert.deepEqual(pickRandom([], 2), []);
});

test('findWinningCells detects rows, columns, diagonals and overlaps', () => {
  assert.deepEqual(findWinningCells(boardFrom('XXX ... ...'), 'X').cells, [0, 1, 2]);
  assert.deepEqual(findWinningCells(boardFrom('O.. O.. O..'), 'O').cells, [0, 3, 6]);
  assert.deepEqual(findWinningCells(boardFrom('X.. .X. ..X'), 'X').cells, [0, 4, 8]);
  const double = findWinningCells(boardFrom('XXX .X. .X.'), 'X');
  assert.equal(double.lines.length, 2);
  assert.deepEqual(double.cells, [0, 1, 2, 4, 7]);
});

test('turns alternate and occupied cells are rejected', () => {
  let { state } = play(createGame(), [4]);
  assert.equal(state.turn, 'O');
  assert.throws(() => playMove(state, 4), /occupied/);
  assert.throws(() => playMove(state, 9), /Bad cell/);
});

test('a win keeps exactly one winning piece, scores, and hands the turn to the loser', () => {
  // X: 0,1,2  O: 3,4
  const { state, event } = play(createGame(), [0, 3, 1, 4, 2]);
  assert.equal(event.type, 'win');
  assert.equal(event.player, 'X');
  assert.deepEqual(event.cells, [0, 1, 2]);
  assert.equal(event.removed.length, 2);
  assert.ok(event.cells.includes(event.survivor));

  assert.deepEqual(cellsOf(state.board, 'X'), [event.survivor]);
  assert.deepEqual(cellsOf(state.board, 'O'), [3, 4]); // loser's pieces untouched
  assert.equal(state.board[event.survivor].survivals, 1);
  assert.equal(state.scores.X, 1);
  assert.equal(state.turn, 'O');
  assert.equal(state.round, 2);
  assert.equal(event.boardBefore.filter(Boolean).length, 5);
});

test('winning with two lines at once still keeps a single survivor', () => {
  let state = createGame();
  state = { ...state, board: boardFrom('XX. .X. .XO'), turn: 'X' };
  const { state: s, event } = playMove(state, 2, first);
  assert.equal(event.lines.length, 2); // row 0-1-2 and column 1-4-7
  assert.equal(cellsOf(s.board, 'X').length, 1);
});

test('a draw removes 2 X and 2 O at random and continues the turn order', () => {
  // Final board:  X O X / X O O / O X X  — no line.
  const { state, event } = play(createGame(), [0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(event.type, 'draw');
  assert.equal(event.removed.X.length, 2);
  assert.equal(event.removed.O.length, 2);
  assert.equal(cellsOf(state.board, 'X').length, 3);
  assert.equal(cellsOf(state.board, 'O').length, 2);
  assert.equal(emptyCells(state.board).length, 4);
  assert.equal(state.turn, 'O'); // X played last
  assert.equal(state.draws, 1);
  assert.equal(state.round, 2);
});

test('pieces persist and old survivors can join a new winning line', () => {
  // Round 1: X wins on the top row; rng → keep cell 0.
  let { state } = play(createGame(), [0, 3, 1, 4, 2]);
  assert.deepEqual(cellsOf(state.board, 'X'), [0]);
  // Board now: X . . / O O . / . . .  — O (to move) wins on 5.
  ({ state } = play(state, [5]));
  assert.equal(state.scores.O, 1);
  assert.equal(state.round, 3);
  // X (loser) to move. Surviving X at 0 helps form column 0-3-6 or diagonal.
  const xs = cellsOf(state.board, 'X');
  assert.ok(xs.includes(0));
});

test('match ends early once the lead cannot be overcome (7-round mode)', () => {
  let state = createGame({ rounds: 7 });
  // Force X wins by setting up boards directly.
  const xWin = (s) => {
    s = { ...s, board: boardFrom('XX. ... ...'), turn: 'X' };
    return playMove(s, 2, first);
  };
  for (let i = 0; i < 3; i++) ({ state } = xWin(state));
  assert.equal(state.status, 'playing'); // 3–0 with 4 left
  ({ state } = xWin(state));
  assert.equal(state.status, 'over'); // 4–0 with 3 left → clinched
  assert.equal(state.winner, 'X');
});

test('tie after regulation goes to overtime; first round win decides it', () => {
  let state = { ...createGame({ rounds: 7 }), round: 7, scores: { X: 3, O: 3 } };
  const drawBoard = boardFrom('XOX XOO OX.');
  ({ state } = playMove({ ...state, board: drawBoard, turn: 'X' }, 8, first));
  assert.equal(state.status, 'playing');
  assert.equal(state.overtime, true);
  assert.equal(state.round, 8);

  // A draw in overtime keeps going.
  ({ state } = playMove({ ...state, board: boardFrom('XOX XOO OX.'), turn: 'X' }, 8, first));
  assert.equal(state.status, 'playing');
  assert.equal(state.round, 9);

  const { state: done, event } = playMove({ ...state, board: boardFrom('OO. ... ...'), turn: 'O' }, 2, first);
  assert.equal(event.gameOver, true);
  assert.equal(done.winner, 'O');
});

test('only 7- and 13-round modes are accepted', () => {
  const state = createGame({ rounds: 13 });
  assert.equal(state.totalRounds, 13);
  assert.throws(() => createGame({ rounds: 5 }), /Unsupported/);
});

test('CPU wins when it can and blocks otherwise', () => {
  const s = { ...createGame(), board: boardFrom('OO. XX. ...'), turn: 'X' };
  assert.equal(cpuMove(s, 'medium'), 5); // win beats block
  const s2 = { ...s, board: boardFrom('OO. X.. ..X'), turn: 'X' };
  assert.equal(cpuMove(s2, 'hard'), 2); // block
});

test('random full games never break invariants', () => {
  for (const rounds of [7, 13]) {
    for (let g = 0; g < 200; g++) {
      let state = createGame({ rounds });
      let guard = 0;
      while (state.status === 'playing' && guard++ < 5000) {
        const free = emptyCells(state.board);
        assert.ok(free.length > 0, 'board must never be full while playing');
        assert.equal(findWinningCells(state.board, 'X').lines.length, 0);
        assert.equal(findWinningCells(state.board, 'O').lines.length, 0);
        const move = cpuMove(state, g % 2 ? 'easy' : 'medium');
        ({ state } = playMove(state, move));
      }
      assert.equal(state.status, 'over');
      assert.ok(state.winner === 'X' || state.winner === 'O');
      assert.equal(state.scores.X + state.scores.O + state.draws, state.history.length);
    }
  }
});
