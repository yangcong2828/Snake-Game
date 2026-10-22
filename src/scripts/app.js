'use strict';

(() => {
  // ================= 配置 =================
  const COLS = 20;
  const ROWS = 20;
  const FOODS_PER_LEVEL = 5;     // 每吃 5 个食物升一级
  const BONUS_LIFETIME = 6000;   // 金色奖励存在时间（毫秒，游戏时间）
  const MAX_QUEUE = 3;           // 方向输入缓冲，快速连按不丢键
  const COUNTDOWN = 1500;        // 开局/继续前的 3-2-1 倒计时
  const RESTART_CONFIRM = 1500;  // 游戏中连按两次 R 才重开

  // start/min：每步间隔（毫秒），step：每吃一个食物加速多少，mult：得分倍率
  const DIFFICULTIES = {
    easy:   { start: 170, min: 105, step: 3,   mult: 1 },
    normal: { start: 140, min: 80,  step: 2.5, mult: 2 },
    hard:   { start: 110, min: 62,  step: 2,   mult: 3 },
  };

  const MODE_HINTS = {
    classic: '撞墙或撞到自己即结束',
    wrap: '穿越边界，从另一侧出现',
    maze: '避开障碍，每升一级新增岩石',
  };

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const COLORS = {
    boardA: '#0f151c',
    boardB: '#121a22',
    head: '#8af7c6',
    tail: '#159069',
    deadHead: '#9aa5b1',
    deadTail: '#3d4853',
    food: '#ff6b6b',
    foodDark: '#d93f55',
    leaf: '#5ad17a',
    gold: '#ffd166',
    goldDark: '#f0a020',
    wall: '#263241',
    wallTop: '#33445a',
    eye: '#0b0f14',
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ================= DOM =================
  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#board');
  const ctx = canvas.getContext('2d');
  const overlay = $('#overlay');
  const toastEl = $('#toast');
  const pauseBtn = $('#pauseBtn');
  const soundBtn = $('#soundBtn');
  const hud = {
    score: $('#hudScore'),
    best: $('#hudBest'),
    level: $('#hudLevel'),
    length: $('#hudLength'),
  };

  // ================= 本地存储 =================
  const STORAGE_KEY = 'snake-game:v1';
  const store = loadStore();

  function loadStore() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      return { best: data.best || {}, settings: data.settings || {} };
    } catch {
      return { best: {}, settings: {} };
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // 隐私模式等情况下无法保存，忽略即可
    }
  }

  const settings = {
    difficulty: DIFFICULTIES[store.settings.difficulty] ? store.settings.difficulty : 'normal',
    mode: MODE_HINTS[store.settings.mode] ? store.settings.mode : 'classic',
    muted: !!store.settings.muted,
  };

  function saveSettings() {
    store.settings = { ...settings };
    saveStore();
  }

  const bestKey = () => `${settings.mode}.${settings.difficulty}`;
  const getBest = () => store.best[bestKey()] || 0;

  // ================= 音效（WebAudio 合成，无需音频文件）=================
  const Sound = (() => {
    let ac = null;

    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }

    function tone(freq, dur, { type = 'sine', vol = 0.12, to = 0, delay = 0 } = {}) {
      if (settings.muted) return;
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    const arpeggio = (notes, gap, opts) =>
      notes.forEach((f, i) => tone(f, 0.14, { ...opts, delay: i * gap }));

    return {
      unlock: ensure,
      start: () => arpeggio([392, 523, 659], 0.07, { type: 'triangle' }),
      eat: () => tone(520, 0.1, { type: 'triangle', to: 900 }),
      bonus: () => arpeggio([784, 988, 1319, 1568], 0.05, { type: 'square', vol: 0.06 }),
      level: () => arpeggio([523, 659, 784, 1047], 0.08, { type: 'triangle' }),
      die: () => {
        tone(320, 0.55, { type: 'sawtooth', to: 55, vol: 0.09 });
        tone(160, 0.4, { type: 'square', to: 40, vol: 0.05, delay: 0.05 });
      },
      win: () => arpeggio([523, 659, 784, 1047, 1319, 1568], 0.09, { type: 'triangle' }),
      click: () => tone(660, 0.05, { type: 'triangle', vol: 0.05 }),
      tick: () => tone(440, 0.08, { type: 'triangle', vol: 0.08 }),
    };
  })();

  // ================= 游戏状态 =================
  let state;
  let roundToken = 0;            // 防止旧局的延时回调影响新局
  const particles = [];
  const floats = [];
  let shake = 0;
  let flash = 0;

  const key = (p) => p.y * COLS + p.x;
  const same = (a, b) => a && b && a.x === b.x && a.y === b.y;

  function newState() {
    const cy = Math.floor(ROWS / 2);
    const snake = [{ x: 6, y: cy }, { x: 5, y: cy }, { x: 4, y: cy }];
    const s = {
      phase: 'menu',             // menu | countdown | playing | paused | over
      snake,
      prev: snake.slice(),       // 上一步的蛇，用于平滑插值
      dir: DIRS.right,
      queue: [],
      walls: new Set(settings.mode === 'maze' ? mazeLayout() : []),
      food: null,
      bonus: null,
      score: 0,
      foods: 0,
      level: 1,
      interval: DIFFICULTIES[settings.difficulty].start,
      acc: 0,
      elapsed: 0,                // 游戏时间（毫秒），驱动定时器与奖励倒计时
      playTime: 0,
      countdown: 0,
      grace: false,              // 即将撞上时多给一拍转向机会
      timers: [],                // 按游戏时间延后执行的回调（暂停时冻结）
      swallow: null,             // 正在被吞下的食物，用于收缩动画
      dead: false,
      deathAt: 0,
      won: false,
    };
    state = s;
    s.food = spawnItem();
    return s;
  }

  // 四角对称的“括号”形障碍，中轴线保持畅通
  function mazeLayout() {
    const cells = [];
    const bracket = (x0, y0, sx, sy) => {
      for (let i = 0; i < 5; i++) cells.push(key({ x: x0 + i * sx, y: y0 }));
      for (let i = 1; i < 5; i++) cells.push(key({ x: x0, y: y0 + i * sy }));
    };
    bracket(3, 3, 1, 1);
    bracket(COLS - 4, 3, -1, 1);
    bracket(3, ROWS - 4, 1, -1);
    bracket(COLS - 4, ROWS - 4, -1, -1);
    return cells;
  }

  function randomFreeCell(filter) {
    const taken = new Set(state.walls);
    state.snake.forEach((p) => taken.add(key(p)));
    if (state.food) taken.add(key(state.food));
    if (state.bonus) taken.add(key(state.bonus));
    const free = [];
    for (let k = 0; k < COLS * ROWS; k++) {
      const x = k % COLS;
      const y = Math.floor(k / COLS);
      if (!taken.has(k) && (!filter || filter(x, y))) free.push(k);
    }
    if (!free.length) return null;
    const k = free[Math.floor(Math.random() * free.length)];
    return { x: k % COLS, y: Math.floor(k / COLS) };
  }

  function spawnItem(filter) {
    const cell = randomFreeCell(filter);
    if (cell) cell.bornAt = performance.now();
    return cell;
  }

  // ================= 核心逻辑 =================
  function step() {
    if (state.queue.length) state.dir = state.queue.shift();
    const head = state.snake[0];
    let x = head.x + state.dir.x;
    let y = head.y + state.dir.y;
    if (settings.mode === 'wrap') {
      x = (x + COLS) % COLS;
      y = (y + ROWS) % ROWS;
    }
    const next = { x, y };
    const eatsFood = same(next, state.food);
    const eatsBonus = same(next, state.bonus);

    // 不长身体时尾巴会让出位置，可以紧追尾巴
    const body = eatsFood ? state.snake : state.snake.slice(0, -1);
    const outside = x < 0 || x >= COLS || y < 0 || y >= ROWS;
    if (outside || state.walls.has(key(next)) || body.some((p) => same(p, next))) {
      // 第一次撞上时停顿一拍，玩家还来得及转向；仍不转向才判死
      if (!state.grace) {
        state.grace = true;
        state.prev = state.snake.slice();
        return;
      }
      die();
      return;
    }

    state.grace = false;
    state.prev = state.snake.slice();
    state.snake.unshift(next);
    if (!eatsFood) state.snake.pop();

    if (eatsBonus) eatBonus();
    if (eatsFood) eatFood();
    updateHud();
  }

  function eatFood() {
    const diff = DIFFICULTIES[settings.difficulty];
    const at = state.food;
    state.foods++;
    state.interval = Math.max(diff.min, diff.start - state.foods * diff.step);

    // 逻辑先行一格，画面上蛇头此刻才刚出发，等它“咬到”再播放特效
    const delay = state.interval * 0.85;
    state.swallow = { x: at.x, y: at.y, start: state.elapsed, dur: delay };
    const points = (10 + (state.level - 1) * 2) * diff.mult;
    state.score += points;
    later(delay, () => {
      showScore(points, at, COLORS.food);
      burst(at, [COLORS.food, '#ffb3b3', COLORS.leaf], 14);
      Sound.eat();
    });

    const level = 1 + Math.floor(state.foods / FOODS_PER_LEVEL);
    if (level > state.level) {
      state.level = level;
      later(delay, levelUp);
    }

    state.food = null;
    state.food = spawnItem();
    if (!state.food && state.bonus) {
      state.bonus = null;
      state.food = spawnItem();
    }
    if (!state.food) {
      win();
      return;
    }

    if (!state.bonus && state.foods >= 3 && Math.random() < 0.3) {
      // 生成在 6 秒内追得到的范围里
      const head = state.snake[0];
      const near = (x, y) => {
        const d = gridDistance(head, { x, y });
        return d >= 3 && d <= 12;
      };
      state.bonus = spawnItem(near) || spawnItem();
      if (state.bonus) state.bonus.born = state.elapsed;
    }
  }

  function eatBonus() {
    const at = state.bonus;
    const points = 50 * DIFFICULTIES[settings.difficulty].mult;
    state.score += points;
    state.bonus = null;
    state.swallow = { x: at.x, y: at.y, start: state.elapsed, dur: state.interval * 0.85, bonus: true };
    later(state.interval * 0.85, () => {
      showScore(points, at, COLORS.gold);
      burst(at, [COLORS.gold, '#fff1c2', COLORS.goldDark], 24);
      Sound.bonus();
    });
  }

  function levelUp() {
    Sound.level();
    if (settings.mode === 'maze') {
      const head = state.snake[0];
      // 新岩石远离蛇头，避免“出生即撞”
      const rock = randomFreeCell((x, y) => Math.abs(x - head.x) + Math.abs(y - head.y) >= 5);
      if (rock) {
        state.walls.add(key(rock));
        burst(rock, ['#5b6f86', '#8ea3ba'], 10);
      }
      toast(`LEVEL ${state.level} · 新增障碍`);
    } else {
      toast(`LEVEL ${state.level} · 速度提升`);
    }
  }

  function later(ms, fn) {
    state.timers.push({ at: state.elapsed + ms, fn });
  }

  function runTimers() {
    const due = state.timers.filter((t) => state.elapsed >= t.at);
    if (!due.length) return;
    state.timers = state.timers.filter((t) => state.elapsed < t.at);
    due.forEach((t) => t.fn());
  }

  // 回合结束时立即播放尚未触发的吃食物特效
  function flushTimers() {
    const pending = state.timers;
    state.timers = [];
    pending.forEach((t) => t.fn());
  }

  function gridDistance(a, b) {
    let dx = Math.abs(a.x - b.x);
    let dy = Math.abs(a.y - b.y);
    if (settings.mode === 'wrap') {
      dx = Math.min(dx, COLS - dx);
      dy = Math.min(dy, ROWS - dy);
    }
    return dx + dy;
  }

  function showScore(points, at, color) {
    // 靠边时向内收，避免飘字被裁掉
    floats.push({ x: Math.min(COLS - 1, Math.max(1, at.x + 0.5)), y: Math.max(0.8, at.y + 0.2), text: `+${points}`, color, life: 0, max: 900 });
    bump(hud.score);
  }

  function queueDir(name) {
    if (state.phase !== 'playing' && state.phase !== 'countdown') return;
    const d = DIRS[name];
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (d === last || (d.x === -last.x && d.y === -last.y)) return;
    if (state.queue.length < MAX_QUEUE) state.queue.push(d);
  }

  function die() {
    flushTimers();
    state.phase = 'over';
    state.dead = true;
    state.deathAt = performance.now();
    state.prev = state.snake.slice();
    if (!reducedMotion) shake = 9;
    flash = 1;
    burst(state.snake[0], [COLORS.food, '#ffffff', COLORS.head], 26);
    Sound.die();
    finishRound(false);
  }

  function win() {
    flushTimers();
    state.phase = 'over';
    state.won = true;
    state.prev = state.snake.slice();
    Sound.win();
    finishRound(true);
  }

  function finishRound(won) {
    const best = getBest();
    const isRecord = state.score > best;
    if (isRecord) {
      store.best[bestKey()] = state.score;
      saveStore();
    }
    $('#overTitle').textContent = won ? '完美通关！' : '游戏结束';
    $('#overRecord').hidden = !isRecord;
    $('#overScore').textContent = state.score;
    $('#overBest').textContent = Math.max(best, state.score);
    $('#overLength').textContent = state.snake.length;
    $('#overLevel').textContent = state.level;
    $('#overTime').textContent = formatTime(state.playTime);
    updatePauseButton();

    const token = ++roundToken;
    setTimeout(() => {
      if (token === roundToken) showScreen('over');
    }, won ? 400 : 800);
  }

  // ================= 流程控制 =================
  function startGame() {
    Sound.unlock();
    roundToken++;
    newState();
    particles.length = 0;
    floats.length = 0;
    shake = 0;
    flash = 0;
    showScreen('');
    beginCountdown();
    updateHud();
  }

  const isActive = () => state.phase === 'playing' || state.phase === 'countdown';

  function beginCountdown() {
    state.phase = 'countdown';
    state.countdown = COUNTDOWN;
    Sound.tick();
    updatePauseButton();
  }

  function pause() {
    if (!isActive()) return;
    state.phase = 'paused';
    showScreen('paused');
    updatePauseButton();
  }

  function resume() {
    if (state.phase !== 'paused') return;
    showScreen('');
    beginCountdown();
  }

  function togglePause() {
    if (isActive()) pause();
    else if (state.phase === 'paused') resume();
  }

  let restartArmedAt = -Infinity;
  function requestRestart() {
    if (!isActive()) {
      startGame();
      return;
    }
    const now = performance.now();
    if (now - restartArmedAt < RESTART_CONFIRM) {
      restartArmedAt = -Infinity;
      startGame();
    } else {
      restartArmedAt = now;
      toast('再按一次 R 重新开始');
    }
  }

  function toMenu() {
    roundToken++;
    newState();
    particles.length = 0;
    floats.length = 0;
    showScreen('menu');
    updateHud();
    updatePauseButton();
  }

  function toggleSound() {
    settings.muted = !settings.muted;
    saveSettings();
    updateSoundButton();
    Sound.click();
  }

  // ================= 界面 =================
  function showScreen(name) {
    overlay.dataset.screen = name;
    if (name) {
      // 让 Enter/空格直接作用于主按钮
      const primary = overlay.querySelector(`[data-panel="${name}"] .btn-primary`);
      requestAnimationFrame(() => primary && primary.focus({ preventScroll: true }));
    } else if (document.activeElement && overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function updateHud() {
    const best = Math.max(getBest(), state.score);
    hud.score.textContent = state.score;
    hud.best.textContent = best;
    hud.level.textContent = state.level;
    hud.length.textContent = state.snake.length;
    $('#menuBest').textContent = getBest();
  }

  function updatePauseButton() {
    const paused = state.phase === 'paused';
    pauseBtn.classList.toggle('is-paused', paused);
    pauseBtn.setAttribute('aria-label', paused ? '继续' : '暂停');
    pauseBtn.disabled = !isActive() && !paused;
  }

  function updateSoundButton() {
    soundBtn.classList.toggle('is-muted', settings.muted);
    soundBtn.setAttribute('aria-pressed', String(!settings.muted));
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  let toastTimer = 0;
  function toast(text) {
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1700);
  }

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function syncMenu() {
    document.querySelectorAll('input[name="difficulty"]').forEach((el) => {
      el.checked = el.value === settings.difficulty;
    });
    document.querySelectorAll('input[name="mode"]').forEach((el) => {
      el.checked = el.value === settings.mode;
    });
    $('#modeHint').textContent = MODE_HINTS[settings.mode];
  }

  // ================= 特效 =================
  function burst(cell, colors, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 7;
      particles.push({
        x: cell.x + 0.5,
        y: cell.y + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 0.06 + Math.random() * 0.12,
        color: colors[i % colors.length],
        life: 0,
        max: 400 + Math.random() * 450,
      });
    }
  }

  function updateEffects(dt) {
    const drag = Math.pow(0.9, dt / 16);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        particles.splice(i, 1);
        continue;
      }
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.vx *= drag;
      p.vy *= drag;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life += dt;
      f.y -= dt * 0.0012;
      if (f.life >= f.max) floats.splice(i, 1);
    }
    shake = shake > 0.2 ? shake * Math.pow(0.86, dt / 16) : 0;
    flash = Math.max(0, flash - dt / 450);
  }

  // ================= 渲染 =================
  let dpr = 1;
  let size = 0;   // 画布 CSS 像素边长
  let cell = 0;   // 每格 CSS 像素
  const bgCanvas = document.createElement('canvas');

  function resize() {
    size = canvas.clientWidth;
    if (!size) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    cell = size / COLS;
    buildBackground();
  }

  // 棋盘背景只在尺寸变化时绘制一次
  function buildBackground() {
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    const g = bgCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COLORS.boardA;
    g.fillRect(0, 0, size, size);
    g.fillStyle = COLORS.boardB;
    for (let y = 0; y < ROWS; y++) {
      for (let x = (y % 2); x < COLS; x += 2) g.fillRect(x * cell, y * cell, cell, cell);
    }
    const vignette = g.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, size, size);
  }

  function render(now, alpha) {
    if (!size) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    if (shake) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    ctx.drawImage(bgCanvas, 0, 0, size, size);
    drawWalls();
    if (state.food) drawFood(state.food, now);
    if (state.bonus) drawBonus(state.bonus, now);
    drawSwallow(now);
    drawSnake(alpha, now);
    drawParticles();
    drawFloats();
    ctx.restore();
    if (state.phase === 'countdown') drawCountdown();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 80, 90, ${flash * 0.22})`;
      ctx.fillRect(0, 0, size, size);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawWalls() {
    const inset = cell * 0.08;
    state.walls.forEach((k) => {
      const x = (k % COLS) * cell + inset;
      const y = Math.floor(k / COLS) * cell + inset;
      const s = cell - inset * 2;
      roundRect(x, y, s, s, cell * 0.2);
      ctx.fillStyle = COLORS.wall;
      ctx.fill();
      roundRect(x + s * 0.12, y + s * 0.1, s * 0.76, s * 0.22, cell * 0.08);
      ctx.fillStyle = COLORS.wallTop;
      ctx.fill();
    });
  }

  const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
  const spawnScale = (item, now) => easeOutBack(Math.min(1, (now - item.bornAt) / 280));

  // 被吃掉的食物在蛇头到达前逐渐缩小
  function drawSwallow(now) {
    const sw = state.swallow;
    if (!sw) return;
    const p = (state.elapsed - sw.start) / sw.dur;
    if (p >= 1 || state.dead) {
      state.swallow = null;
      return;
    }
    const scale = 1 - p * p;
    if (sw.bonus) drawBonus({ ...sw, born: state.elapsed, swallowed: true }, now, scale);
    else drawFood(sw, now, scale);
  }

  function drawFood(food, now, scale = spawnScale(food, now)) {
    const cx = (food.x + 0.5) * cell;
    const cy = (food.y + 0.5) * cell;
    const r = cell * 0.33 * (1 + Math.sin(now / 230) * 0.06) * scale;
    if (r <= 0) return;

    ctx.save();
    ctx.shadowColor = COLORS.food;
    ctx.shadowBlur = cell * 0.7;
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    grad.addColorStop(0, '#ff9a9a');
    grad.addColorStop(1, COLORS.foodDark);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.35, cy - r * 0.38, r * 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.leaf;
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.35, cy - r * 0.95, r * 0.36, r * 0.17, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBonus(bonus, now, scale = spawnScale(bonus, now)) {
    const remain = 1 - (state.elapsed - bonus.born) / BONUS_LIFETIME;
    if (remain < 0.25 && Math.floor(now / 120) % 2) return; // 即将消失时闪烁
    const cx = (bonus.x + 0.5) * cell;
    const cy = (bonus.y + 0.5) * cell;
    const r = cell * 0.4 * scale;
    if (r <= 0) return;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(now / 700);
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = cell * 0.8;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 ? r * 0.46 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, '#fff1c2');
    grad.addColorStop(1, COLORS.goldDark);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    if (bonus.swallowed) return; // 被吞下时不画计时环

    // 剩余时间圆环
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.55)';
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, remain));
    ctx.stroke();
  }

  // 两点间插值；穿墙时按最短方向展开，让蛇头从边缘“钻出来”
  function lerpWrap(a, b, t) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (dx > 1) dx -= COLS;
    if (dx < -1) dx += COLS;
    if (dy > 1) dy -= ROWS;
    if (dy < -1) dy += ROWS;
    return { x: b.x - dx * (1 - t), y: b.y - dy * (1 - t) };
  }

  function unwrapDelta(a, b) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (dx > COLS / 2) dx -= COLS;
    if (dx < -COLS / 2) dx += COLS;
    if (dy > ROWS / 2) dy -= ROWS;
    if (dy < -ROWS / 2) dy += ROWS;
    return { x: dx, y: dy };
  }

  // 生成蛇身线段：头部向前推进 t，尾部向前收缩 t，拐角保持在格子中心
  function snakeSegments(alpha) {
    const s = state.snake;
    const p = state.prev;
    const n = s.length;
    const pts = [lerpWrap(p[0], s[0], alpha)];
    for (let i = 1; i < n; i++) pts.push(s[i]);
    const tailFrom = p.length === n ? p[n - 1] : s[n - 1];
    pts.push(lerpWrap(tailFrom, s[n - 1], alpha));

    const segs = [];
    const total = pts.length - 1;
    for (let i = 0; i < total; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const t = i / Math.max(1, total - 1);
      if (Math.abs(a.x - b.x) > 1.01 || Math.abs(a.y - b.y) > 1.01) {
        // 跨越边界：两侧各画一段伸出画布的“幽灵”线段
        const d = unwrapDelta(a, b);
        segs.push({ a, b: { x: a.x + d.x, y: a.y + d.y }, t });
        segs.push({ a: { x: b.x - d.x, y: b.y - d.y }, b, t });
      } else {
        segs.push({ a, b, t });
      }
    }
    return { head: pts[0], segs };
  }

  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const RGB = {
    head: hexToRgb(COLORS.head),
    tail: hexToRgb(COLORS.tail),
    deadHead: hexToRgb(COLORS.deadHead),
    deadTail: hexToRgb(COLORS.deadTail),
  };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  function drawSnake(alpha, now) {
    const { head, segs } = snakeSegments(alpha);
    if (state.dead) {
      const lunge = Math.min(1, (now - state.deathAt) / 90) * 0.3;
      head.x += state.dir.x * lunge;
      head.y += state.dir.y * lunge;
    }
    const px = (v) => (v + 0.5) * cell;

    // 死亡后逐渐褪色
    const fade = state.dead ? Math.min(1, (now - state.deathAt) / 500) : 0;
    const headColor = mix(RGB.head, RGB.deadHead, fade);
    const tailColor = mix(RGB.tail, RGB.deadTail, fade);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 外发光：两层半透明宽描边，比 shadowBlur 省得多
    if (!state.dead) {
      for (const [width, alphaGlow] of [[1.25, 0.06], [1.0, 0.1]]) {
        ctx.strokeStyle = `rgba(94, 240, 176, ${alphaGlow})`;
        ctx.lineWidth = cell * width;
        ctx.beginPath();
        segs.forEach(({ a, b }) => {
          ctx.moveTo(px(a.x), px(a.y));
          ctx.lineTo(px(b.x), px(b.y));
        });
        ctx.stroke();
      }
    }

    // 渐变身体（从尾到头绘制，头部压在最上层）
    for (let i = segs.length - 1; i >= 0; i--) {
      const { a, b, t } = segs[i];
      ctx.strokeStyle = rgb(mix(headColor, tailColor, t));
      ctx.lineWidth = cell * (t > 0.7 ? 0.76 - ((t - 0.7) / 0.3) * 0.18 : 0.76);
      ctx.beginPath();
      ctx.moveTo(px(a.x), px(a.y));
      ctx.lineTo(px(b.x), px(b.y));
      ctx.stroke();
    }

    // 高光，增加立体感
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = cell * 0.16;
    ctx.beginPath();
    segs.forEach(({ a, b }) => {
      ctx.moveTo(px(a.x) - cell * 0.1, px(a.y) - cell * 0.1);
      ctx.lineTo(px(b.x) - cell * 0.1, px(b.y) - cell * 0.1);
    });
    ctx.stroke();

    drawHead(px(head.x), px(head.y), headColor, now);
  }

  function drawHead(hx, hy, color, now) {
    const d = state.dir;
    const perp = { x: -d.y, y: d.x };

    // 吐信子
    if (!state.dead && now % 2600 < 220) {
      ctx.strokeStyle = COLORS.food;
      ctx.lineWidth = Math.max(1.2, cell * 0.07);
      const bx = hx + d.x * cell * 0.4;
      const by = hy + d.y * cell * 0.4;
      const tx = bx + d.x * cell * 0.25;
      const ty = by + d.y * cell * 0.25;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tx, ty);
      ctx.lineTo(tx + (d.x + perp.x) * cell * 0.1, ty + (d.y + perp.y) * cell * 0.1);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + (d.x - perp.x) * cell * 0.1, ty + (d.y - perp.y) * cell * 0.1);
      ctx.stroke();
    }

    ctx.fillStyle = rgb(color);
    ctx.beginPath();
    ctx.arc(hx, hy, cell * 0.44, 0, Math.PI * 2);
    ctx.fill();

    for (const side of [-1, 1]) {
      const ex = hx + d.x * cell * 0.12 + perp.x * cell * 0.2 * side;
      const ey = hy + d.y * cell * 0.12 + perp.y * cell * 0.2 * side;
      if (state.dead) {
        const k = cell * 0.09;
        ctx.strokeStyle = COLORS.eye;
        ctx.lineWidth = Math.max(1.5, cell * 0.07);
        ctx.beginPath();
        ctx.moveTo(ex - k, ey - k);
        ctx.lineTo(ex + k, ey + k);
        ctx.moveTo(ex + k, ey - k);
        ctx.lineTo(ex - k, ey + k);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex, ey, cell * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.eye;
        ctx.beginPath();
        ctx.arc(ex + d.x * cell * 0.04, ey + d.y * cell * 0.04, cell * 0.065, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCountdown() {
    const unit = COUNTDOWN / 3;
    const n = Math.ceil(state.countdown / unit);
    const p = 1 - (state.countdown - (n - 1) * unit) / unit; // 当前数字的进度 0→1
    ctx.save();
    ctx.globalAlpha = 1 - p * 0.7;
    ctx.fillStyle = '#e6edf3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(cell * (4 - p * 1.2))}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 20;
    ctx.fillText(String(n), size / 2, size / 2);
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * cell, p.y * cell, p.size * cell, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(cell * 0.6)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    floats.forEach((f) => {
      ctx.globalAlpha = 1 - Math.pow(f.life / f.max, 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x * cell, f.y * cell);
    });
    ctx.globalAlpha = 1;
  }

  // ================= 主循环 =================
  let lastTime = performance.now();

  function frame(now) {
    const dt = Math.min(now - lastTime, 100);
    lastTime = now;

    if (state.phase === 'countdown') {
      const before = Math.ceil(state.countdown / (COUNTDOWN / 3));
      state.countdown -= dt;
      const after = Math.ceil(state.countdown / (COUNTDOWN / 3));
      if (state.countdown <= 0) {
        state.phase = 'playing';
        Sound.start();
      } else if (after !== before) {
        Sound.tick();
      }
    }

    if (state.phase === 'playing') {
      state.acc += dt;
      state.elapsed += dt;
      state.playTime += dt;
      runTimers();
      while (state.acc >= state.interval && state.phase === 'playing') {
        state.acc -= state.interval;
        step();
      }
      if (state.bonus && state.elapsed - state.bonus.born > BONUS_LIFETIME) {
        burst(state.bonus, ['#8b98a5', '#5d6b78'], 8);
        state.bonus = null;
      }
    }

    updateEffects(dt);
    const moving = state.phase === 'playing' || state.phase === 'paused' || state.phase === 'countdown';
    render(now, moving ? Math.min(1, state.acc / state.interval) : 1);
    requestAnimationFrame(frame);
  }

  // ================= 输入 =================
  const KEY_DIRS = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
  };

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = KEY_DIRS[e.code];
    if (dir) {
      if (isActive()) {
        e.preventDefault();
        queueDir(dir);
      }
      return;
    }

    // 焦点在按钮/单选框上时，Enter/空格交给浏览器原生处理
    const onControl = e.target instanceof HTMLElement && e.target.matches('button, input');
    const confirmKey = e.code === 'Enter' || e.code === 'Space';
    if (confirmKey && onControl) return;

    switch (e.code) {
      case 'Space':
      case 'KeyP':
      case 'Escape':
        e.preventDefault();
        if (isActive() || state.phase === 'paused') togglePause();
        else if (e.code === 'Space') startGame();
        break;
      case 'Enter':
        if (state.phase === 'menu' || state.phase === 'over') startGame();
        else if (state.phase === 'paused') resume();
        break;
      case 'KeyR':
        requestRestart();
        break;
      case 'KeyM':
        toggleSound();
        break;
    }
  });

  // 触屏滑动（一次手势中可连续转向）
  let swipe = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    queueDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipe.x = e.clientX;
    swipe.y = e.clientY;
  });
  const endSwipe = () => { swipe = null; };
  canvas.addEventListener('pointerup', endSwipe);
  canvas.addEventListener('pointercancel', endSwipe);

  document.querySelectorAll('.dpad-btn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      queueDir(btn.dataset.dir);
    });
  });

  const ACTIONS = {
    start: startGame,
    restart: startGame,
    resume,
    menu: toMenu,
    'toggle-pause': togglePause,
    'toggle-sound': toggleSound,
  };

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = ACTIONS[target.dataset.action];
    if (action) action();
    // 工具栏按钮点完后释放焦点，避免空格键重复触发
    if (target.closest('.toolbar')) target.blur();
  });

  document.querySelectorAll('input[name="difficulty"], input[name="mode"]').forEach((input) => {
    input.addEventListener('change', () => {
      settings[input.name] = input.value;
      saveSettings();
      syncMenu();
      if (state.phase === 'menu') newState();   // 预览新模式的棋盘
      updateHud();
      Sound.click();
    });
  });

  // 切到后台自动暂停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  // ================= 启动 =================
  newState();
  syncMenu();
  updateHud();
  updatePauseButton();
  updateSoundButton();

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
