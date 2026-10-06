import { createGame, playMove, cpuMove } from './engine.js';

const $ = (id) => document.getElementById(id);
const els = {
  board: $('board'), banner: $('banner'), turn: $('turn'), log: $('log'), pips: $('pips'),
  roundNum: $('roundNum'), roundTotal: $('roundTotal'), roundLabel: $('roundLabel'), drawCount: $('drawCount'),
  scoreX: $('scoreX'), scoreO: $('scoreO'), nameX: $('nameX'), nameO: $('nameO'), cardX: $('cardX'), cardO: $('cardO'),
  setup: $('setup'), setupForm: $('setupForm'), levelSet: $('levelSet'), rules: $('rules'), over: $('over'),
  overTitle: $('overTitle'), finalScore: $('finalScore'), winnerGlyph: $('winnerGlyph'),
};

const COLS = ['A', 'B', 'C'];
const coord = (i) => `${COLS[i % 3]}${Math.floor(i / 3) + 1}`;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? Math.min(ms, 250) : ms));
const icon = (p, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#piece-${p.toLowerCase()}"/></svg>`;

let config = { rounds: 7, opponent: 'human', level: 'hard' };
let game = null;
let busy = false;
let lastIndex = null;
let token = 0; // invalidates pending async work when a new match starts

const isCpu = (player) => config.opponent === 'cpu' && player === 'O';
const nameOf = (p) => (config.opponent === 'cpu' ? (p === 'X' ? 'You' : 'Venator Bot') : `Hunter ${p}`);

// ───────── Board ─────────

const cells = Array.from({ length: 9 }, (_, i) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cell';
  btn.dataset.index = i;
  btn.setAttribute('role', 'gridcell');
  btn.addEventListener('click', () => onCell(i));
  els.board.append(btn);
  return btn;
});

function renderBoard(board, deco = {}) {
  const round = game.round;
  els.board.dataset.turn = game.turn;
  els.board.classList.toggle('locked', busy || game.status !== 'playing' || isCpu(game.turn));

  board.forEach((piece, i) => {
    const c = cells[i];
    const cls = ['cell'];
    let html = `<span class="coord">${coord(i)}</span>`;
    if (piece) {
      cls.push('filled', piece.player.toLowerCase());
      html += icon(piece.player, 'piece');
      const veteran = piece.round < round && !deco.hideVeteran;
      if (veteran) html += `<span class="vet${piece.survivals ? ' kept' : ''}" title="Placed in round ${piece.round}">R${piece.round}</span>`;
    } else {
      html += icon(game.turn, 'ghost');
    }
    if (deco.win?.has(i)) cls.push('win');
    if (deco.doomed?.has(i)) cls.push('doomed');
    if (deco.removing?.has(i)) cls.push('removing');
    if (deco.survivor === i) cls.push('survivor');
    if (i === lastIndex && piece) cls.push('last');

    // Re-create the piece node only when it changes so the drop animation plays once.
    const key = `${piece ? `${piece.player}${piece.id}` : '-'}|${game.turn}|${deco.hideVeteran ? 1 : 0}|${round}`;
    if (c.dataset.key !== key) {
      c.innerHTML = html;
      c.dataset.key = key;
    }
    c.className = cls.join(' ');
    c.setAttribute('aria-label', `${coord(i)}, ${piece ? piece.player : 'empty'}`);
    c.disabled = false;
    c.setAttribute('aria-disabled', String(Boolean(piece) || busy));
  });
}

// ───────── HUD ─────────

function renderHud() {
  els.scoreX.textContent = game.scores.X;
  els.scoreO.textContent = game.scores.O;
  els.nameX.textContent = nameOf('X');
  els.nameO.textContent = nameOf('O');
  els.drawCount.textContent = game.draws;
  els.roundTotal.textContent = game.totalRounds;
  els.roundNum.textContent = game.overtime ? `OT${game.round - game.totalRounds}` : game.round;
  els.roundLabel.textContent = game.overtime ? 'Overtime' : 'Round';
  els.roundLabel.parentElement.classList.toggle('overtime', game.overtime);

  const playing = game.status === 'playing';
  els.cardX.classList.toggle('active', playing && game.turn === 'X');
  els.cardO.classList.toggle('active', playing && game.turn === 'O');

  const p = game.turn;
  els.turn.innerHTML = !playing
    ? 'Match over'
    : busy
      ? 'Resolving round…'
      : isCpu(p)
        ? `<b class="o">${nameOf(p)}</b> is thinking…`
        : `<b class="${p.toLowerCase()}">${nameOf(p)}</b> to move`;

  const pips = [];
  for (let r = 1; r <= Math.max(game.totalRounds, game.history.length); r++) {
    const h = game.history[r - 1];
    const cls = h ? (h.result === 'draw' ? 'd' : h.player.toLowerCase()) : r === game.round && playing ? 'now' : '';
    pips.push(`<span class="pip ${cls}"></span>`);
  }
  els.pips.innerHTML = pips.join('');
}

function setBanner(text, kind = '') {
  els.banner.className = `banner ${kind}`;
  els.banner.innerHTML = text;
  void els.banner.offsetWidth; // restart animation
  if (kind) els.banner.classList.add('flash');
}

function addLog(event, state) {
  if (els.log.querySelector('.empty')) els.log.innerHTML = '';
  const li = document.createElement('li');
  const r = state.history.at(-1);
  const label = r.overtime ? `OT${event.round - state.totalRounds}` : `R${event.round}`;
  if (event.type === 'win') {
    const p = event.player.toLowerCase();
    li.className = p;
    li.innerHTML = `<span class="r">${label}</span><span class="what"><b class="${p}">${event.player} wins</b>. Kept ${coord(event.survivor)}, removed ${event.removed.map(coord).join(' ')}</span>`;
  } else {
    li.className = 'd';
    li.innerHTML = `<span class="r">${label}</span><span class="what"><b class="d">Draw</b>. Removed X ${event.removed.X.map(coord).join(' ') || '—'} · O ${event.removed.O.map(coord).join(' ') || '—'}</span>`;
  }
  els.log.prepend(li);
}

