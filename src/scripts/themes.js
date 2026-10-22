'use strict';

// 主题：配色、文案、音效与各元素的画法。app.js 只负责游戏逻辑与调度。
//
// 每个主题实现：
//   buildBackground(g, size, cell)            静态棋盘（尺寸或主题变化时绘制一次）
//   drawAmbient?(ctx, size, cell, now)        动态背景（可选）
//   drawWall(ctx, x, y, cell)                 障碍，x/y 为格子左上角像素
//   drawFood(ctx, cx, cy, cell, scale, now)   食物
//   drawBonus(ctx, cx, cy, cell, scale, now)  限时奖励
//   drawSnake(ctx, s)                         蛇，s 见 app.js 中 drawSnake()
//   sounds.{start,tick,eat,bonus,level,die,win,click}(audio)
window.SnakeThemes = (() => {
  const TAU = Math.PI * 2;

  // ================= 通用工具 =================
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const mix3 = (a, b, c, t) => (t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2));
  const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, r), 0, TAU);
  }

  function heart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.5, y - s * 0.1, x - s * 0.65, y - s * 1.25, x, y - s * 0.45);
    ctx.bezierCurveTo(x + s * 0.65, y - s * 1.25, x + s * 1.5, y - s * 0.1, x, y + s * 0.9);
    ctx.closePath();
  }

  function star(ctx, x, y, r, inner = 0.46, points = 5, rot = -Math.PI / 2) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = rot + (i * Math.PI) / points;
      const rr = i % 2 ? r * inner : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  function tracePath(ctx, segs, px) {
    ctx.beginPath();
    segs.forEach(({ a, b }) => {
      ctx.moveTo(px(a.x), px(a.y));
      ctx.lineTo(px(b.x), px(b.y));
    });
  }

  // 可复现的伪随机，保证星空在重绘时位置不变
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function checker(g, size, cell, a, b) {
    g.fillStyle = a;
    g.fillRect(0, 0, size, size);
    g.fillStyle = b;
    const n = Math.round(size / cell);
    for (let y = 0; y < n; y++) {
      for (let x = y % 2; x < n; x += 2) g.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  function drawParticle(ctx, p, cell) {
    const x = p.x * cell;
    const y = p.y * cell;
    const s = p.size * cell;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;
    switch (p.shape) {
      case 'spark': {
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const len = Math.min(0.6, speed * 0.05) * cell;
        ctx.lineWidth = Math.max(1, s * 0.7);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (p.vx / speed) * len, y - (p.vy / speed) * len);
        ctx.stroke();
        break;
      }
      case 'heart':
        heart(ctx, x, y, s * 1.5);
        ctx.fill();
        break;
      case 'sparkle':
        star(ctx, x, y, s * 2, 0.28, 4, p.life / 180);
        ctx.fill();
        break;
      default:
        circle(ctx, x, y, s);
        ctx.fill();
    }
  }

  const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

  // ================= 霓虹（默认）=================
  const neon = (() => {
    const C = {
      head: hexToRgb('#8af7c6'),
      tail: hexToRgb('#159069'),
      deadHead: hexToRgb('#9aa5b1'),
      deadTail: hexToRgb('#3d4853'),
    };

    return {
      id: 'neon',
      label: '霓虹',
      themeColor: '#0b0f14',
      font: SYSTEM_FONT,
      text: {
        sub: 'SNAKE',
        menuTitle: '准备好了吗？',
        start: '开始游戏',
        paused: '已暂停',
        over: '游戏结束',
        win: '完美通关！',
        record: '🏆 新纪录',
        level: (n, maze) => `LEVEL ${n} · ${maze ? '新增障碍' : '速度提升'}`,
      },
      colors: {
        ring: 'rgba(255, 209, 102, 0.55)',
        countdown: '#e6edf3',
        flash: '255, 80, 90',
        float: { food: '#ff6b6b', bonus: '#ffd166' },
        particles: {
          eat: ['#ff6b6b', '#ffb3b3', '#5ad17a'],
          bonus: ['#ffd166', '#fff1c2', '#f0a020'],
          death: ['#ff6b6b', '#ffffff', '#8af7c6'],
          rock: ['#5b6f86', '#8ea3ba'],
          expire: ['#8b98a5', '#5d6b78'],
        },
      },
      particleShapes: ['dot'],
      gravity: 0,
      shake: 9,

      buildBackground(g, size, cell) {
        checker(g, size, cell, '#0f151c', '#121a22');
        const v = g.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.75);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = v;
        g.fillRect(0, 0, size, size);
      },

      drawWall(ctx, x, y, cell) {
        const inset = cell * 0.08;
        const s = cell - inset * 2;
        roundRect(ctx, x + inset, y + inset, s, s, cell * 0.2);
        ctx.fillStyle = '#263241';
        ctx.fill();
        roundRect(ctx, x + inset + s * 0.12, y + inset + s * 0.1, s * 0.76, s * 0.22, cell * 0.08);
        ctx.fillStyle = '#33445a';
        ctx.fill();
      },

      drawFood(ctx, cx, cy, cell, scale, now) {
        const r = cell * 0.33 * (1 + Math.sin(now / 230) * 0.06) * scale;
        if (r <= 0) return;
        ctx.save();
        ctx.shadowColor = '#ff6b6b';
        ctx.shadowBlur = cell * 0.7;
        const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
        grad.addColorStop(0, '#ff9a9a');
        grad.addColorStop(1, '#d93f55');
        ctx.fillStyle = grad;
        circle(ctx, cx, cy, r);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        circle(ctx, cx - r * 0.35, cy - r * 0.38, r * 0.2);
        ctx.fill();
        ctx.fillStyle = '#5ad17a';
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.35, cy - r * 0.95, r * 0.36, r * 0.17, -0.6, 0, TAU);
        ctx.fill();
      },

      drawBonus(ctx, cx, cy, cell, scale, now) {
        const r = cell * 0.4 * scale;
        if (r <= 0) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(now / 700);
        ctx.shadowColor = '#ffd166';
        ctx.shadowBlur = cell * 0.8;
        star(ctx, 0, 0, r);
        const grad = ctx.createLinearGradient(0, -r, 0, r);
        grad.addColorStop(0, '#fff1c2');
        grad.addColorStop(1, '#f0a020');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      },

      drawSnake(ctx, s) {
        const { segs, head, cell, px, fade, now, dir, dead } = s;
        const headColor = mix(C.head, C.deadHead, fade);
        const tailColor = mix(C.tail, C.deadTail, fade);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 外发光：两层半透明宽描边，比 shadowBlur 省得多
        if (!dead) {
          for (const [width, a] of [[1.25, 0.06], [1.0, 0.1]]) {
            ctx.strokeStyle = `rgba(94, 240, 176, ${a})`;
            ctx.lineWidth = cell * width;
            tracePath(ctx, segs, px);
            ctx.stroke();
          }
        }

        // 渐变身体（从尾到头绘制，头部压在最上层）
        for (let i = segs.length - 1; i >= 0; i--) {
          const { a, b, t } = segs[i];
          ctx.strokeStyle = rgba(mix(headColor, tailColor, t));
          ctx.lineWidth = cell * (t > 0.7 ? 0.76 - ((t - 0.7) / 0.3) * 0.18 : 0.76);
          ctx.beginPath();
          ctx.moveTo(px(a.x), px(a.y));
          ctx.lineTo(px(b.x), px(b.y));
          ctx.stroke();
        }

        // 高光
        ctx.strokeStyle = 'rgba(255,255,255,0.13)';
        ctx.lineWidth = cell * 0.16;
        ctx.beginPath();
        segs.forEach(({ a, b }) => {
          ctx.moveTo(px(a.x) - cell * 0.1, px(a.y) - cell * 0.1);
          ctx.lineTo(px(b.x) - cell * 0.1, px(b.y) - cell * 0.1);
        });
        ctx.stroke();

        // 头
        const hx = px(head.x);
        const hy = px(head.y);
        const perp = { x: -dir.y, y: dir.x };
        if (!dead && now % 2600 < 220) {
          ctx.strokeStyle = '#ff6b6b';
          ctx.lineWidth = Math.max(1.2, cell * 0.07);
          const bx = hx + dir.x * cell * 0.4;
          const by = hy + dir.y * cell * 0.4;
          const tx = bx + dir.x * cell * 0.25;
          const ty = by + dir.y * cell * 0.25;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(tx, ty);
          ctx.lineTo(tx + (dir.x + perp.x) * cell * 0.1, ty + (dir.y + perp.y) * cell * 0.1);
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx + (dir.x - perp.x) * cell * 0.1, ty + (dir.y - perp.y) * cell * 0.1);
          ctx.stroke();
        }
        ctx.fillStyle = rgba(headColor);
        circle(ctx, hx, hy, cell * 0.44);
        ctx.fill();

        for (const side of [-1, 1]) {
          const ex = hx + dir.x * cell * 0.12 + perp.x * cell * 0.2 * side;
          const ey = hy + dir.y * cell * 0.12 + perp.y * cell * 0.2 * side;
          if (dead) {
            const k = cell * 0.09;
            ctx.strokeStyle = '#0b0f14';
            ctx.lineWidth = Math.max(1.5, cell * 0.07);
            ctx.beginPath();
            ctx.moveTo(ex - k, ey - k);
            ctx.lineTo(ex + k, ey + k);
            ctx.moveTo(ex + k, ey - k);
            ctx.lineTo(ex - k, ey + k);
            ctx.stroke();
          } else {
            ctx.fillStyle = '#ffffff';
            circle(ctx, ex, ey, cell * 0.12);
            ctx.fill();
            ctx.fillStyle = '#0b0f14';
            circle(ctx, ex + dir.x * cell * 0.04, ey + dir.y * cell * 0.04, cell * 0.065);
            ctx.fill();
          }
        }
      },

      sounds: {
        start: (a) => a.arp([392, 523, 659], 0.07, { type: 'triangle' }),
        tick: (a) => a.tone(440, 0.08, { type: 'triangle', vol: 0.08 }),
        eat: (a) => a.tone(520, 0.1, { type: 'triangle', to: 900 }),
        bonus: (a) => a.arp([784, 988, 1319, 1568], 0.05, { type: 'square', vol: 0.06 }),
        level: (a) => a.arp([523, 659, 784, 1047], 0.08, { type: 'triangle' }),
        die: (a) => {
          a.tone(320, 0.55, { type: 'sawtooth', to: 55, vol: 0.09 });
          a.tone(160, 0.4, { type: 'square', to: 40, vol: 0.05, delay: 0.05 });
        },
        win: (a) => a.arp([523, 659, 784, 1047, 1319, 1568], 0.09, { type: 'triangle' }),
        click: (a) => a.tone(660, 0.05, { type: 'triangle', vol: 0.05 }),
      },
    };
  })();

  // ================= 星际（太空歌剧风）=================
  const scifi = (() => {
    // 光束颜色随难度变化：轻松绿、标准蓝、困难红
    const BLADES = {
      easy: hexToRgb('#5dff8a'),
      normal: hexToRgb('#45b3ff'),
      hard: hexToRgb('#ff3b3b'),
    };
    const DEAD = hexToRgb('#6b7280');

    // 预生成闪烁星星（单位：棋盘比例）
    const rnd = seeded(7);
    const twinkles = Array.from({ length: 34 }, () => ({
      x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.2, speed: 600 + rnd() * 1400, phase: rnd() * TAU,
    }));

    function shipPath(ctx, k) {
      // 机身（机头朝 +x）
      ctx.beginPath();
      ctx.moveTo(0.52 * k, 0);
      ctx.lineTo(-0.08 * k, 0.15 * k);
      ctx.lineTo(-0.3 * k, 0.11 * k);
      ctx.lineTo(-0.3 * k, -0.11 * k);
      ctx.lineTo(-0.08 * k, -0.15 * k);
      ctx.closePath();
    }

    function wingsPath(ctx, k) {
      ctx.beginPath();
      for (const s of [1, -1]) {
        ctx.moveTo(0.02 * k, 0.1 * s * k);
        ctx.lineTo(-0.26 * k, 0.48 * s * k);
        ctx.lineTo(-0.42 * k, 0.48 * s * k);
        ctx.lineTo(-0.28 * k, 0.08 * s * k);
        ctx.closePath();
      }
    }

    return {
      id: 'scifi',
      label: '星际',
      themeColor: '#03040a',
      font: '"SF Mono", "Menlo", "Consolas", "PingFang SC", "Microsoft YaHei", monospace',
      text: {
        sub: 'STAR SERPENT',
        menuTitle: '舰队待命，指挥官',
        start: '启动引擎',
        paused: '曲速引擎已暂停',
        over: '飞船被击毁',
        win: '银河已被征服',
        record: '★ 新纪录',
        level: (n, maze) => `LEVEL ${n} · ${maze ? '小行星带扩张' : '跃迁加速'}`,
      },
      colors: {
        ring: 'rgba(255, 232, 31, 0.7)',
        countdown: '#ffe81f',
        flash: '255, 170, 60',
        float: { food: '#ffe81f', bonus: '#7df9ff' },
        particles: {
          eat: ['#ffe81f', '#ffffff', '#ffb347'],
          bonus: ['#7df9ff', '#ffffff', '#b8fbff'],
          death: ['#ffb347', '#ffffff', '#ff5e3a', '#ffe81f'],
          rock: ['#8a93a3', '#c7ced9'],
          expire: ['#4b5568', '#7d8aa3'],
        },
      },
      particleShapes: ['spark', 'spark', 'dot'],
      gravity: 0,
      shake: 11,
      rings: true,

      buildBackground(g, size, cell) {
        const bg = g.createRadialGradient(size * 0.5, size * 0.4, 0, size * 0.5, size * 0.5, size * 0.8);
        bg.addColorStop(0, '#0a0f22');
        bg.addColorStop(1, '#02030a');
        g.fillStyle = bg;
        g.fillRect(0, 0, size, size);

        // 星云
        for (const [x, y, r, c] of [
          [0.22, 0.28, 0.45, 'rgba(120, 60, 210, 0.16)'],
          [0.82, 0.7, 0.5, 'rgba(30, 130, 220, 0.12)'],
          [0.6, 0.15, 0.3, 'rgba(220, 60, 120, 0.07)'],
        ]) {
          const n = g.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
          n.addColorStop(0, c);
          n.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = n;
          g.fillRect(0, 0, size, size);
        }

        // 远处的行星
        const px = size * 0.98;
        const py = size * 1.04;
        const pr = size * 0.36;
        const planet = g.createRadialGradient(px - pr * 0.4, py - pr * 0.5, pr * 0.1, px, py, pr);
        planet.addColorStop(0, '#2a3358');
        planet.addColorStop(1, '#070a18');
        g.fillStyle = planet;
        g.beginPath();
        g.arc(px, py, pr, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(120, 170, 255, 0.35)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(px, py, pr, Math.PI * 1.05, Math.PI * 1.55);
        g.stroke();

        // 静态星空
        const r = seeded(42);
        for (let i = 0; i < 160; i++) {
          g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.6})`;
          g.beginPath();
          g.arc(r() * size, r() * size, 0.3 + r() * 0.9, 0, TAU);
          g.fill();
        }

        // 战术网格
        g.strokeStyle = 'rgba(90, 170, 255, 0.06)';
        g.lineWidth = 1;
        g.beginPath();
        for (let i = 1; i < size / cell; i++) {
          g.moveTo(Math.round(i * cell) + 0.5, 0);
          g.lineTo(Math.round(i * cell) + 0.5, size);
          g.moveTo(0, Math.round(i * cell) + 0.5);
          g.lineTo(size, Math.round(i * cell) + 0.5);
        }
        g.stroke();
      },

      drawAmbient(ctx, size, cell, now) {
        twinkles.forEach((s) => {
          const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(now / s.speed + s.phase));
          ctx.fillStyle = `rgba(220, 235, 255, ${a})`;
          circle(ctx, s.x * size, s.y * size, s.r);
          ctx.fill();
        });

        // 每 8 秒划过一颗流星
        const cycle = Math.floor(now / 8000);
        const p = (now % 8000) / 900;
        if (p < 1) {
          const r = seeded(cycle + 1);
          const x0 = (0.2 + r() * 0.7) * size;
          const y0 = r() * 0.3 * size;
          const len = size * 0.35;
          const hx = x0 - len * p;
          const hy = y0 + len * 0.5 * p;
          const grad = ctx.createLinearGradient(hx, hy, hx + 60, hy - 30);
          grad.addColorStop(0, `rgba(255,255,255,${1 - p})`);
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx + 60, hy - 30);
          ctx.stroke();
        }
      },

      drawWall(ctx, x, y, cell) {
        // 金属装甲板
        const i = cell * 0.05;
        const s = cell - i * 2;
        const grad = ctx.createLinearGradient(x, y, x, y + cell);
        grad.addColorStop(0, '#4a5262');
        grad.addColorStop(1, '#1c212b');
        ctx.fillStyle = grad;
        ctx.fillRect(x + i, y + i, s, s);
        ctx.strokeStyle = '#6b7588';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + i + 0.5, y + i + 0.5, s - 1, s - 1);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.moveTo(x + i + s * 0.15, y + cell / 2);
        ctx.lineTo(x + i + s * 0.85, y + cell / 2);
        ctx.stroke();
        ctx.fillStyle = '#9aa4b5';
        for (const [dx, dy] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
          circle(ctx, x + cell * dx, y + cell * dy, Math.max(0.8, cell * 0.04));
          ctx.fill();
        }
      },

      drawFood(ctx, cx, cy, cell, scale, now) {
        // 带光环的小行星
        const r = cell * 0.27 * scale;
        if (r <= 0) return;
        const tilt = -0.45;
        const ringR = r * 1.75;
        const ringW = Math.max(1.2, cell * 0.06);

        const ring = (from, to) => {
          ctx.strokeStyle = 'rgba(255, 220, 160, 0.85)';
          ctx.lineWidth = ringW;
          ctx.beginPath();
          ctx.ellipse(cx, cy, ringR, ringR * 0.32, tilt, from, to);
          ctx.stroke();
        };

        ring(Math.PI, TAU); // 背面
        ctx.save();
        ctx.shadowColor = '#ffb347';
        ctx.shadowBlur = cell * (0.6 + 0.15 * Math.sin(now / 260));
        const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        grad.addColorStop(0, '#ffe2a8');
        grad.addColorStop(0.6, '#f0913a');
        grad.addColorStop(1, '#a8431c');
        ctx.fillStyle = grad;
        circle(ctx, cx, cy, r);
        ctx.fill();
        ctx.restore();
        ctx.save();
        circle(ctx, cx, cy, r);
        ctx.clip();
        ctx.fillStyle = 'rgba(120, 40, 10, 0.25)';
        ctx.fillRect(cx - r, cy - r * 0.15, r * 2, r * 0.22);
        ctx.fillRect(cx - r, cy + r * 0.35, r * 2, r * 0.14);
        ctx.restore();
        ring(0, Math.PI); // 正面
      },

      drawBonus(ctx, cx, cy, cell, scale, now) {
        // 发光能量晶体
        const r = cell * 0.42 * scale;
        if (r <= 0) return;
        const bob = Math.sin(now / 300) * cell * 0.04;
        ctx.save();
        ctx.translate(cx, cy + bob);
        ctx.rotate(Math.sin(now / 900) * 0.25);
        ctx.shadowColor = '#7df9ff';
        ctx.shadowBlur = cell * (0.8 + 0.3 * Math.sin(now / 150));
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.42, -r * 0.2);
        ctx.lineTo(r * 0.3, r * 0.75);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.3, r * 0.75);
        ctx.lineTo(-r * 0.42, -r * 0.2);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, -r, 0, r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.5, '#9ff7ff');
        grad.addColorStop(1, '#2bb7d6');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(0, r);
        ctx.moveTo(-r * 0.42, -r * 0.2);
        ctx.lineTo(r * 0.42, -r * 0.2);
        ctx.stroke();
        ctx.restore();
      },

      drawSnake(ctx, s) {
        const { segs, head, cell, px, fade, now, dir, dead, difficulty } = s;
        const blade = mix(BLADES[difficulty] || BLADES.normal, DEAD, fade);
        const flicker = dead ? 1 : 1 + Math.sin(now / 23) * 0.04 + Math.sin(now / 57) * 0.03;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 光束：外晕 → 光身 → 白色内核
        const layers = dead
          ? [[0.5, rgba(blade, 0.9)]]
          : [
              // 多层逐级加深，模拟柔和光晕（避免 shadowBlur 的性能开销）
              [1.5, rgba(blade, 0.035)],
              [1.3, rgba(blade, 0.05)],
              [1.1, rgba(blade, 0.08)],
              [0.92, rgba(blade, 0.14)],
              [0.76, rgba(blade, 0.3)],
              [0.6, rgba(blade, 0.85)],
              [0.3 * flicker, 'rgba(255,255,255,0.95)'],
            ];
        layers.forEach(([w, color]) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = cell * w;
          tracePath(ctx, segs, px);
          ctx.stroke();
        });

        // 舰首：小型战机
        const hx = px(head.x);
        const hy = px(head.y);
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(Math.atan2(dir.y, dir.x) + (dead ? 0.5 : 0));
        const k = cell * 1.05;

        if (!dead) {
          // 引擎尾焰
          ctx.fillStyle = rgba(blade, 0.6);
          circle(ctx, -0.32 * k, 0, 0.13 * k * flicker);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          circle(ctx, -0.3 * k, 0, 0.06 * k);
          ctx.fill();
        }

        wingsPath(ctx, k);
        ctx.fillStyle = dead ? '#3a3f48' : '#8792a6';
        ctx.fill();
        ctx.strokeStyle = dead ? '#22262d' : '#4b5466';
        ctx.lineWidth = 1;
        ctx.stroke();

        shipPath(ctx, k);
        const hull = ctx.createLinearGradient(0, -0.15 * k, 0, 0.15 * k);
        hull.addColorStop(0, dead ? '#4b5058' : '#eef2f8');
        hull.addColorStop(1, dead ? '#2a2e35' : '#9aa5b8');
        ctx.fillStyle = hull;
        ctx.fill();
        ctx.stroke();

        // 驾驶舱
        ctx.fillStyle = dead ? '#1a1d22' : rgba(blade);
        circle(ctx, 0.14 * k, 0, 0.065 * k);
        ctx.fill();
        // 翼尖红灯
        if (!dead && now % 1200 < 600) {
          ctx.fillStyle = '#ff4d4d';
          circle(ctx, -0.34 * k, 0.46 * k, 0.03 * k);
          ctx.fill();
          circle(ctx, -0.34 * k, -0.46 * k, 0.03 * k);
          ctx.fill();
        }
        ctx.restore();
      },

      sounds: {
        start: (a) => {
          a.tone(90, 0.7, { type: 'sawtooth', to: 220, vol: 0.06 });
          a.tone(180, 0.7, { type: 'sawtooth', to: 440, vol: 0.03 });
        },
        tick: (a) => a.tone(1200, 0.05, { type: 'square', vol: 0.035 }),
        eat: (a) => {
          a.tone(1500, 0.16, { type: 'sawtooth', to: 160, vol: 0.06 });
          a.tone(750, 0.12, { type: 'square', to: 110, vol: 0.025 });
        },
        bonus: (a) => {
          a.tone(300, 0.35, { type: 'sawtooth', to: 1900, vol: 0.05 });
          a.arp([1319, 1760, 2349], 0.06, { type: 'square', vol: 0.03, delay: 0.25 });
        },
        level: (a) => a.arp([392, 523, 784, 1047], 0.12, { type: 'sawtooth', vol: 0.05, dur: 0.22 }),
        die: (a) => {
          a.noise(0.9, { vol: 0.4, from: 2400, to: 60 });
          a.tone(130, 0.7, { type: 'sawtooth', to: 30, vol: 0.09 });
        },
        win: (a) => a.arp([392, 523, 659, 784, 1047, 1319], 0.13, { type: 'sawtooth', vol: 0.05, dur: 0.3 }),
        click: (a) => a.tone(1600, 0.04, { type: 'square', vol: 0.03 }),
      },
    };
  })();

  // ================= 甜心（可爱少女风）=================
  const sweet = (() => {
    const C = {
      head: hexToRgb('#ff8fc1'),
      mid: hexToRgb('#c9a7ff'),
      tail: hexToRgb('#8fe3cf'),
      dead: hexToRgb('#d8cad2'),
    };
    const INK = '#6b3654';

    function bow(ctx, x, y, s) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(0.25);
      ctx.fillStyle = '#ff4d8d';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(side * s * 1.5, -s * 1.3, side * s * 1.7, s * 1.1, 0, 0);
        ctx.fill();
      }
      ctx.fillStyle = '#ff7aa8';
      circle(ctx, 0, 0, s * 0.24);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      circle(ctx, -s * 0.5, -s * 0.12, s * 0.12);
      ctx.fill();
      ctx.restore();
    }

    return {
      id: 'sweet',
      label: '甜心',
      themeColor: '#ffeef5',
      font: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "PingFang SC", "Microsoft YaHei", sans-serif',
      text: {
        sub: 'SWEET SNAKE ♡',
        menuTitle: '一起去摘草莓吧 ♡',
        start: '开始吧 ♡',
        paused: '休息一下～',
        over: '哎呀，撞到啦～',
        win: '全部吃光光！',
        record: '🎀 新纪录',
        level: (n, maze) => `LEVEL ${n} · ${maze ? '飘来一朵云～' : '变快啦～'}`,
      },
      colors: {
        ring: 'rgba(255, 126, 179, 0.7)',
        countdown: '#ff7eb3',
        countdownOutline: '#ffffff',
        flash: '255, 150, 200',
        float: { food: '#ff5c99', bonus: '#ffb300' },
        floatOutline: '#ffffff',
        particles: {
          eat: ['#ff7eb3', '#ffb3d1', '#ff4d8d', '#ffd36e'],
          bonus: ['#ffd36e', '#ff9ccc', '#c9a7ff', '#8fe3cf'],
          death: ['#ff7eb3', '#c9a7ff', '#ffd36e', '#8fe3cf'],
          rock: ['#e9ddff', '#ffffff'],
          expire: ['#e6d6df', '#f3e9ef'],
        },
      },
      particleShapes: ['heart', 'sparkle', 'heart'],
      gravity: -3, // 爱心往上飘
      shake: 3,

      buildBackground(g, size, cell) {
        checker(g, size, cell, '#fffafc', '#fff0f6');
        // 圆点花纹
        g.fillStyle = 'rgba(255, 170, 205, 0.35)';
        const n = Math.round(size / cell);
        for (let y = 1; y < n; y++) {
          for (let x = 1; x < n; x++) {
            if ((x + y) % 2) continue;
            g.beginPath();
            g.arc(x * cell, y * cell, Math.max(1, cell * 0.06), 0, TAU);
            g.fill();
          }
        }
        const v = g.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.75);
        v.addColorStop(0, 'rgba(255,255,255,0)');
        v.addColorStop(1, 'rgba(255, 190, 220, 0.35)');
        g.fillStyle = v;
        g.fillRect(0, 0, size, size);
      },

      drawWall(ctx, x, y, cell) {
        // 软绵绵的云朵
        const cx = x + cell / 2;
        const cy = y + cell / 2 + cell * 0.05;
        const puffs = [
          [-0.22, 0.04, 0.2],
          [0, -0.1, 0.26],
          [0.22, 0.04, 0.2],
        ];
        const cloud = (dy, color) => {
          ctx.fillStyle = color;
          roundRect(ctx, cx - cell * 0.4, cy + dy - cell * 0.02, cell * 0.8, cell * 0.25, cell * 0.12);
          ctx.fill();
          puffs.forEach(([dx, py, r]) => {
            circle(ctx, cx + dx * cell, cy + py * cell + dy, r * cell);
            ctx.fill();
          });
        };
        cloud(cell * 0.07, '#e6d8ff'); // 淡紫色投影
        cloud(0, '#ffffff');
      },

      drawFood(ctx, cx, cy, cell, scale, now) {
        // 草莓
        const r = cell * 0.36 * scale;
        if (r <= 0) return;
        cy += Math.sin(now / 320) * cell * 0.035;
        ctx.save();
        ctx.shadowColor = 'rgba(255, 80, 130, 0.35)';
        ctx.shadowBlur = cell * 0.35;
        ctx.shadowOffsetY = cell * 0.06;
        ctx.beginPath();
        ctx.moveTo(cx, cy + r * 0.95);
        ctx.bezierCurveTo(cx - r * 1.1, cy + r * 0.35, cx - r * 0.95, cy - r * 0.75, cx, cy - r * 0.5);
        ctx.bezierCurveTo(cx + r * 0.95, cy - r * 0.75, cx + r * 1.1, cy + r * 0.35, cx, cy + r * 0.95);
        const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
        grad.addColorStop(0, '#ff7f9f');
        grad.addColorStop(1, '#ff3d6e');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#ffe9a6';
        for (const [dx, dy] of [[-0.35, -0.05], [0.05, -0.15], [0.38, 0], [-0.15, 0.3], [0.2, 0.35], [0, 0.62]]) {
          ctx.beginPath();
          ctx.ellipse(cx + dx * r, cy + dy * r, r * 0.06, r * 0.09, 0, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.42, cy - r * 0.2, r * 0.12, r * 0.22, 0.5, 0, TAU);
        ctx.fill();

        ctx.fillStyle = '#5fcf7c';
        star(ctx, cx, cy - r * 0.55, r * 0.45, 0.45, 5);
        ctx.fill();
        ctx.strokeStyle = '#4bb868';
        ctx.lineWidth = Math.max(1, r * 0.1);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.65);
        ctx.lineTo(cx + r * 0.12, cy - r * 0.95);
        ctx.stroke();
      },

      drawBonus(ctx, cx, cy, cell, scale, now) {
        // 会笑的星星糖
        const r = cell * 0.44 * scale;
        if (r <= 0) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.sin(now / 380) * 0.2);
        ctx.shadowColor = 'rgba(255, 190, 40, 0.6)';
        ctx.shadowBlur = cell * 0.5;
        star(ctx, 0, 0, r, 0.52);
        const grad = ctx.createLinearGradient(0, -r, 0, r);
        grad.addColorStop(0, '#fff3a6');
        grad.addColorStop(1, '#ffc23c');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.2, cell * 0.06);
        ctx.stroke();
        // 表情
        ctx.fillStyle = INK;
        circle(ctx, -r * 0.18, r * 0.02, r * 0.07);
        ctx.fill();
        circle(ctx, r * 0.18, r * 0.02, r * 0.07);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 110, 160, 0.5)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.32, r * 0.18, r * 0.1, r * 0.06, 0, 0, TAU);
        ctx.ellipse(r * 0.32, r * 0.18, r * 0.1, r * 0.06, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1, r * 0.06);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, r * 0.12, r * 0.1, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        ctx.restore();
      },

      drawSnake(ctx, s) {
        const { beads, cell, px, fade, now, dir, dead } = s;
        const n = beads.length;

        // 身体：一颗颗糖果色圆珠，从尾到头画
        for (let i = n - 1; i >= 1; i--) {
          const t = i / Math.max(1, n - 1);
          const color = mix(mix3(C.head, C.mid, C.tail, t), C.dead, fade);
          const bx = px(beads[i].x);
          const by = px(beads[i].y);
          const r = cell * (0.43 - 0.08 * t);
          ctx.fillStyle = 'rgba(200, 110, 160, 0.16)';
          circle(ctx, bx, by + cell * 0.07, r);
          ctx.fill();
          ctx.fillStyle = rgba(color);
          circle(ctx, bx, by, r);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = Math.max(1.2, cell * 0.05);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.65)';
          circle(ctx, bx - r * 0.32, by - r * 0.36, r * 0.26);
          ctx.fill();
        }

        // 头：始终正脸朝上，眼珠看向前进方向
        const hx = px(beads[0].x);
        const hy = px(beads[0].y) + (dead ? 0 : Math.sin(now / 160) * cell * 0.02);
        const r = cell * 0.5;
        ctx.fillStyle = 'rgba(200, 110, 160, 0.2)';
        circle(ctx, hx, hy + cell * 0.08, r);
        ctx.fill();
        ctx.fillStyle = rgba(mix(C.head, C.dead, fade));
        circle(ctx, hx, hy, r);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, cell * 0.06);
        ctx.stroke();

        // 腮红
        ctx.fillStyle = 'rgba(255, 90, 150, 0.4)';
        ctx.beginPath();
        ctx.ellipse(hx - r * 0.55, hy + r * 0.25, r * 0.17, r * 0.1, 0, 0, TAU);
        ctx.ellipse(hx + r * 0.55, hy + r * 0.25, r * 0.17, r * 0.1, 0, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = INK;
        ctx.fillStyle = INK;
        ctx.lineWidth = Math.max(1.3, r * 0.09);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const blink = !dead && now % 3200 < 130;
        for (const side of [-1, 1]) {
          const ex = hx + side * r * 0.33;
          const ey = hy - r * 0.05;
          if (dead) {
            // > < 眯眼
            ctx.beginPath();
            ctx.moveTo(ex - side * r * 0.12, ey - r * 0.1);
            ctx.lineTo(ex + side * r * 0.06, ey);
            ctx.lineTo(ex - side * r * 0.12, ey + r * 0.1);
            ctx.stroke();
          } else if (blink) {
            ctx.beginPath();
            ctx.arc(ex, ey, r * 0.12, 0.1 * Math.PI, 0.9 * Math.PI);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.ellipse(ex + dir.x * r * 0.07, ey + dir.y * r * 0.07, r * 0.14, r * 0.18, 0, 0, TAU);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            circle(ctx, ex + dir.x * r * 0.07 - r * 0.05, ey + dir.y * r * 0.07 - r * 0.07, r * 0.06);
            ctx.fill();
            circle(ctx, ex + dir.x * r * 0.07 + r * 0.05, ey + dir.y * r * 0.07 + r * 0.06, r * 0.03);
            ctx.fill();
            ctx.fillStyle = INK;
          }
        }

        // 嘴巴
        ctx.beginPath();
        if (dead) {
          ctx.moveTo(hx - r * 0.12, hy + r * 0.32);
          ctx.quadraticCurveTo(hx - r * 0.06, hy + r * 0.24, hx, hy + r * 0.32);
          ctx.quadraticCurveTo(hx + r * 0.06, hy + r * 0.4, hx + r * 0.12, hy + r * 0.32);
        } else {
          // ω 形小嘴
          ctx.arc(hx - r * 0.07, hy + r * 0.24, r * 0.07, 0.1 * Math.PI, 0.95 * Math.PI);
          ctx.moveTo(hx + r * 0.14, hy + r * 0.25);
          ctx.arc(hx + r * 0.07, hy + r * 0.24, r * 0.07, 0.05 * Math.PI, 0.9 * Math.PI);
        }
        ctx.stroke();

        bow(ctx, hx + r * 0.5, hy - r * 0.72, r * 0.62);
      },

      sounds: {
        start: (a) => a.arp([784, 988, 1175, 1568], 0.08, { type: 'sine', vol: 0.09 }),
        tick: (a) => a.tone(1320, 0.07, { type: 'sine', vol: 0.06 }),
        eat: (a) => {
          a.tone(700, 0.08, { type: 'sine', to: 1400, vol: 0.1 });
          a.tone(1760, 0.1, { type: 'sine', vol: 0.05, delay: 0.06 });
        },
        bonus: (a) => a.arp([1047, 1319, 1568, 2093, 2637], 0.055, { type: 'sine', vol: 0.07 }),
        level: (a) => a.arp([784, 988, 1175, 1568], 0.09, { type: 'triangle', vol: 0.08 }),
        die: (a) => {
          a.tone(620, 0.2, { type: 'triangle', to: 470, vol: 0.09 });
          a.tone(470, 0.35, { type: 'triangle', to: 300, vol: 0.09, delay: 0.2 });
        },
        win: (a) => a.arp([1047, 1175, 1319, 1568, 1760, 2093], 0.09, { type: 'sine', vol: 0.08 }),
        click: (a) => a.tone(1100, 0.04, { type: 'sine', vol: 0.05 }),
      },
    };
  })();

  return {
    list: [neon, scifi, sweet],
    byId: { neon, scifi, sweet },
    drawParticle,
  };
})();
