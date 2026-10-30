import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolveDeckDir, getAvailableDecks } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function showHelpAndExit(errorMessage = '') {
  if (errorMessage) {
    console.error(`エラー: ${errorMessage}\n`);
  }
  console.log('📸 スライドキャプチャツール (capture-slides.js)\n');
  console.log('使い方:');
  console.log('  node scripts/capture-slides.js [--dir <ディレクトリ>] [--page <ページ番号>]\n');
  console.log('使用例:');
  console.log('  node scripts/capture-slides.js                       # カレントディレクトリの全スライドを撮影');
  console.log('  node scripts/capture-slides.js --page 3              # 3ページ目のみ撮影');
  console.log('  node scripts/capture-slides.js --dir ./docs/slides/topic --page 3');
  console.log('\n※ ディレクトリ未指定時はカレントディレクトリを自動対象とします。');
  console.log('');
  process.exit(errorMessage ? 1 : 0);
}

async function runCapture() {
  let values;
  try {
    const parsed = parseArgs({
      options: {
        dir: { type: 'string' },
        deck: { type: 'string', short: 'd' },
        page: { type: 'string', short: 'p' },
        help: { type: 'boolean', short: 'h' }
      },
      allowPositionals: false
    });
    values = parsed.values;
  } catch (err) {
    showHelpAndExit(err.message);
  }

  if (values.help) {
    showHelpAndExit();
  }

  const targetPath = values.dir || values.deck;
  const targetDeckDir = resolveDeckDir(targetPath);

  if (!targetDeckDir) {
    showHelpAndExit(targetPath ? `指定されたディレクトリ "${targetPath}" が見つかりません。` : '有効なスライドディレクトリが見つかりません。--dir で指定してください。');
  }

  const deckName = path.basename(targetDeckDir);
  const slidesDirPath = path.join(targetDeckDir, 'slides');
  const outputDir = path.join(targetDeckDir, 'thumbnails');

  if (!fs.existsSync(slidesDirPath)) {
    console.error(`❌ エラー: スライドディレクトリが見つかりません: ${slidesDirPath}`);
    process.exit(1);
  }

  // スライドHTML一覧を取得
  const allSlideFiles = fs.readdirSync(slidesDirPath)
    .filter(f => f.endsWith('.html'))
    .sort();

  if (allSlideFiles.length === 0) {
    console.log(`スライドファイルが存在しません: ${slidesDirPath}`);
    process.exit(0);
  }

  // ページ番号指定（--page）のパース
  const targetPageArg = values.page;
  let targetSlideFiles = allSlideFiles;

  if (targetPageArg) {
    const parsedNum = parseInt(targetPageArg, 10);
    if (!isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= allSlideFiles.length) {
      targetSlideFiles = [allSlideFiles[parsedNum - 1]];
    } else {
      const matched = allSlideFiles.filter(f => f.startsWith(targetPageArg));
      if (matched.length > 0) {
        targetSlideFiles = matched;
      } else {
        console.error(`❌ エラー: 指定されたページ "${targetPageArg}" に一致するスライドが見つかりません。`);
        console.log(`有効な範囲: 1 〜 ${allSlideFiles.length}`);
        process.exit(1);
      }
    }
  }

  // 出力先ディレクトリと .gitignore の自動担保
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const gitignorePath = path.join(outputDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*.png\n!.gitignore\n');
  }

  console.log('========================================');
  if (targetSlideFiles.length === 1) {
    console.log(`📸 スライド単体キャプチャを開始します: ${deckName}`);
    console.log(`対象: ${targetSlideFiles[0]}`);
  } else {
    console.log(`📸 スライド全ページ一括キャプチャを開始します: ${deckName}`);
    console.log(`対象スライド数: ${targetSlideFiles.length} 枚`);
  }
  console.log(`保存先: ${path.relative(process.cwd(), outputDir)}`);
  console.log('========================================\n');

  const DEBUG_PORT = 9400 + Math.floor(Math.random() * 500);

  // Chromium ヘッドレス起動
  const browserProc = spawn('chromium-browser', [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1920,1080',
    'about:blank'
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { browserProc.kill(); } catch (_) {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // デバッグポート接続待機
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) {
        const data = await res.json();
        wsUrl = data.webSocketDebuggerUrl;
        break;
      }
    } catch (_) {}
  }

  if (!wsUrl) {
    console.error('❌ エラー: Chromiumのデバッグポートに接続できませんでした。');
    cleanup();
    process.exit(1);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let messageId = 0;
  const send = (method, params = {}) => {
    const id = ++messageId;
    return new Promise((resolve, reject) => {
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  const sendSession = (method, params = {}) => {
    const id = ++messageId;
    return new Promise((resolve, reject) => {
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, sessionId, method, params }));
    });
  };

  await sendSession('Page.enable');
  await sendSession('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });

  // 対象スライドを撮影
  for (let idx = 0; idx < targetSlideFiles.length; idx++) {
    const file = targetSlideFiles[idx];
    const fullHtmlPath = path.join(slidesDirPath, file);
    const fileUrl = `file://${fullHtmlPath}`;
    const baseName = path.basename(file, '.html');
    const outPngName = `${baseName}.png`;
    const outPngPath = path.join(outputDir, outPngName);

    process.stdout.write(`[${idx + 1}/${targetSlideFiles.length}] 撮影中: ${file} ... `);

    await sendSession('Page.navigate', { url: fileUrl });
    await sleep(700);

    const screenshotResult = await sendSession('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true
    });

    const buffer = Buffer.from(screenshotResult.data, 'base64');
    fs.writeFileSync(outPngPath, buffer);

    console.log(`✔ 保存完了 (${(buffer.length / 1024).toFixed(0)} KB) -> thumbnails/${outPngName}`);
  }

  cleanup();
  console.log('\n✔ キャプチャが完了しました！');
  console.log(`出力先フォルダ: ${path.relative(process.cwd(), outputDir)}\n`);
}

runCapture().catch(err => {
  console.error('実行時エラー:', err);
  process.exit(1);
});
