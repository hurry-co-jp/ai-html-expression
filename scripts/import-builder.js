import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolveDeckDir, runSync, getAvailableDecks } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function showHelpAndExit(errorMessage = '') {
  if (errorMessage) {
    console.error(`エラー: ${errorMessage}\n`);
  }
  console.log('使用方法:');
  console.log('  node scripts/import-builder.js --file <ZIPパス> --deck <デッキ名> [--index <挿入番号>] [--slug <識別名>]');
  console.log('例:');
  console.log('  末尾に追加: node scripts/import-builder.js --file ~/Downloads/slide_project.zip --deck sample');
  console.log('  3番に挿入:  node scripts/import-builder.js --file ~/Downloads/slide_project.zip --deck sample --index 3 --slug solution_flow');
  console.log('\n※ 位置引数は使用できません。必ず --file と --deck を指定してください。');
  console.log('\n利用可能なデッキ一覧:');
  for (const deck of getAvailableDecks()) {
    console.log(`  - ${deck}`);
  }
  process.exit(1);
}

let values;
try {
  const parsed = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      dir: { type: 'string' },
      deck: { type: 'string', short: 'd' },
      index: { type: 'string', short: 'i' },
      slug: { type: 'string', short: 's' },
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

if (!values.file) {
  showHelpAndExit('--file オプション（ZIPファイルのパス）は必須です。');
}

const targetPath = values.dir || values.deck;
if (!targetPath) {
  showHelpAndExit('--dir または --deck オプションは必須です。');
}

const zipPath = path.resolve(process.cwd(), values.file);
if (!fs.existsSync(zipPath)) {
  showHelpAndExit(`指定されたZIPファイルが見つかりません: ${zipPath}`);
}

const targetDeckDir = resolveDeckDir(values.deck);
if (!targetDeckDir) {
  showHelpAndExit(`指定されたデッキ "${values.deck}" が見つかりません。`);
}

const deckName = path.basename(targetDeckDir);
const slidesDir = path.join(targetDeckDir, 'slides');
const slugArg = values.slug || 'builder_slide';

// 既存スライド一覧の取得
function getExistingSlideNumbers() {
  if (!fs.existsSync(slidesDir)) return [];
  return fs.readdirSync(slidesDir)
    .filter(f => f.endsWith('.html') && /^\d+/.test(f))
    .map(f => parseInt(f.match(/^(\d+)/)[1], 10))
    .sort((a, b) => a - b);
}

const existingNumbers = getExistingSlideNumbers();

// 挿入番号の決定（指定がなければ末尾）
let targetIndex;
if (values.index && !isNaN(parseInt(values.index, 10))) {
  targetIndex = parseInt(values.index, 10);
  if (targetIndex <= 0) {
    showHelpAndExit('--index には 1 以上の整数を指定してください。');
  }
} else {
  targetIndex = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
}

const targetIndexStr = String(targetIndex).padStart(2, '0');
console.log(`========================================`);
console.log(`スライドビルダーZIPのインポートを開始します`);
console.log(`対象デッキ: ${deckName}`);
console.log(`スライド番号: ${targetIndexStr}`);
console.log(`識別名: ${slugArg}`);
console.log(`ZIPファイル: ${zipPath}`);
console.log(`========================================`);

// 1. shift.js insert でスライド枠を確保（既存番号なら自動でシフト）
console.log(`[1/4] スライドHTML枠を確保中 (shift.js insert)...`);
execSync(`node "${path.join(__dirname, 'shift.js')}" insert --deck "${deckName}" --index ${targetIndex} --slug "${slugArg}"`, {
  stdio: 'inherit'
});

// 2. アセット展開先ディレクトリを作成
const slideAssetsDir = path.join(targetDeckDir, 'assets', 'slides', targetIndexStr);
fs.mkdirSync(slideAssetsDir, { recursive: true });

// 3. ZIPファイルを解凍
console.log(`[2/4] アセットを展開中 ➔ assets/slides/${targetIndexStr}/...`);
const tempExtractDir = path.join(targetDeckDir, 'assets', 'slides', `_temp_${Date.now()}`);
fs.mkdirSync(tempExtractDir, { recursive: true });

try {
  execSync(`unzip -q -o "${zipPath}" -d "${tempExtractDir}"`, { stdio: 'inherit' });

  // assets/* を slideAssetsDir 直下へ移動
  const extractedAssetsDir = path.join(tempExtractDir, 'assets');
  if (fs.existsSync(extractedAssetsDir)) {
    const files = fs.readdirSync(extractedAssetsDir);
    for (const f of files) {
      fs.renameSync(path.join(extractedAssetsDir, f), path.join(slideAssetsDir, f));
    }
  }

  // preview.png があれば slideAssetsDir に配置
  const previewPath = path.join(tempExtractDir, 'preview.png');
  if (fs.existsSync(previewPath)) {
    fs.renameSync(previewPath, path.join(slideAssetsDir, 'preview.png'));
  }

  // ai_spec.md があれば slideAssetsDir に配置
  const aiSpecPath = path.join(tempExtractDir, 'ai_spec.md');
  if (fs.existsSync(aiSpecPath)) {
    fs.renameSync(aiSpecPath, path.join(slideAssetsDir, 'ai_spec.md'));
  }

  // project.json も念のため参照用に保存
  const projectJsonPath = path.join(tempExtractDir, 'project.json');
  if (fs.existsSync(projectJsonPath)) {
    fs.renameSync(projectJsonPath, path.join(slideAssetsDir, 'project.json'));
  }
} finally {
  // 一時解凍ディレクトリを削除
  if (fs.existsSync(tempExtractDir)) {
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
  }
}

// 4. 元のZIPファイルを削除
console.log(`[3/4] 元のZIPファイルを削除中...`);
fs.unlinkSync(zipPath);
console.log(`✔ ZIPファイルを削除しました: ${path.basename(zipPath)}`);

// 5. 設定と枚数を最終同期
console.log(`[4/4] スライド設定・枚数を同期中...`);
await runSync(targetDeckDir);

console.log(`\n========================================`);
console.log(`✔ インポートが正常に完了しました！`);
console.log(`  HTMLファイル: deck/${deckName}/slides/${targetIndexStr}_${slugArg}.html`);
console.log(`  アセット配置: deck/${deckName}/assets/slides/${targetIndexStr}/`);
const hasPreview = fs.existsSync(path.join(slideAssetsDir, 'preview.png'));
if (hasPreview) {
  console.log(`  プレビュー画像: deck/${deckName}/assets/slides/${targetIndexStr}/preview.png`);
}
const hasAiSpec = fs.existsSync(path.join(slideAssetsDir, 'ai_spec.md'));
if (hasAiSpec) {
  console.log(`  AI用構図仕様:   deck/${deckName}/assets/slides/${targetIndexStr}/ai_spec.md`);
}
console.log(`========================================\n`);
