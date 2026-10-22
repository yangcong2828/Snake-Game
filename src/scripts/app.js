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
    maze: '避开障碍，每升一级新增障碍',
  };

  // 两位玩家：各记各的分，主题跟着人走
  const PLAYERS = [
    { id: 'jing', name: '景', theme: 'scifi' },
    { id: 'na', name: '娜', theme: 'sweet' },
  ];
  const PLAYER_BY_ID = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const THEMES = window.SnakeThemes;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ================= DOM =================
  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#board');
  const ctx = canvas.getContext('2d');
  const app = $('#app');
  const overlay = $('#overlay');
  const toastEl = $('#toast');
  const pauseBtn = $('#pauseBtn');
  const soundBtn = $('#soundBtn');
  const hud = { score: $('#hudScore') };
  buildPlayers();

  // ================= 本地存储 =================
  const STORAGE_KEY = 'snake-game:v1';
  const store = loadStore();

  function loadStore() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      const best = {};
      Object.entries(data.best || {}).forEach(([k, v]) => {
        // 旧版纪录没有玩家维度，归到第一位玩家名下
        const full = k.split('.').length === 2 ? `${PLAYERS[0].id}.${k}` : k;
        best[full] = Math.max(best[full] || 0, v);
      });
      return { best, settings: data.settings || {} };
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
    player: PLAYER_BY_ID[store.settings.player] ? store.settings.player : PLAYERS[0].id,
    // 每人一套主题，按 T 换的是当前玩家自己的
    themes: Object.fromEntries(PLAYERS.map((p) => {
      const saved = (store.settings.themes || {})[p.id];
      return [p.id, THEMES.byId[saved] ? saved : p.theme];
    })),
    muted: !!store.settings.muted,
  };

  function saveSettings() {
    store.settings = { ...settings };
    saveStore();
  }

  const bestKey = (player = settings.player) => `${player}.${settings.mode}.${settings.difficulty}`;
  const getBest = (player) => store.best[bestKey(player)] || 0;
  const theme = () => THEMES.byId[settings.themes[settings.player]];

  // ================= 音效（WebAudio 合成，无需音频文件）=================
  const Sound = (() => {
    let ac = null;
    let noiseBuffer = null;

    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }

    function envelope(c, t0, dur, vol) {
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      gain.connect(c.destination);
      return gain;
    }

    function tone(freq, dur, { type = 'sine', vol = 0.12, to = 0, delay = 0 } = {}) {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      osc.connect(envelope(c, t0, dur, vol));
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function arp(notes, gap, { dur = 0.14, delay = 0, ...opts } = {}) {
      notes.forEach((f, i) => tone(f, dur, { ...opts, delay: delay + i * gap }));
    }

    // 白噪声经低通扫频，用于爆炸声
    function noise(dur, { vol = 0.3, from = 2000, to = 80, delay = 0 } = {}) {
      const c = ensure();
      if (!c) return;
      if (!noiseBuffer) {
        noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const t0 = c.currentTime + delay;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(from, t0);
      filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      src.connect(filter).connect(envelope(c, t0, dur, vol));
      src.start(t0);
      src.stop(t0 + dur + 0.03);
    }

    const api = { tone, arp, noise };

    return {
      unlock: ensure,
      play(name) {
        if (settings.muted) return;
        const fn = theme().sounds[name];
        if (fn) fn(api);
      },
    };
  })();

  // ================= 游戏状态 =================
  let state;
  let roundToken = 0;            // 防止旧局的延时回调影响新局
  const particles = [];
  const floats = [];
  const rings = [];
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
      showScore(points, at, 'food');
      burst(at, 'eat', 14);
      ring(at, theme().colors.float.food, 1.2);
      Sound.play('eat');
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
      showScore(points, at, 'bonus');
      burst(at, 'bonus', 24);
      ring(at, theme().colors.float.bonus, 2);
      Sound.play('bonus');
    });
  }

  function levelUp() {
    Sound.play('level');
    const maze = settings.mode === 'maze';
    if (maze) {
      const head = state.snake[0];
      // 新障碍远离蛇头，避免“出生即撞”
      const rock = randomFreeCell((x, y) => Math.abs(x - head.x) + Math.abs(y - head.y) >= 5);
      if (rock) {
        state.walls.add(key(rock));
        burst(rock, 'rock', 10);
      }
    }
    toast(theme().text.level(state.level, maze));
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

  function showScore(points, at, kind) {
    // 靠边时向内收，避免飘字被裁掉
    floats.push({
      x: Math.min(COLS - 1, Math.max(1, at.x + 0.5)),
      y: Math.max(0.8, at.y + 0.2),
      text: `+${points}`,
      kind,
      life: 0,
      max: 900,
    });
    bump(hud.score);
  }

  function queueDir(name) {
    if (!isActive()) return;
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
    if (!reducedMotion) shake = theme().shake;
    flash = 1;
    burst(state.snake[0], 'death', 28);
    ring(state.snake[0], theme().colors.deathRing || 'rgba(255, 170, 60, 0.9)', 4);
    Sound.play('die');
    finishRound(false);
  }

  function win() {
    flushTimers();
    state.phase = 'over';
    state.won = true;
    state.prev = state.snake.slice();
    Sound.play('win');
    finishRound(true);
  }

  function finishRound(won) {
    const best = getBest();
    const isRecord = state.score > best;
    if (isRecord) {
      store.best[bestKey()] = state.score;
      saveStore();
    }
    $('#overTitle').textContent = won ? theme().text.win : theme().text.over;
    $('#overRecord').hidden = !isRecord;
    $('#overScore').textContent = 0;
    $('#overGap').innerHTML = gapText(best, isRecord);
    updateHud();
    updatePauseButton();

    const token = ++roundToken;
    setTimeout(() => {
      if (token !== roundToken) return;
      showScreen('over');
      countUp($('#overScore'), state.score, token);
    }, won ? 400 : 800);
  }

  // 差距感：先和对方的纪录比，对方还没纪录时和自己比
  function gapText(myBest, isRecord) {
    const s = state.score;
    const n = (v) => `<strong>${v}</strong>`;
    const rival = PLAYERS.find((p) => p.id !== settings.player);
    const rivalBest = rival ? getBest(rival.id) : 0;
    if (rivalBest > 0) {
      if (s > rivalBest) return `超过${rival.name}的纪录 ${n(s - rivalBest)} 分`;
      if (s === rivalBest) return `和${rival.name}打平了`;
      return `距离${rival.name}的纪录还差 ${n(rivalBest - s)} 分`;
    }
    if (myBest > 0) return isRecord ? `比旧纪录多 ${n(s - myBest)} 分` : `距最高分还差 ${n(myBest - s)} 分`;
    return '';
  }

  // ================= 流程控制 =================
  function clearEffects() {
    particles.length = 0;
    floats.length = 0;
    rings.length = 0;
    shake = 0;
    flash = 0;
  }

  function startGame() {
    Sound.unlock();
    roundToken++;
    newState();
    clearEffects();
    showScreen('');
    beginCountdown();
    updateHud();
  }

  const isActive = () => state.phase === 'playing' || state.phase === 'countdown';

  function beginCountdown() {
    state.phase = 'countdown';
    state.countdown = COUNTDOWN;
    Sound.play('tick');
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

  // 游戏中重开需要确认两次，键盘与工具栏按钮一致
  let restartArmedAt = -Infinity;
  function requestRestart(fromButton) {
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
      toast(fromButton ? '再点一次重新开始' : '再按一次 R 重新开始');
    }
  }

  function toMenu() {
    roundToken++;
    newState();
    clearEffects();
    showScreen('menu');
    updateHud();
    updatePauseButton();
  }

  function toggleSound() {
    settings.muted = !settings.muted;
    saveSettings();
    updateSoundButton();
    Sound.play('click');
  }

  // ================= 主题 =================
  function applyTheme() {
    const t = theme();
    document.documentElement.dataset.theme = t.id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t.themeColor;
    $('#brandSub').textContent = t.text.sub;
    $('#menuTitle').textContent = t.text.menuTitle;
    $('#startBtn').textContent = t.text.start;
    $('#pausedTitle').textContent = t.text.paused;
    $('#overRecord').textContent = t.text.record;
    if (state && state.phase === 'over') {
      $('#overTitle').textContent = state.won ? t.text.win : t.text.over;
    }
    buildBackground();
  }

  function setTheme(id) {
    if (!THEMES.byId[id] || id === settings.themes[settings.player]) return;
    settings.themes[settings.player] = id;
    saveSettings();
    applyTheme();
    syncMenu();
    Sound.play('click');
  }

  // ================= 玩家 =================
  function buildPlayers() {
    $('#players').innerHTML = PLAYERS.map((p) => `
      <label class="player">
        <input type="radio" name="player" value="${p.id}">
        <span class="player-card">
          <span class="avatar" data-avatar="${p.id}">${p.name}<i class="crown" data-crown="${p.id}" hidden>👑</i></span>
          <span class="player-info"><span class="player-label">最高</span><b data-best="${p.id}">0</b></span>
        </span>
      </label>`).join('');
    $('#hudMeta').innerHTML = PLAYERS.map((p) =>
      `<div data-player="${p.id}"><dt>${p.name}</dt><dd data-hud-best="${p.id}">0</dd></div>`).join('');
  }

  function setPlayer(id) {
    if (!PLAYER_BY_ID[id] || id === settings.player) return;
    settings.player = id;
    saveSettings();
    applyTheme();
    syncMenu();
    updateHud();
    Sound.play('click');
  }

  // ================= 界面 =================
  function showScreen(name) {
    overlay.dataset.screen = name;
    app.dataset.screen = name || 'playing';
    if (name) {
      // 让 Enter/空格直接作用于主按钮（程序聚焦不画焦点框）
      const primary = overlay.querySelector(`[data-panel="${name}"] .btn-primary`);
      requestAnimationFrame(() => primary && primary.focus({ preventScroll: true, focusVisible: false }));
    } else if (document.activeElement && overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function updateHud() {
    hud.score.textContent = state.score;
    const bests = PLAYERS.map((p) => getBest(p.id));
    const top = Math.max(...bests);
    PLAYERS.forEach((p, i) => {
      // 自己这一行实时显示，超过纪录的那一刻就能看到
      const live = p.id === settings.player && state.phase !== 'menu' ? Math.max(bests[i], state.score) : bests[i];
      $(`[data-hud-best="${p.id}"]`).textContent = live;
      $(`[data-best="${p.id}"]`).textContent = bests[i];
      $(`[data-crown="${p.id}"]`).hidden = !(top > 0 && bests[i] === top && bests.filter((b) => b === top).length === 1);
    });
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

  // 结算分数从 0 滚动到最终值
  function countUp(el, to, token) {
    if (reducedMotion || to <= 0) {
      el.textContent = to;
      return;
    }
    const start = performance.now();
    const dur = Math.min(900, 300 + to * 2);
    const tick = (now) => {
      if (token !== roundToken) return;
      const p = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function syncMenu() {
    document.querySelectorAll('input[name="difficulty"]').forEach((el) => {
      el.checked = el.value === settings.difficulty;
    });
    document.querySelectorAll('input[name="mode"]').forEach((el) => {
      el.checked = el.value === settings.mode;
    });
    $('#modeHint').textContent = MODE_HINTS[settings.mode];
    const label = (name) => $(`input[name="${name}"][value="${settings[name]}"] + span`).textContent;
    $('#comboLabel').textContent = `${label('difficulty')} · ${label('mode')}`;
    PLAYERS.forEach((p) => {
      $(`input[name="player"][value="${p.id}"]`).checked = p.id === settings.player;
      $(`[data-avatar="${p.id}"]`).dataset.theme = settings.themes[p.id];
      $(`[data-player="${p.id}"]`).classList.toggle('is-me', p.id === settings.player);
    });
  }

  // ================= 菜单演示 =================
  // 菜单背后自己游走的蛇：只是画面，不计分、不出声
  const DEMO_MAX = 16;

  function moveCell(p, d) {
    let x = p.x + d.x;
    let y = p.y + d.y;
    if (settings.mode === 'wrap') {
      x = (x + COLS) % COLS;
      y = (y + ROWS) % ROWS;
    } else if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
      return null;
    }
    return { x, y };
  }

  // 从 start 出发能走到的格子数，用来避免钻进死胡同
  function reachable(start, blocked) {
    const seen = new Set([key(start)]);
    const stack = [start];
    while (stack.length) {
      const p = stack.pop();
      for (const d of Object.values(DIRS)) {
        const n = moveCell(p, d);
        if (!n || blocked.has(key(n)) || seen.has(key(n))) continue;
        seen.add(key(n));
        stack.push(n);
      }
    }
    return seen.size;
  }

  // 广度优先找食物的第一步
  function pathStep(head, blocked) {
    if (!state.food) return null;
    const from = new Map([[key(head), null]]);
    const queue = [head];
    while (queue.length) {
      const p = queue.shift();
      if (same(p, state.food)) {
        let k = key(p);
        while (from.get(k) && from.get(k).prev !== key(head)) k = from.get(k).prev;
        return from.get(k) && from.get(k).dir;
      }
      for (const d of Object.values(DIRS)) {
        const n = moveCell(p, d);
        if (!n || blocked.has(key(n)) || from.has(key(n))) continue;
        from.set(key(n), { prev: key(p), dir: d });
        queue.push(n);
      }
    }
    return null;
  }

  function demoStep() {
    const head = state.snake[0];
    const blocked = new Set(state.walls);
    state.snake.slice(0, -1).forEach((p) => blocked.add(key(p)));
    const options = Object.values(DIRS)
      .filter((d) => !(d.x === -state.dir.x && d.y === -state.dir.y))
      .map((d) => ({ d, cell: moveCell(head, d) }))
      .filter((o) => o.cell && !blocked.has(key(o.cell)))
      .map((o) => ({ ...o, room: reachable(o.cell, blocked) }));
    if (!options.length) {
      newState();
      return;
    }
    const best = pathStep(head, blocked);
    const safe = options.find((o) => o.d === best && o.room >= state.snake.length);
    const pick = safe || options.sort((a, b) => b.room - a.room)[0];

    state.dir = pick.d;
    state.prev = state.snake.slice();
    state.snake.unshift(pick.cell);
    if (same(pick.cell, state.food)) {
      burst(pick.cell, 'eat', 10);
      if (state.snake.length > DEMO_MAX) state.snake.pop();
      state.food = null;
      state.food = spawnItem();
      if (!state.food) newState();
    } else {
      state.snake.pop();
    }
  }

  // ================= 特效 =================
  function burst(cell, kind, count) {
    const t = theme();
    const colors = t.colors.particles[kind];
    const shapes = t.particleShapes;
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
        shape: shapes[i % shapes.length],
        life: 0,
        max: 400 + Math.random() * 450,
      });
    }
  }

  // 冲击波圆环（仅星际主题）
  function ring(cell, color, radius) {
    if (!theme().rings) return;
    rings.push({ x: cell.x + 0.5, y: cell.y + 0.5, color, radius, life: 0, max: 450 });
  }

  function updateEffects(dt) {
    const drag = Math.pow(0.9, dt / 16);
    const gravity = theme().gravity;
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
      p.vy = p.vy * drag + (gravity * dt) / 1000;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life += dt;
      f.y -= dt * 0.0012;
      if (f.life >= f.max) floats.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].life += dt;
      if (rings[i].life >= rings[i].max) rings.splice(i, 1);
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

  // 棋盘背景只在尺寸或主题变化时绘制一次
  function buildBackground() {
    if (!size) return;
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    const g = bgCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    theme().buildBackground(g, size, cell);
  }

  function render(now, alpha) {
    if (!size) return;
    const t = theme();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    if (shake) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    ctx.drawImage(bgCanvas, 0, 0, size, size);
    if (t.drawAmbient && !reducedMotion) t.drawAmbient(ctx, size, cell, now);
    state.walls.forEach((k) => t.drawWall(ctx, (k % COLS) * cell, Math.floor(k / COLS) * cell, cell));
    if (state.food) t.drawFood(ctx, ...center(state.food), cell, spawnScale(state.food, now), now);
    if (state.bonus) drawBonus(state.bonus, now, spawnScale(state.bonus, now));
    drawSwallow(now);
    drawSnake(alpha, now);
    drawRings();
    drawParticles();
    drawFloats();
    ctx.restore();
    if (state.phase === 'countdown') drawCountdown();
    if (flash > 0) {
      ctx.fillStyle = `rgba(${t.colors.flash}, ${flash * 0.22})`;
      ctx.fillRect(0, 0, size, size);
    }
  }

  const center = (p) => [(p.x + 0.5) * cell, (p.y + 0.5) * cell];
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
    if (sw.bonus) theme().drawBonus(ctx, ...center(sw), cell, scale, now);
    else theme().drawFood(ctx, ...center(sw), cell, scale, now);
  }

  function drawBonus(bonus, now, scale) {
    const remain = 1 - (state.elapsed - bonus.born) / BONUS_LIFETIME;
    if (remain < 0.25 && Math.floor(now / 120) % 2) return; // 即将消失时闪烁
    const [cx, cy] = center(bonus);
    theme().drawBonus(ctx, cx, cy, cell, scale, now);

    // 剩余时间圆环
    ctx.strokeStyle = theme().colors.ring;
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, remain));
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

  // 连续身体的线段：头部向前推进 t，尾部向前收缩 t，拐角保持在格子中心
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

  // 分节身体的珠子：每一节各自从上一步位置滑到当前位置
  function snakeBeads(alpha) {
    const s = state.snake;
    const p = state.prev;
    return s.map((cur, i) => lerpWrap(i < p.length ? p[i] : cur, cur, alpha));
  }

  function drawSnake(alpha, now) {
    const { head, segs } = snakeSegments(alpha);
    const beads = snakeBeads(alpha);
    if (state.dead) {
      // 死亡时蛇头向前“撞”进障碍
      const lunge = Math.min(1, (now - state.deathAt) / 90) * 0.3;
      for (const pt of [head, beads[0]]) {
        pt.x += state.dir.x * lunge;
        pt.y += state.dir.y * lunge;
      }
    }
    theme().drawSnake(ctx, {
      segs,
      head,
      beads,
      dir: state.dir,
      dead: state.dead,
      fade: state.dead ? Math.min(1, (now - state.deathAt) / 500) : 0,
      difficulty: settings.difficulty,
      now,
      cell,
      px: (v) => (v + 0.5) * cell,
    });
  }

  function drawRings() {
    rings.forEach((r) => {
      const p = r.life / r.max;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, cell * 0.12 * (1 - p));
      ctx.beginPath();
      ctx.arc(r.x * cell, r.y * cell, cell * r.radius * (0.2 + p), 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  function drawCountdown() {
    const t = theme();
    const unit = COUNTDOWN / 3;
    const n = Math.ceil(state.countdown / unit);
    const p = 1 - (state.countdown - (n - 1) * unit) / unit; // 当前数字的进度 0→1
    ctx.save();
    ctx.globalAlpha = 1 - p * 0.7;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(cell * (4 - p * 1.2))}px ${t.font}`;
    if (t.colors.countdownOutline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = cell * 0.5;
      ctx.strokeStyle = t.colors.countdownOutline;
      ctx.strokeText(String(n), size / 2, size / 2);
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 20;
    }
    ctx.fillStyle = t.colors.countdown;
    ctx.fillText(String(n), size / 2, size / 2);
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = 1 - p.life / p.max;
      THEMES.drawParticle(ctx, p, cell);
    });
    ctx.globalAlpha = 1;
  }

  function drawFloats() {
    const t = theme();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `800 ${Math.round(cell * 0.6)}px ${t.font}`;
    floats.forEach((f) => {
      ctx.globalAlpha = 1 - Math.pow(f.life / f.max, 2);
      if (t.colors.floatOutline) {
        ctx.strokeStyle = t.colors.floatOutline;
        ctx.lineWidth = cell * 0.18;
        ctx.strokeText(f.text, f.x * cell, f.y * cell);
      }
      ctx.fillStyle = t.colors.float[f.kind];
      ctx.fillText(f.text, f.x * cell, f.y * cell);
    });
    ctx.globalAlpha = 1;
  }

  // ================= 主循环 =================
  let lastTime = performance.now();

  function frame(now) {
    const dt = Math.min(now - lastTime, 100);
    lastTime = now;

    if (state.phase === 'menu' && !reducedMotion) {
      state.acc += dt;
      while (state.acc >= state.interval && state.phase === 'menu') {
        state.acc -= state.interval;
        demoStep();
      }
    }

    if (state.phase === 'countdown') {
      const before = Math.ceil(state.countdown / (COUNTDOWN / 3));
      state.countdown -= dt;
      const after = Math.ceil(state.countdown / (COUNTDOWN / 3));
      if (state.countdown <= 0) {
        state.phase = 'playing';
        Sound.play('start');
      } else if (after !== before) {
        Sound.play('tick');
      }
    }

    if (state.phase === 'playing') {
      state.acc += dt;
      state.elapsed += dt;
      runTimers();
      while (state.acc >= state.interval && state.phase === 'playing') {
        state.acc -= state.interval;
        step();
      }
      if (state.bonus && state.elapsed - state.bonus.born > BONUS_LIFETIME) {
        burst(state.bonus, 'expire', 8);
        state.bonus = null;
      }
    }

    updateEffects(dt);
    const moving = state.phase !== 'over' && !(state.phase === 'menu' && reducedMotion);
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
      case 'KeyT': {
        // 循环切换主题
        const ids = THEMES.list.map((t) => t.id);
        setTheme(ids[(ids.indexOf(settings.themes[settings.player]) + 1) % ids.length]);
        break;
      }
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
    restart: () => requestRestart(true),
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
      Sound.play('click');
    });
  });

  document.querySelectorAll('input[name="player"]').forEach((input) => {
    input.addEventListener('change', () => setPlayer(input.value));
  });

  // 切到后台自动暂停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  // ================= 启动 =================
  newState();
  applyTheme();
  syncMenu();
  updateHud();
  updatePauseButton();
  updateSoundButton();

  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
