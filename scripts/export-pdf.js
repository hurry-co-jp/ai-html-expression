import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveDeckDir, getAvailableDecks } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function showHelpAndExit(errorMessage = '') {
  if (errorMessage) {
    console.error(`エラー: ${errorMessage}\n`);
  }
  console.log('使用方法:');
  console.log('  node scripts/export-pdf.js [--dir <ディレクトリ>]');
  console.log('例:');
  console.log('  node scripts/export-pdf.js');
  console.log('  node scripts/export-pdf.js --dir ./docs/slides/my-topic');
  console.log('\n※ ディレクトリ未指定時はカレントディレクトリを自動対象とします。');
  process.exit(1);
}

let values;
try {
  const parsed = parseArgs({
    options: {
      dir: { type: 'string' },
      deck: { type: 'string', short: 'd' },
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
const targetDeckDir = resolveDeckDir(targetPath);
if (!targetDeckDir) {
  showHelpAndExit(targetPath ? `指定されたディレクトリ "${targetPath}" が見つかりません。` : '有効なスライドディレクトリが見つかりません。--dir で指定してください。');
}

const configFilePath = path.join(targetDeckDir, 'slide_config.js');
const tempBundleHtml = path.join(targetDeckDir, 'print_bundle.tmp.html');

console.log(`PDFエクスポートを開始します: ${path.basename(targetDeckDir)}`);

// 1. slide_config.js のインポート
const configUrl = `file://${configFilePath}`;
const { slideDeckConfig } = await import(configUrl);

const defaultPdfName = `${path.basename(targetDeckDir)}.pdf`;
const rawPdfName = slideDeckConfig.pdfFileName || defaultPdfName;
const pdfFileName = rawPdfName.endsWith('.pdf') ? rawPdfName : `${rawPdfName}.pdf`;
const outputPdf = path.join(targetDeckDir, pdfFileName);

const rawSlides = slideDeckConfig.slides || [];

// skipPdf: true がついたスライドを除外
const pdfSlides = rawSlides.filter(slide => {
  if (typeof slide === 'object' && slide.skipPdf) {
    console.log(`  スライドスキップ (skipPdf: true): ${slide.url}`);
    return false;
  }
  return true;
});

const totalPdfSlides = pdfSlides.length;
console.log(`対象配布スライド: ${totalPdfSlides}枚 / 元全${rawSlides.length}枚`);
console.log(`出力ファイル名: ${pdfFileName}`);

// 2. 印刷用一括結合HTMLを作成
const bundleHtmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${slideDeckConfig.deckTitle || 'Slide Deck Print Bundle'}</title>
  <style>
    @page {
      size: 16in 9in;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: #ffffff;
    }
    .pdf-page {
      width: 16in;
      height: 9in;
      page-break-after: always;
      position: relative;
      overflow: hidden;
    }
    .pdf-page:last-child {
      page-break-after: avoid;
    }
    .pdf-frame {
      width: 1920px;
      height: 1080px;
      border: none;
      transform-origin: top left;
      transform: scale(0.8);
      position: absolute;
      top: 0;
      left: 0;
    }
  </style>
</head>
<body>
  ${pdfSlides.map((slide, i) => {
    const slideUrl = typeof slide === 'string' ? slide : slide.url;
    return `
    <div class="pdf-page">
      <iframe class="pdf-frame" src="${slideUrl}"></iframe>
    </div>`;
  }).join('\n')}
</body>
</html>`;

fs.writeFileSync(tempBundleHtml, bundleHtmlContent, 'utf-8');

// 3. ヘッドレスChromeによるPDF変換
try {
  let chromePath = '';
  const possiblePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      chromePath = p;
      break;
    }
  }

  if (!chromePath) {
    console.warn('Chrome/Chromiumのパスが見つかりません。');
    fs.unlinkSync(tempBundleHtml);
    process.exit(0);
  }

  console.log(`ヘッドレスブラウザでPDFレンダリング中... (${chromePath})`);

  const cmd = `"${chromePath}" --headless=new --disable-gpu --run-all-compositor-stages-before-draw --virtual-time-budget=12000 --print-to-pdf="${outputPdf}" --no-pdf-header-footer "file://${tempBundleHtml}"`;

  execSync(cmd, { stdio: 'inherit' });

  if (fs.existsSync(outputPdf)) {
    const stats = fs.statSync(outputPdf);
    console.log(`\nPDFエクスポート完了: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`保存先: ${outputPdf}`);
  }
} catch (error) {
  console.error('PDF生成中にエラーが発生しました:', error.message);
} finally {
  if (fs.existsSync(tempBundleHtml)) {
    fs.unlinkSync(tempBundleHtml);
  }
}
