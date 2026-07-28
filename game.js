'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#9e9e9e', // N - tuerca (gris metálico)
  '#eeeeee', // comodín (Tinte) - renderizado con rayas en drawBlock
];

const WILDCARD_INDEX = COLORS.length - 1;

const POWERUP_TYPES = ['bomb', 'lightning', 'tint', 'gravity', 'freeze'];
const POWERUP_META = {
  bomb: { color: '#ff5252', glyph: '\u{1F4A3}', name: 'BOMBA' },
  lightning: { color: '#fff176', glyph: '⚡', name: 'RAYO' },
  tint: { color: '#ba68c8', glyph: '◆', name: 'TINTE' },
  gravity: { color: '#78909c', glyph: '▼', name: 'GRAVEDAD' },
  freeze: { color: '#4fc3f7', glyph: '❄', name: 'CONGELAR' },
};
const POWERUP_SCORE = { bombPerCell: 40, lightningPerCell: 25, tintFlat: 250, gravityFlat: 100 };
const LINES_PER_POWERUP = 5;
const FREEZE_DURATION = 5000;
const FLASH_DURATION = 150;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca (hueco central)
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const T_SPIN_SCORES = [400, 800, 1200, 1600]; // indexado por cleared - 1
const PERFECT_CLEAR_SCORES = [0, 1000, 2500, 4000, 6000];
const COMBO_CAP = 8;
const B2B_MULT = 1.5;
const TOAST_DURATION = 900;
const SHAKE_DURATION = 250;

const THEME = {
  dark: { gridColor: '#22222e', highlightColor: 'rgba(255,255,255,0.12)' },
  light: { gridColor: '#c7c7d6', highlightColor: 'rgba(255,255,255,0.4)' },
};
let currentTheme = THEME.dark;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeSwitch = document.getElementById('theme-switch');
const powerupStatusEl = document.getElementById('powerup-status');
const comboStatusEl = document.getElementById('combo-status');
const muteSwitch = document.getElementById('mute-switch');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let linesSincePowerup, activeFlashes, freezeRemaining;
let comboCount, b2bCount, lastClearWasDifficult, lastActionWasRotation;
let activeToasts, shakeRemaining;
let audioCtx = null;
let muted = false;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function createPowerupPiece(powerupType) {
  return {
    isPowerup: true,
    powerupType,
    shape: [[1]],
    x: Math.floor(COLS / 2),
    y: 0,
  };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastActionWasRotation = true;
      return;
    }
  }
}

// Regla de 3 esquinas. Se llama antes de merge(); las esquinas del 3x3 de la T
// están vacías en la propia pieza, así que solo mira el tablero.
function isTSpin() {
  if (current.isPowerup || current.type !== 3 || !lastActionWasRotation) return false;
  const cx = current.x + 1, cy = current.y + 1;
  const corners = [[cy - 1, cx - 1], [cy - 1, cx + 1], [cy + 1, cx - 1], [cy + 1, cx + 1]];
  let occupied = 0;
  for (const [r, c] of corners) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) { occupied++; continue; }
    if (board[r][c]) occupied++;
  }
  return occupied >= 3;
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

function boardIsEmpty() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]) return false;
  return true;
}

// Puntúa una limpieza. `combo` distingue el lock de una pieza normal (alimenta
// combo/B2B) de las limpiezas provocadas por power-ups (no las tocan).
function applyClear(cleared, opts) {
  const combo = opts && opts.combo;
  const tspin = !!(opts && opts.tspin);

  if (combo) {
    if (cleared) comboCount++;
    else comboCount = 0;
  }

  if (cleared) {
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);

    let points = tspin
      ? (T_SPIN_SCORES[cleared - 1] || 0) * level
      : (LINE_SCORES[cleared] || 0) * level;

    let b2b = false;
    if (combo) {
      const difficult = cleared === 4 || tspin;
      if (difficult) {
        if (lastClearWasDifficult) {
          b2b = true;
          b2bCount++;
          points *= B2B_MULT;
        }
        lastClearWasDifficult = true;
      } else {
        lastClearWasDifficult = false;
        b2bCount = 0;
      }
      points *= Math.min(comboCount, COMBO_CAP);
    }

    const perfect = boardIsEmpty();
    if (perfect) points += (PERFECT_CLEAR_SCORES[cleared] || 0) * level;

    score += Math.round(points);

    linesSincePowerup += cleared;
    if (linesSincePowerup >= LINES_PER_POWERUP && next && !next.isPowerup) {
      linesSincePowerup -= LINES_PER_POWERUP;
      const powerupType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
      next = createPowerupPiece(powerupType);
      drawNext();
    }

    if (combo) celebrateClear(cleared, tspin, b2b, perfect);
    updateHUD();
  } else if (combo) {
    updateHUD();
  }
}

