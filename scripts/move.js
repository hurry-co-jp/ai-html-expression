import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runSync, resolveDeckDir, getAvailableDecks } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function showHelpAndExit(errorMessage = '') {
  if (errorMessage) {
    console.error(`エラー: ${errorMessage}\n`);
  }
  console.log('スライド移動ツール (move.js)\n');
  console.log('指定したスライドを別の位置へ安全に移動し、間のスライド番号と設定を自動連動更新します。\n');
  console.log('使用方法:');
  console.log('  node scripts/move.js --from <移動元番号> --to <移動先番号> [--dir <ディレクトリ>]\n');
  console.log('使用例:');
  console.log('  node scripts/move.js --from 8 --to 3   # 8ページ目を3ページ目に移動（3〜7は後ろへシフト）');
  console.log('  node scripts/move.js --from 2 --to 5   # 2ページ目を5ページ目に移動（3〜5は前へシフト）');
  console.log('\n※ ディレクトリ未指定時はカレントディレクトリを自動対象とします。');
  console.log('');
  process.exit(errorMessage ? 1 : 0);
}

let values;
try {
  const parsed = parseArgs({
    options: {
      dir: { type: 'string' },
      deck: { type: 'string', short: 'd' },
      from: { type: 'string', short: 'f' },
      to: { type: 'string', short: 't' },
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

if (!values.from) {
  showHelpAndExit('--from オプションは必須です。');
}

if (!values.to) {
  showHelpAndExit('--to オプションは必須です。');
}

const fromIndex = parseInt(values.from, 10);
const toIndex = parseInt(values.to, 10);

if (isNaN(fromIndex) || fromIndex <= 0) {
  showHelpAndExit('--from には 1 以上の整数を指定してください。');
}

if (isNaN(toIndex) || toIndex <= 0) {
  showHelpAndExit('--to には 1 以上の整数を指定してください。');
}

const targetPath = values.dir || values.deck;
const targetDeckDir = resolveDeckDir(targetPath);
if (!targetDeckDir) {
  showHelpAndExit(targetPath ? `指定されたディレクトリ "${targetPath}" が見つかりません。` : '有効なスライドディレクトリが見つかりません。--dir で指定してください。');
}

const deckName = path.basename(targetDeckDir);
const slidesDir = path.join(targetDeckDir, 'slides');
const slideAssetsDir = path.join(targetDeckDir, 'assets', 'slides');

function safeRename(oldPath, newPath) {
  fs.renameSync(oldPath, newPath);
}

function getSlideFiles() {
  return fs.readdirSync(slidesDir)
    .filter(f => f.endsWith('.html') && /^\d+/.test(f))
    .map(f => ({
      name: f,
      num: parseInt(f.match(/^(\d+)/)[1], 10),
      suffix: f.replace(/^\d+/, '')
    }))
    .sort((a, b) => a.num - b.num);
}

async function runMove() {
  if (fromIndex === toIndex) {
    console.log(`移動元 (${fromIndex}) と移動先 (${toIndex}) が同一のため、移動処理は不要です。`);
    return;
  }

  const files = getSlideFiles();
  const totalSlides = files.length;

  const targetItem = files.find(f => f.num === fromIndex);
  if (!targetItem) {
    console.error(`エラー: 移動元番号 ${fromIndex} のスライドが見つかりません。（現在の登録枚数: ${totalSlides} 枚）`);
    process.exit(1);
  }

  if (toIndex > totalSlides) {
    console.error(`エラー: 移動先番号 ${toIndex} が現在の総スライド数 (${totalSlides} 枚) を超えています。`);
    process.exit(1);
  }

  console.log('========================================================');
  console.log(`スライド移動処理を開始します: ${deckName}`);
  console.log(`移動対象: [${String(fromIndex).padStart(2, '0')}] ${targetItem.name} ➔ 位置: [${String(toIndex).padStart(2, '0')}]`);
  console.log('========================================================\n');

  // 1. 移動対象スライドの一時退避
  const tempSlideName = `__temp_moving_slide_${Date.now()}__.html`;
  const originalSlidePath = path.join(slidesDir, targetItem.name);
  const tempSlidePath = path.join(slidesDir, tempSlideName);

  safeRename(originalSlidePath, tempSlidePath);
  console.log(`[1/3] 移動対象スライドを一時退避しました: ${targetItem.name}`);

  // アセットフォルダが存在すれば一時退避
  const origAssetDir = path.join(slideAssetsDir, String(fromIndex).padStart(2, '0'));
  const tempAssetDir = path.join(slideAssetsDir, `__temp_moving_assets_${Date.now()}__`);
  let hasAsset = false;
  if (fs.existsSync(origAssetDir)) {
    safeRename(origAssetDir, tempAssetDir);
    hasAsset = true;
    console.log(`      アセットフォルダを一時退避しました: ${path.basename(origAssetDir)}`);
  }

  // 2. 中間スライドのシフト
  console.log('\n[2/3] 中間スライドの番号を順次シフト中...');
  if (fromIndex > toIndex) {
    // 後ろから前へ移動: toIndex <= num < fromIndex を逆順（降順）に +1
    const shiftTargets = files
      .filter(f => f.num >= toIndex && f.num < fromIndex)
      .sort((a, b) => b.num - a.num);

    for (const item of shiftTargets) {
      const nextNum = item.num + 1;
      const oldPath = path.join(slidesDir, item.name);
      const newName = `${String(nextNum).padStart(2, '0')}${item.suffix}`;
      const newPath = path.join(slidesDir, newName);

      safeRename(oldPath, newPath);
      console.log(`  繰り下げ: ${item.name} ➔ ${newName}`);

      // アセットフォルダの連動リネーム
      const curAsset = path.join(slideAssetsDir, String(item.num).padStart(2, '0'));
      const nextAsset = path.join(slideAssetsDir, String(nextNum).padStart(2, '0'));
      if (fs.existsSync(curAsset)) {
        safeRename(curAsset, nextAsset);
        console.log(`    アセット連動: ${path.basename(curAsset)} ➔ ${path.basename(nextAsset)}`);
      }
    }
  } else {
    // 前から後ろへ移動: fromIndex < num <= toIndex を正順（昇順）に -1
    const shiftTargets = files
      .filter(f => f.num > fromIndex && f.num <= toIndex)
      .sort((a, b) => a.num - b.num);

    for (const item of shiftTargets) {
      const prevNum = item.num - 1;
      const oldPath = path.join(slidesDir, item.name);
      const newName = `${String(prevNum).padStart(2, '0')}${item.suffix}`;
      const newPath = path.join(slidesDir, newName);

      safeRename(oldPath, newPath);
      console.log(`  繰り上げ: ${item.name} ➔ ${newName}`);

      // アセットフォルダの連動リネーム
      const curAsset = path.join(slideAssetsDir, String(item.num).padStart(2, '0'));
      const prevAsset = path.join(slideAssetsDir, String(prevNum).padStart(2, '0'));
      if (fs.existsSync(curAsset)) {
        safeRename(curAsset, prevAsset);
        console.log(`    アセット連動: ${path.basename(curAsset)} ➔ ${path.basename(prevAsset)}`);
      }
    }
  }

  // 3. 一時退避したファイルを目的位置へ配置
  const finalSlideName = `${String(toIndex).padStart(2, '0')}${targetItem.suffix}`;
  const finalSlidePath = path.join(slidesDir, finalSlideName);
  safeRename(tempSlidePath, finalSlidePath);
  console.log(`\n[3/3] 移動対象スライドを目的位置に配置しました: ${finalSlideName}`);

  if (hasAsset) {
    const finalAssetDir = path.join(slideAssetsDir, String(toIndex).padStart(2, '0'));
    safeRename(tempAssetDir, finalAssetDir);
    console.log(`      アセットフォルダを目的位置に配置しました: ${path.basename(finalAssetDir)}`);
  }

  console.log('\n設定ファイル (slide_config.js / slide_config.css) を同期中...');
  await runSync(targetDeckDir);

  console.log('\n========================================================');
  console.log(`✔ スライドの移動が正常に完了しました: ${deckName}`);
  console.log('========================================================\n');
}

runMove().catch(err => {
  console.error('スライド移動処理中に致命的なエラーが発生しました:', err);
  process.exit(1);
});
