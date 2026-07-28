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

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let linesSincePowerup, activeFlashes, freezeRemaining;

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
      return;
    }
  }
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
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    linesSincePowerup += cleared;
    if (linesSincePowerup >= LINES_PER_POWERUP && next && !next.isPowerup) {
      linesSincePowerup -= LINES_PER_POWERUP;
      const powerupType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
      next = createPowerupPiece(powerupType);
      drawNext();
    }
    updateHUD();
  }
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
    clearLines();
  } else if (type === 'gravity') {
    for (let c = 0; c < COLS; c++) {
      const colVals = [];
      for (let r = 0; r < ROWS; r++) if (board[r][c]) colVals.push(board[r][c]);
      for (let r = 0; r < ROWS; r++) board[r][c] = 0;
      for (let i = 0; i < colVals.length; i++) board[ROWS - 1 - i][c] = colVals[colVals.length - 1 - i];
    }
    score += POWERUP_SCORE.gravityFlat;
    clearLines();
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
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
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
    merge();
    clearLines();
  }
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

  if (freezeRemaining > 0) {
    freezeRemaining = Math.max(0, freezeRemaining - dt);
    updatePowerupHUD();
  } else {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
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
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
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

initTheme();
init();