const CLEAR_NAMES = ['SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];

function celebrateClear(cleared, tspin, b2b, perfect) {
  if (tspin) {
    pushToast(`T-SPIN ${CLEAR_NAMES[cleared - 1]}`, '#ba68c8');
    shakeRemaining = SHAKE_DURATION;
    playChord([523.25, 659.25, 784]);
  } else if (cleared === 4) {
    pushToast('TETRIS', '#4dd0e1');
    shakeRemaining = SHAKE_DURATION;
    playChord([392, 523.25]);
  }
  if (b2b) pushToast('BACK-TO-BACK', '#ffd54f');
  if (comboCount >= 2) {
    pushToast(`COMBO x${Math.min(comboCount, COMBO_CAP)}`, '#81c784');
    playCombo(comboCount);
  } else if (!tspin && cleared < 4) {
    playTone(330, 0.09, 'square', 0.08);
  }
  if (perfect) {
    pushToast('PERFECT CLEAR', '#ffb74d');
    shakeRemaining = SHAKE_DURATION;
    playArpeggio([523.25, 659.25, 784, 1046.5]);
  }
}

function pushToast(text, color) {
  activeToasts.push({ text, color, elapsed: 0, duration: TOAST_DURATION });
}

// ---- Audio sintetizado (sin assets ni deps) ----

function initAudio() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    audioCtx = new Ctor();
  }
  // Nace 'suspended'; solo un gesto del usuario puede reanudarlo.
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, dur, type, gain, delay) {
  if (muted || !audioCtx) return;
  const start = audioCtx.currentTime + (delay || 0);
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.type = type || 'square';
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain ?? 0.1, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function playCombo(n) {
  playTone(440 * Math.pow(2, Math.min(n, COMBO_CAP) / 12), 0.12, 'square', 0.09);
}

function playChord(freqs) {
  for (const f of freqs) playTone(f, 0.28, 'triangle', 0.08);
}

function playArpeggio(freqs) {
  freqs.forEach((f, i) => playTone(f, 0.18, 'triangle', 0.09, i * 0.07));
}

function triggerPowerup(type, x, y) {
  const flashCells = [];
  if (type === 'bomb') {
    let destroyed = 0;
    for (let r = y - 1; r <= y + 1; r++) {
      for (let c = x - 1; c <= x + 1; c++) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        if (board[r][c]) destroyed++;
        board[r][c] = 0;
        flashCells.push([r, c]);
      }
    }
    score += destroyed * POWERUP_SCORE.bombPerCell;
  } else if (type === 'lightning') {
    let destroyed = 0;
    for (let c = 0; c < COLS; c++) {
      if (board[y][c]) destroyed++;
      board[y][c] = 0;
      flashCells.push([y, c]);
    }
    for (let r = 0; r < ROWS; r++) {
      if (r === y) continue;
      if (board[r][x]) destroyed++;
      board[r][x] = 0;
      flashCells.push([r, x]);
    }
    score += destroyed * POWERUP_SCORE.lightningPerCell;
  } else if (type === 'tint') {
    const counts = new Array(WILDCARD_INDEX).fill(0);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const v = board[r][c];
        if (v >= 1 && v < WILDCARD_INDEX) counts[v]++;
      }
    let best = 0;
    for (let i = 1; i < WILDCARD_INDEX; i++) if (counts[i] > counts[best]) best = i;
    if (best) {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (board[r][c] === best) {
            board[r][c] = WILDCARD_INDEX;
            flashCells.push([r, c]);
          }
      score += POWERUP_SCORE.tintFlat;
    }
    applyClear(clearLines(), { combo: false });
  } else if (type === 'gravity') {
    for (let c = 0; c < COLS; c++) {
      const colVals = [];
      for (let r = 0; r < ROWS; r++) if (board[r][c]) colVals.push(board[r][c]);
      for (let r = 0; r < ROWS; r++) board[r][c] = 0;
      for (let i = 0; i < colVals.length; i++) board[ROWS - 1 - i][c] = colVals[colVals.length - 1 - i];
    }
    score += POWERUP_SCORE.gravityFlat;
    applyClear(clearLines(), { combo: false });
  } else if (type === 'freeze') {
    freezeRemaining = FREEZE_DURATION;
  }
  if (flashCells.length) activeFlashes.push({ cells: flashCells, elapsed: 0 });
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  if (gy !== current.y) lastActionWasRotation = false;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastActionWasRotation = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.isPowerup) {
    triggerPowerup(current.powerupType, current.x, current.y);
  } else {
    const tspin = isTSpin();
    merge();
    applyClear(clearLines(), { combo: true, tspin });
  }
  lastActionWasRotation = false;
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  updatePowerupHUD();
  updateComboHUD();
}

function updateComboHUD() {
  const parts = [];
  if (comboCount >= 2) parts.push(`x${Math.min(comboCount, COMBO_CAP)}`);
  if (b2bCount > 0) parts.push('B2B');
  comboStatusEl.textContent = parts.length ? parts.join(' ') : '-';
  comboStatusEl.classList.toggle('active', parts.length > 0);
}

