import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { parseArgs } from 'node:util';
import { resolveDeckDir, getAvailableDecks } from './sync.js';

function showHelpAndExit(errorMessage = '') {
  if (errorMessage) {
    console.error(`エラー: ${errorMessage}\n`);
  }
  console.log('使用方法:');
  console.log('  node scripts/check-slides.js [--dir <ディレクトリ>] [--browser]');
  console.log('例:');
  console.log('  node scripts/check-slides.js');
  console.log('  node scripts/check-slides.js --browser');
  console.log('  node scripts/check-slides.js --dir ./docs/slides/my-topic');
  console.log('\n※ ディレクトリ未指定時はカレントディレクトリを自動対象とします。');
  process.exit(1);
}

let values;
try {
  const parsed = parseArgs({
    options: {
      dir: { type: 'string' },
      deck: { type: 'string', short: 'd' },
      browser: { type: 'boolean', short: 'b' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false // 位置引数を厳格に禁止
  });
  values = parsed.values;
} catch (err) {
  showHelpAndExit(err.message);
}

if (values.help) {
  showHelpAndExit();
}

const targetPath = values.dir || values.deck;
const isBrowserMode = Boolean(values.browser);
const targetDeckDir = resolveDeckDir(targetPath);
if (!targetDeckDir) {
  showHelpAndExit(targetPath ? `指定されたディレクトリ "${targetPath}" が見つかりません。` : '有効なスライドディレクトリが見つかりません。--dir で指定してください。');
}

const configJsPath = path.join(targetDeckDir, 'slide_config.js');
const configCssPath = path.join(targetDeckDir, 'slide_config.css');
const slidesDirPath = path.join(targetDeckDir, 'slides');
const demosDirPath = path.join(targetDeckDir, 'demos');

let hasError = false;

function reportError(message) {
  console.error(`❌ エラー: ${message}`);
  hasError = true;
}

function reportWarning(message) {
  console.warn(`⚠️  警告: ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----------------------------------------------------
// 静的解析・リンター
// ----------------------------------------------------
async function runCheck() {
  console.log('🔍 スライドデッキの整合性・デザイン規約検証を開始します...\n');

  // 1. slide_config.js の読み込みと検証
  if (!fs.existsSync(configJsPath)) {
    reportError(`設定ファイルが見つかりません: ${configJsPath}`);
    process.exit(1);
  }

  let slideDeckConfig;
  try {
    const configModule = await import(`file://${configJsPath}?t=${Date.now()}`);
    slideDeckConfig = configModule.slideDeckConfig;
  } catch (err) {
    reportError(`slide_config.js のパースに失敗しました: ${err.message}`);
    process.exit(1);
  }

  const registeredSlides = slideDeckConfig.slides || [];
  console.log(`📋 登録スライド数: ${registeredSlides.length} 枚`);

  if (registeredSlides.length === 0) {
    reportError('slide_config.js にスライドが1枚も登録されていません。');
  }

  // 2. 登録スライドファイルの実在確認
  const registeredFiles = new Set();
  const pageNumbers = [];

  for (let i = 0; i < registeredSlides.length; i++) {
    const slide = registeredSlides[i];
    if (!slide.url) {
      reportError(`インデックス ${i} のスライドに url が定義されていません。`);
      continue;
    }

    const fullPath = path.resolve(targetDeckDir, slide.url);
    if (!fs.existsSync(fullPath)) {
      reportError(`登録されているスライドファイルが存在しません: ${slide.url}`);
    } else {
      registeredFiles.add(path.basename(fullPath));
    }

    const fileName = path.basename(slide.url);
    const match = fileName.match(/^(\d+)/);
    if (match) {
      pageNumbers.push({ index: i + 1, num: parseInt(match[1], 10), fileName });
    }
  }

  // 3. slides/ 内の孤立スライド（登録漏れ）の検知
  if (fs.existsSync(slidesDirPath)) {
    const actualFiles = fs.readdirSync(slidesDirPath);
    const slideHtmlFiles = actualFiles.filter(f => /^\d+_.*\.html$/.test(f));

    for (const file of slideHtmlFiles) {
      if (!registeredFiles.has(file)) {
        reportWarning(`slides/ ディレクトリに存在するファイルが slide_config.js に登録されていません: slides/${file}`);
      }
    }
  }

  // 4. 連番の重複・欠番チェック
  for (let i = 0; i < pageNumbers.length; i++) {
    const expected = i + 1;
    const actual = pageNumbers[i].num;
    if (actual !== expected) {
      reportWarning(`スライド順序とファイル名連番の不一致: ${i + 1}番目のスライド (${pageNumbers[i].fileName}) の番号が ${actual} になっています（期待値: ${expected}）`);
    }
  }

  // 5. slide_config.css の --total-slides の値と実際の枚数の一致確認
  if (fs.existsSync(configCssPath)) {
    const cssContent = fs.readFileSync(configCssPath, 'utf-8');
    const totalMatch = cssContent.match(/--total-slides:\s*["']?(\d+)["']?/);
    if (totalMatch) {
      const cssTotal = parseInt(totalMatch[1], 10);
      if (cssTotal !== registeredSlides.length) {
        reportError(`slide_config.css の --total-slides (${cssTotal}) と実際の登録枚数 (${registeredSlides.length}) が一致していません。`);
      } else {
        console.log(`✔ slide_config.css の総スライド数設定と一致 (--total-slides: "${cssTotal}")`);
      }
    } else {
      reportWarning('slide_config.css 内に --total-slides の定義が見つかりませんでした。');
    }
  } else {
    reportWarning(`slide_config.css が見つかりません: ${configCssPath}`);
  }

  // 6. スライドHTMLおよび設定ファイル内の絶対パス混入チェック
  console.log('🔍 スライドファイル内の絶対パス混入を検査中...');
  const filesToCheck = [];

  if (fs.existsSync(configJsPath)) filesToCheck.push(configJsPath);
  if (fs.existsSync(configCssPath)) filesToCheck.push(configCssPath);
  if (fs.existsSync(slidesDirPath)) {
    const htmlFiles = fs.readdirSync(slidesDirPath).filter(f => f.endsWith('.html'));
    for (const file of htmlFiles) {
      filesToCheck.push(path.join(slidesDirPath, file));
    }
  }
  if (fs.existsSync(demosDirPath)) {
    const demoHtmlFiles = fs.readdirSync(demosDirPath).filter(f => f.endsWith('.html'));
    for (const file of demoHtmlFiles) {
      filesToCheck.push(path.join(demosDirPath, file));
    }
  }

  const absolutePatterns = [
    { regex: /file:\/\/\/[^\s"'<>)]+/i, label: 'file:/// スキーム' },
    { regex: /(?:\/home\/|\/Users\/)[^\s"'<>)]+/i, label: 'Linux/Mac ローカル絶対パス (/home/ または /Users/)' },
    { regex: /(?:^|["'\s(=])(?:[a-zA-Z]:[\\/])[^\s"'<>)]+/i, label: 'Windows ドライブレター絶対パス (C:\\等)' },
    { regex: /(?:src|href)\s*=\s*["']\/(?!\/)[^"']*["']/i, label: 'ルート絶対パス (例: src="/...")' },
    { regex: /url\(\s*["']?\/(?!\/)[^"')]+["']?\)/i, label: 'CSSルート絶対パス (例: url(/...))' }
  ];

  let absolutePathCount = 0;
  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const relName = path.relative(targetDeckDir, filePath);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      for (const pattern of absolutePatterns) {
        const match = line.match(pattern.regex);
        if (match) {
          reportError(`${relName}:${lineIdx + 1} に ${pattern.label} が検出されました: "${match[0].trim()}"`);
          absolutePathCount++;
        }
      }
    }
  }

  if (absolutePathCount === 0) {
    console.log('✔ すべてのファイルで環境依存の絶対パスは検出されませんでした (すべてポータブルな相対パス)');
  }

  // 7. スライドHTML内のスクロールバー誘発・オーバーフロー静的検査
  console.log('🔍 スライドファイル内のスクロールバー誘発要因を検査中...');
  const scrollbarRiskPatterns = [
    { regex: /\b100vw\b/i, label: '100vw (iframe内ではスクロールバーを誘発するため 100% を推奨)' },
    { regex: /overflow\s*:\s*scroll\b/i, label: 'overflow: scroll (スクロールバーが強制表示されるため auto または hidden を推奨)' }
  ];

  let scrollbarWarningCount = 0;
  if (fs.existsSync(slidesDirPath)) {
    const slideFiles = fs.readdirSync(slidesDirPath).filter(f => f.endsWith('.html'));
    for (const file of slideFiles) {
      const filePath = path.join(slidesDirPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        for (const pattern of scrollbarRiskPatterns) {
          const match = line.match(pattern.regex);
          if (match) {
            reportWarning(`slides/${file}:${lineIdx + 1} に ${pattern.label} が検出されました`);
            scrollbarWarningCount++;
          }
        }
      }
    }
  }

  if (scrollbarWarningCount === 0) {
    console.log('✔ スクロールバーを誘発する非推奨スタイル (100vw / overflow:scroll 等) は検出されませんでした');
  }

  // 8. デザイン・コーディング規約の静的検査
  console.log('🔍 デザイン規約（絵文字、左ボーダー、ヘッダー装飾、h1構造）を検査中...');
  let designRuleViolations = 0;

  if (fs.existsSync(slidesDirPath)) {
    const slideFiles = fs.readdirSync(slidesDirPath).filter(f => f.endsWith('.html'));

    // 絵文字検知正規表現（Unicode Extended_Pictographic により、装飾絵文字のみを正確に検知し、矢印や対比記号は除外）
    const emojiRegex = /\p{Extended_Pictographic}/u;
    // 左ボーダー強調スタイル検知（border-left または border-inline-start で 0/none/transparent 以外）
    const leftBorderRegex = /(?:border-left|border-inline-start)\s*:\s*(?!none\b|0\b|transparent\b)[^;}"'>]+/i;
    // ヘッダー余剰装飾クラス検知
    const forbiddenHeaderClassRegex = /class\s*=\s*["'][^"']*\b(?:slide-tag|slide-category)\b[^"']*["']/i;

    for (const file of slideFiles) {
      const filePath = path.join(slidesDirPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const relPath = `slides/${file}`;

      // h1 タグのカウント
      const h1Matches = content.match(/<h1[\s>]/gi) || [];
      if (h1Matches.length === 0) {
        reportWarning(`${relPath}: <h1> タイトルが存在しません`);
        designRuleViolations++;
      } else if (h1Matches.length > 1) {
        reportWarning(`${relPath}: <h1> タイトルが複数 (${h1Matches.length}個) 存在します`);
        designRuleViolations++;
      }

      // 行単位の検査
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];

        // 絵文字検査（コメント行はスキップ）
        if (!line.trim().startsWith('<!--')) {
          const emojiMatch = line.match(emojiRegex);
          if (emojiMatch) {
            reportError(`${relPath}:${lineIdx + 1} に絵文字が検出されました: "${emojiMatch[0]}" (規約違反: 絵文字の装飾利用は禁止です)`);
            designRuleViolations++;
          }
        }

        // 左ボーダー強調検査
        const borderMatch = line.match(leftBorderRegex);
        if (borderMatch) {
          reportError(`${relPath}:${lineIdx + 1} に左ボーダー強調スタイルが検出されました: "${borderMatch[0].trim()}" (規約違反: 左ボーダー強調デザインは禁止です)`);
          designRuleViolations++;
        }

        // ヘッダー余剰装飾クラス検査
        if (forbiddenHeaderClassRegex.test(line)) {
          reportError(`${relPath}:${lineIdx + 1} に禁止された装飾クラス (slide-tag / slide-category) が残存しています (規約違反: ヘッダーはh1のみで構成してください)`);
          designRuleViolations++;
        }
      }
    }
  }

  if (designRuleViolations === 0) {
    console.log('✔ デザイン規約（絵文字なし、左ボーダーなし、ヘッダー装飾なし、h1単一）にすべて適合しています');
  }

  // 9. 動的レンダリング検証（--browser オプション時）
  if (isBrowserMode) {
    console.log('\n🌐 ヘッドレスブラウザによる動的レンダリング・はみ出し検証を開始します...');
    await runBrowserVerification(registeredSlides);
  }

  // 判定
  console.log('\n----------------------------------------');
  if (hasError) {
    console.error('❌ 検証に失敗しました。上記のエラーを修正してください。\n');
    process.exit(1);
  } else {
    console.log('✔ すべての整合性チェックに合格しました。\n');
    process.exit(0);
  }
}

// ----------------------------------------------------
// 動的レンダリング検証（Chromium CDP）
// ----------------------------------------------------
async function runBrowserVerification(slides) {
  const DEBUG_PORT = 9300 + Math.floor(Math.random() * 500);

  // 1. Chromium ヘッドレス起動
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

  // 2. デバッグポート接続待機
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
    reportWarning('Chromiumのデバッグポートに接続できなかったため、ブラウザ検証をスキップします。');
    cleanup();
    return;
  }

  // 3. WebSocket 接続
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
  await sendSession('Runtime.enable');

  // スライドの標準解像度 (1920x1080) にビューポートを強制固定
  await sendSession('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  });

  // コンソールエラーの捕捉
  let consoleErrors = [];
  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params?.exceptionDetails?.text || 'JS Error';
        consoleErrors.push(desc);
      }
    } catch (_) {}
  });

  let browserErrorCount = 0;

  for (let idx = 0; idx < slides.length; idx++) {
    const slide = slides[idx];
    const fullHtmlPath = path.resolve(targetDeckDir, slide.url);
    if (!fs.existsSync(fullHtmlPath)) continue;

    const fileUrl = `file://${fullHtmlPath}`;
    consoleErrors = [];

    await sendSession('Page.navigate', { url: fileUrl });
    await sleep(600);

    // スライドコンテナのオーバーフロー検査
    const evalResult = await sendSession('Runtime.evaluate', {
      expression: `
        (() => {
          const container = document.querySelector('.slide-container') || document.body;
          const body = document.querySelector('.slide-body, .slide-content');
          const footer = document.querySelector('.slide-footer');

          const scrollWidth = container.scrollWidth;
          const scrollHeight = container.scrollHeight;
          const clientWidth = container.clientWidth;
          const clientHeight = container.clientHeight;

          const isOverflowX = scrollWidth > clientWidth + 2;
          let isOverflowY = scrollHeight > clientHeight + 2;
          let bodyOverflowDiff = 0;

          // コンテンツ枠（.slide-body）自体のスクロールはみ出し検査
          if (body && body.scrollHeight > body.clientHeight + 2) {
            isOverflowY = true;
            bodyOverflowDiff = body.scrollHeight - body.clientHeight;
          }

          // フッター境界線へのコンテンツ要素のめり込み検査
          const footerOverlaps = [];
          if (footer) {
            const footerTop = footer.getBoundingClientRect().top;
            const allElements = (body || container).querySelectorAll('*');
            allElements.forEach(el => {
              if (el === footer || footer.contains(el)) return;
              // 子要素を持つ親コンテナは除外し、末端に近い要素または主要カードを記録
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return;
              if (r.bottom > footerTop + 2) {
                const className = (el.className || '').toString().trim();
                footerOverlaps.push({
                  tag: el.tagName.toLowerCase(),
                  className,
                  diff: Math.round(r.bottom - footerTop)
                });
              }
            });
          }

          // 意図しない複数行折り返し（見出し・バッジ・タグ等）の検出
          const wrappedElements = [];
          // titlebar, title-row などのコンテナ枠ではなく、テキスト・見出し・バッジ要素を対象とする
          const targets = document.querySelectorAll('h2, h3, [class*="title"], [class*="heading"], [class*="badge"], [class*="tag"]');
          targets.forEach(el => {
            if (el.tagName === 'H1' || !el.textContent.trim()) return;
            // 内部に別の見出しや段落、リスト等を持つ大枠コンテナは除外
            if (el.querySelector('h1, h2, h3, h4, p, ul, ol')) return;
            // レイアウト枠（-row, -bar, -container, -wrapper, -box）で子要素を持つ場合は除外
            const className = (el.className || '').toString();
            if (el.children.length > 0 && /-(?:row|bar|container|wrap|wrapper|box|group|layout)\b/i.test(className)) return;

            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return;

            const range = document.createRange();
            range.selectNodeContents(el);
            const rects = Array.from(range.getClientRects());
            if (rects.length <= 1) return;

            const fontSize = parseFloat(style.fontSize) || 16;
            const lineThreshold = fontSize * 0.7; // 行送りの判定閾値

            // 物理的な行（異なるY座標）を算出
            const lineTops = [];
            for (const r of rects) {
              if (r.width < 1 || r.height < 1) continue; // 不可視の空白Rectは無視
              if (!lineTops.some(top => Math.abs(top - r.top) < lineThreshold)) {
                lineTops.push(r.top);
              }
            }

            if (lineTops.length > 1) {
              wrappedElements.push({
                tag: el.tagName.toLowerCase(),
                className: className.trim(),
                text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 35),
                lines: lineTops.length
              });
            }
          });

          // 各スライド固有の <style> 内における「完全未使用セレクタ（死骸CSS）」の検査
          const unusedCssRules = [];
          const localStyleElements = Array.from(document.querySelectorAll('style'));
          localStyleElements.forEach(styleEl => {
            const sheet = styleEl.sheet;
            if (!sheet) return;
            try {
              const rules = Array.from(sheet.cssRules || []);
              rules.forEach(rule => {
                // 通常のCSSStyleRule (type === 1) のみ対象
                if (rule.type !== 1 || !rule.selectorText) return;
                const selectors = rule.selectorText.split(',').map(s => s.trim());
                selectors.forEach(sel => {
                  // 擬似要素・擬似クラス（:hover, ::before 等）を除去して基底セレクタを抽出
                  const base = sel.replace(/::?[a-zA-Z-]+(?:\([^)]*\))?/g, '').trim();
                  if (!base) return;

                  // 動的付与クラス（.active, .is-*, .open 等）が含まれる複合セレクタは静的基底で検査
                  const staticBase = base
                    .replace(/\.(?:active|selected|open|visible|hidden|current|is-[a-zA-Z0-9_-]+)\b/g, '')
                    .trim();
                  const targetSel = staticBase || base;

                  try {
                    if (document.querySelectorAll(targetSel).length === 0) {
                      unusedCssRules.push(sel);
                    }
                  } catch (_) {}
                });
              });
            } catch (_) {}
          });

          return {
            isOverflowX,
            isOverflowY,
            bodyOverflowDiff,
            scrollWidth,
            clientWidth,
            scrollHeight,
            clientHeight,
            footerOverlaps,
            wrappedElements,
            unusedCssRules
          };
        })()
      `,
      returnByValue: true
    });

    const metrics = evalResult?.result?.value;
    const slideLabel = `[${String(idx + 1).padStart(2, '0')}] ${slide.url}`;

    if (metrics) {
      if (metrics.bodyOverflowDiff > 0) {
        reportError(`${slideLabel}: コンテンツ枠(.slide-body)の垂直はみ出し検知 (+${metrics.bodyOverflowDiff}px 見切れ)`);
        browserErrorCount++;
      } else if (metrics.isOverflowY) {
        reportError(`${slideLabel}: 垂直方向のコンテンツはみ出し検知 (scrollHeight: ${metrics.scrollHeight}px > clientHeight: ${metrics.clientHeight}px)`);
        browserErrorCount++;
      }
      if (metrics.isOverflowX) {
        reportError(`${slideLabel}: 水平方向のコンテンツはみ出し検知 (scrollWidth: ${metrics.scrollWidth}px > clientWidth: ${metrics.clientWidth}px)`);
        browserErrorCount++;
      }
      if (metrics.footerOverlaps && metrics.footerOverlaps.length > 0) {
        const topOverlap = metrics.footerOverlaps[metrics.footerOverlaps.length - 1];
        reportError(`${slideLabel}: フッター領域へのコンテンツめり込み検知 (+${topOverlap.diff}px 侵食): <${topOverlap.tag} class="${topOverlap.className}">`);
        browserErrorCount++;
      }
      if (metrics.wrappedElements && metrics.wrappedElements.length > 0) {
        for (const w of metrics.wrappedElements) {
          reportWarning(`${slideLabel}: 見出し/バッジの改行検知 (${w.lines}行): <${w.tag} class="${w.className}"> "${w.text}"`);
        }
      }
      if (metrics.unusedCssRules && metrics.unusedCssRules.length > 0) {
        for (const unused of metrics.unusedCssRules) {
          reportWarning(`${slideLabel}: <style>内にHTML要素と紐付かない未使用CSS定義が残存しています: "${unused}"`);
        }
      }
    }

    if (consoleErrors.length > 0) {
      for (const err of consoleErrors) {
        reportError(`${slideLabel}: コンソールエラー検知 "${err}"`);
        browserErrorCount++;
      }
    }

    if (!metrics?.isOverflowX && !metrics?.isOverflowY && (!metrics?.footerOverlaps || metrics.footerOverlaps.length === 0) && consoleErrors.length === 0) {
      console.log(`  ✔ ${slideLabel}: レイアウト収束・エラーなし`);
    }
  }

  cleanup();

  if (browserErrorCount === 0) {
    console.log('✔ すべてのスライドで実機レンダリング・はみ出し検証に合格しました');
  }
}

runCheck().catch(err => {
  console.error('実行時エラー:', err);
  process.exit(1);
});

