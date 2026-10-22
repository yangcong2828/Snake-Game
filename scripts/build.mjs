// 打包成单个 HTML 文件：样式与脚本全部内联，不依赖网络，
// 可以直接通过微信发到手机，用浏览器打开就能玩。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

let html = read('index.html');

const inline = (tag, path, wrap) => {
  if (!html.includes(tag)) throw new Error(`index.html 中找不到：${tag}`);
  // 用函数作替换值，避免源码里的 $& 之类被当成替换模式
  html = html.replace(tag, () => wrap(read(path)));
};

inline('<link rel="stylesheet" href="./src/styles/style.css">', 'src/styles/style.css', (css) => `<style>\n${css}</style>`);
inline('<script src="./src/scripts/themes.js"></script>', 'src/scripts/themes.js', (js) => `<script>\n${js}</script>`);
inline('<script src="./src/scripts/app.js"></script>', 'src/scripts/app.js', (js) => `<script>\n${js}</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/snake.html'), html);
console.log(`dist/snake.html  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