function updatePowerupHUD() {
  canvas.classList.toggle('frozen', freezeRemaining > 0);
  if (freezeRemaining > 0) {
    powerupStatusEl.textContent = `❄ ${Math.ceil(freezeRemaining / 1000)}s`;
  } else if (next && next.isPowerup) {
    const meta = POWERUP_META[next.powerupType];
    powerupStatusEl.textContent = `${meta.glyph} ${meta.name}`;
  } else {
    powerupStatusEl.textContent = '-';
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = currentTheme.highlightColor;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  if (colorIndex === WILDCARD_INDEX) {
    context.strokeStyle = 'rgba(0,0,0,0.35)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x * size + 4, y * size + size - 4);
    context.lineTo(x * size + size - 4, y * size + 4);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawPowerupBlock(context, x, y, powerupType, size, alpha) {
  const meta = POWERUP_META[powerupType];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = meta.color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.fillStyle = currentTheme.highlightColor;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.fillStyle = '#000';
  context.font = `${Math.floor(size * 0.6)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(meta.glyph, x * size + size / 2, y * size + size / 2 + 1);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = currentTheme.gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (shakeRemaining > 0) {
    const mag = (shakeRemaining / SHAKE_DURATION) * 5;
    ctx.translate((Math.random() - 0.5) * 2 * mag, (Math.random() - 0.5) * 2 * mag);
  }
  drawScene();
  ctx.restore();
  drawToasts();
}

// Los toasts se pintan fuera del shake para que el texto siga legible.
function drawToasts() {
  if (!activeToasts.length) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = canvas.width / 2;
  activeToasts.forEach((toast, i) => {
    const t = toast.elapsed / toast.duration;
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.fillStyle = toast.color;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(toast.text, cx, canvas.height / 2 - i * 30 - t * 40);
  });
  ctx.globalAlpha = 1;
}

function drawScene() {
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // flash overlay (efectos de power-ups)
  for (const flash of activeFlashes) {
    ctx.globalAlpha = Math.max(0, 1 - flash.elapsed / FLASH_DURATION);
    ctx.fillStyle = '#ffffff';
    for (const [r, c] of flash.cells) ctx.fillRect(c * BLOCK + 1, r * BLOCK + 1, BLOCK - 2, BLOCK - 2);
  }
  ctx.globalAlpha = 1;

  if (gameOver) return;

  // ghost
  const gy = ghostY();
  if (current.isPowerup) {
    drawPowerupBlock(ctx, current.x, gy, current.powerupType, BLOCK, 0.2);
    drawPowerupBlock(ctx, current.x, current.y, current.powerupType, BLOCK);
    return;
  }
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  if (next.isPowerup) {
    drawPowerupBlock(nextCtx, offX, offY, next.powerupType, NB);
    return;
  }
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  animId = null;
  draw();
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver || paused) { animId = null; return; }
  const dt = ts - lastTime;
  lastTime = ts;

  for (let i = activeFlashes.length - 1; i >= 0; i--) {
    activeFlashes[i].elapsed += dt;
    if (activeFlashes[i].elapsed >= FLASH_DURATION) activeFlashes.splice(i, 1);
  }

  for (let i = activeToasts.length - 1; i >= 0; i--) {
    activeToasts[i].elapsed += dt;
    if (activeToasts[i].elapsed >= activeToasts[i].duration) activeToasts.splice(i, 1);
  }

  if (shakeRemaining > 0) shakeRemaining = Math.max(0, shakeRemaining - dt);

  if (freezeRemaining > 0) {
    freezeRemaining = Math.max(0, freezeRemaining - dt);
    updatePowerupHUD();
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
        lastActionWasRotation = false;
      } else {
        lockPiece();
      }
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  linesSincePowerup = 0;
  activeFlashes = [];
  freezeRemaining = 0;
  comboCount = 0;
  b2bCount = 0;
  lastClearWasDifficult = false;
  lastActionWasRotation = false;
  activeToasts = [];
  shakeRemaining = 0;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  initAudio(); // los navegadores exigen un gesto del usuario
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; lastActionWasRotation = false; }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; lastActionWasRotation = false; }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function applyTheme(isLight) {
  document.body.classList.toggle('light', isLight);
  currentTheme = isLight ? THEME.light : THEME.dark;
  localStorage.setItem('tetris-theme', isLight ? 'light' : 'dark');
  if (current) draw();
  if (next) drawNext();
}

function initTheme() {
  const isLight = localStorage.getItem('tetris-theme') === 'light';
  themeSwitch.checked = isLight;
  applyTheme(isLight);
}

themeSwitch.addEventListener('change', () => applyTheme(themeSwitch.checked));

function applyMute(isMuted) {
  muted = isMuted;
  localStorage.setItem('tetris-muted', isMuted ? '1' : '0');
}

function initMute() {
  const isMuted = localStorage.getItem('tetris-muted') === '1';
  muteSwitch.checked = isMuted;
  applyMute(isMuted);
}

muteSwitch.addEventListener('change', () => {
  initAudio();
  applyMute(muteSwitch.checked);
});

initTheme();
initMute();
init();
