import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolveDeckDir, getAvailableDecks } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptsDir = __dirname;

function showHelpAndExit(errorMessage = '') {
  if (errorMessage) {
    console.error(`エラー: ${errorMessage}\n`);
  }
  console.log('スライド一括ビルドツール (build.js)\n');
  console.log('完成したスライドデッキに対して、同期 ➔ 検証 ➔ サムネイル生成 ➔ PDF出力を一括実行します。\n');
  console.log('使用方法:');
  console.log('  node scripts/build.js --deck <デッキ名> [オプション]\n');
  console.log('使用例:');
  console.log('  node scripts/build.js --deck sample');
  console.log('  node scripts/build.js --deck sample --browser    # ブラウザでの実描画チェックも含める');
  console.log('\nオプション:');
  console.log('  -d, --deck <名前>       対象のデッキ名 (必須)');
  console.log('      --browser           チェック時にヘッドレスブラウザでリンク切れも検査');
  console.log('      --skip-capture      サムネイル撮影をスキップ');
  console.log('      --skip-pdf          PDF出力をスキップ');
  console.log('  -h, --help              ヘルプを表示');
  console.log('\n利用可能なデッキ一覧:');
  for (const deck of getAvailableDecks()) {
    console.log(`  - ${deck}`);
  }
  console.log('');
  process.exit(errorMessage ? 1 : 0);
}

let values;
try {
  const parsed = parseArgs({
    options: {
      deck: { type: 'string', short: 'd' },
      browser: { type: 'boolean' },
      'skip-capture': { type: 'boolean' },
      'skip-pdf': { type: 'boolean' },
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

if (!values.deck) {
  showHelpAndExit('--deck オプションは必須です。');
}

const deckArg = values.deck;
const targetDeckDir = resolveDeckDir(deckArg);
if (!targetDeckDir) {
  showHelpAndExit(`指定されたデッキ "${deckArg}" が見つかりません。`);
}

const deckName = path.basename(targetDeckDir);
const startTime = Date.now();

console.log('========================================================');
console.log(`スライド一括ビルドを開始します: ${deckName}`);
console.log('========================================================\n');

function runStep(stepNumber, totalSteps, title, scriptFile, args = []) {
  console.log(`--------------------------------------------------------`);
  console.log(`[${stepNumber}/${totalSteps}] ${title}`);
  console.log(`--------------------------------------------------------`);

  const fullScriptPath = path.join(scriptsDir, scriptFile);
  const result = spawnSync(process.execPath, [fullScriptPath, ...args], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..')
  });

  if (result.status !== 0) {
    console.error(`\nエラー: ステップ [${stepNumber}/${totalSteps}] "${title}" で失敗しました。処理を中断します。`);
    process.exit(result.status || 1);
  }
  console.log('');
}

const steps = [];

// 1. 同期
steps.push({
  title: '設定・スライド連番の同期 (sync.js)',
  script: 'sync.js',
  args: ['--deck', deckName]
});

// 2. 品質検証
const checkArgs = ['--deck', deckName];
if (values.browser) {
  checkArgs.push('--browser');
}
steps.push({
  title: 'スライド整合性・規約チェック (check-slides.js)',
  script: 'check-slides.js',
  args: checkArgs
});

// 3. サムネイル撮影
if (!values['skip-capture']) {
  steps.push({
    title: '全スライドサムネイル撮影 (capture-slides.js)',
    script: 'capture-slides.js',
    args: ['--deck', deckName]
  });
}

// 4. PDF出力
if (!values['skip-pdf']) {
  steps.push({
    title: '配布用PDFエクスポート (export-pdf.js)',
    script: 'export-pdf.js',
    args: ['--deck', deckName]
  });
}

const totalStepCount = steps.length;
steps.forEach((step, idx) => {
  runStep(idx + 1, totalStepCount, step.title, step.script, step.args);
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

console.log('========================================================');
console.log(`✔ 一括ビルドがすべて正常に完了しました (${elapsed}秒)`);
console.log(`デッキ名: ${deckName}`);
console.log(`保存場所: ${targetDeckDir}`);
console.log('========================================================\n');
