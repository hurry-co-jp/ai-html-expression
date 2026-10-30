import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { resolveDeckDir } from './sync.js';

let targetDir = process.cwd();
let targetPort = 0; // 0 は OS 自動割当
let autoExitMinutes = 15; // 15分アイドルで自動終了

try {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', short: 'd' },
      port: { type: 'string', short: 'p' },
      timeout: { type: 'string', short: 't' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log('使用方法:');
    console.log('  node scripts/dev-server.js [--dir <ディレクトリ>] [--port <ポート>] [--timeout <分>]');
    console.log('例:');
    console.log('  node scripts/dev-server.js');
    console.log('  node scripts/dev-server.js --dir ./docs/slides/my-topic');
    console.log('  node scripts/dev-server.js --port 3000\n');
    console.log('※ ディレクトリ未指定時はカレントディレクトリを自動対象とします。');
    console.log('※ ポート未指定時は空きポートが自動割当されます。');
    console.log('※ 15分間アクセスがない場合、プロセスは自動終了します。');
    process.exit(0);
  }

  const resolved = resolveDeckDir(values.dir);
  if (resolved) {
    targetDir = resolved;
  } else if (values.dir) {
    targetDir = path.resolve(process.cwd(), values.dir);
  }
  if (values.port) {
    targetPort = parseInt(values.port, 10);
  }
  if (values.timeout) {
    autoExitMinutes = parseInt(values.timeout, 10);
  }
} catch (err) {
  console.error(`エラー: ${err.message}\n`);
  process.exit(1);
}

if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
  console.error(`エラー: 指定されたディレクトリが存在しません: ${targetDir}`);
  process.exit(1);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// アイドル自動終了タイマー
let idleTimer = null;
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (autoExitMinutes > 0) {
    idleTimer = setTimeout(() => {
      console.log(`\n[自動終了] ${autoExitMinutes}分間アクセスがなかったため、サーバーを安全に終了しました。`);
      process.exit(0);
    }, autoExitMinutes * 60 * 1000);
  }
}

const server = http.createServer((req, res) => {
  resetIdleTimer();

  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(targetDir, urlPath);

  // ディレクトリ指定の場合は index.html を探す
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // ファイルが存在しない場合
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${urlPath}`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`500 Internal Server Error: ${err.message}`);
  }
});

server.listen(targetPort, () => {
  const actualPort = server.address().port;
  console.log('==================================================');
  console.log('スライド開発サーバーが起動しました');
  console.log(`配信ディレクトリ: ${targetDir}`);
  console.log(`アクセス URL:    http://localhost:${actualPort}`);
  if (autoExitMinutes > 0) {
    console.log(`自動終了:        ${autoExitMinutes}分間無通信で自動シャットダウン`);
  }
  console.log('==================================================');
  resetIdleTimer();
});