function render(deco) {
  renderBoard(game.board, deco);
  renderHud();
}

// ───────── Flow ─────────

function startMatch() {
  token++;
  busy = false;
  lastIndex = null;
  game = createGame({ rounds: config.rounds });
  els.log.innerHTML = '<li class="empty">No rounds played yet.</li>';
  for (const c of cells) c.dataset.key = '';
  setBanner(`Round 1 of ${config.rounds}. Board persists, survivors carry over.`);
  render();
  maybeCpu();
}

function onCell(i) {
  if (!game || busy || game.status !== 'playing' || isCpu(game.turn) || game.board[i]) return;
  apply(i);
}

async function apply(i) {
  const my = token;
  const { state, event } = playMove(game, i);
  lastIndex = i;

  if (event.type === 'move') {
    game = state;
    render();
    maybeCpu();
    return;
  }

  busy = true;
  const prev = game;
  // Show the completed board (before removals) with the round still current.
  game = { ...prev, board: event.boardBefore, turn: event.player };
  renderHud();

  if (event.type === 'win') {
    const p = event.player;
    setBanner(`${nameOf(p)} takes round ${event.round}`, p.toLowerCase());
    renderBoard(event.boardBefore, { win: new Set(event.cells) });
    await wait(900);
    if (my !== token) return;
    renderBoard(event.boardBefore, { win: new Set([event.survivor]), doomed: new Set(event.removed) });
    await wait(500);
    if (my !== token) return;
    renderBoard(event.boardBefore, { removing: new Set(event.removed), survivor: event.survivor });
    await wait(600);
    if (my !== token) return;
    game = state;
    lastIndex = null;
    renderBoard(game.board, { survivor: event.survivor });
    setBanner(`${p} at ${coord(event.survivor)} survives · ${event.removed.length} removed`, p.toLowerCase());
  } else {
    const doomed = new Set([...event.removed.X, ...event.removed.O]);
    setBanner(`Round ${event.round} draw · eliminating 2 X + 2 O`, 'draw');
    renderBoard(event.boardBefore, { doomed });
    await wait(1000);
    if (my !== token) return;
    renderBoard(event.boardBefore, { removing: doomed });
    await wait(600);
    if (my !== token) return;
    game = state;
    lastIndex = null;
    renderBoard(game.board);
    setBanner(`Draw resolved · ${doomed.size} pieces eliminated`, 'draw');
  }

  addLog(event, state);
  busy = false;
  render(event.type === 'win' ? { survivor: event.survivor } : undefined);

  if (event.gameOver) {
    await wait(700);
    if (my !== token) return;
    showGameOver();
  } else {
    if (game.overtime && game.round === game.totalRounds + 1 && prev.round === game.totalRounds) {
      setBanner('Tied after regulation · Overtime: next round win takes it', 'draw');
    }
    maybeCpu();
  }
}

function maybeCpu() {
  if (game.status !== 'playing' || !isCpu(game.turn)) return;
  const my = token;
  renderHud();
  setTimeout(() => {
    if (my !== token || busy || game.status !== 'playing') return;
    apply(cpuMove(game, config.level));
  }, reducedMotion ? 150 : 550);
}

function showGameOver() {
  const w = game.winner;
  els.winnerGlyph.className = `winner-glyph ${w.toLowerCase()}`;
  els.winnerGlyph.innerHTML = icon(w);
  els.overTitle.textContent = config.opponent === 'cpu' ? (w === 'X' ? 'You win the hunt' : 'Venator Bot wins') : `${nameOf(w)} wins`;
  const played = game.history.length;
  els.finalScore.textContent = `X ${game.scores.X} – ${game.scores.O} O · ${game.draws} draw${game.draws === 1 ? '' : 's'} · ${played} round${played === 1 ? '' : 's'} played`;
  els.over.returnValue = '';
  els.over.showModal();
}

// ───────── Dialogs & input ─────────

function openSetup() {
  els.setupForm.rounds.value = String(config.rounds);
  els.setupForm.opponent.value = config.opponent;
  els.setupForm.level.value = config.level;
  els.levelSet.disabled = config.opponent !== 'cpu';
  els.setup.returnValue = '';
  els.setup.showModal();
}

els.setupForm.addEventListener('change', () => {
  els.levelSet.disabled = els.setupForm.opponent.value !== 'cpu';
});

els.setup.addEventListener('close', () => {
  if (els.setup.returnValue !== 'start' && game) return;
  const f = els.setupForm;
  config = { rounds: Number(f.rounds.value), opponent: f.opponent.value, level: f.level.value };
  try { localStorage.setItem('bit-ttt-config', JSON.stringify(config)); } catch {}
  startMatch();
});

els.over.addEventListener('close', () => {
  if (els.over.returnValue === 'setup') openSetup();
  else if (els.over.returnValue === 'rematch') startMatch();
});

$('newBtn').addEventListener('click', openSetup);
$('rulesBtn').addEventListener('click', () => els.rules.showModal());

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 9) onCell(n - 1);
});

// Boot
try {
  const saved = JSON.parse(localStorage.getItem('bit-ttt-config') || 'null');
  if (saved && [7, 13].includes(saved.rounds)) config = { ...config, ...saved };
} catch {}
openSetup();
