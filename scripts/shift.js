import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runSync, resolveDeckDir, getAvailableDecks, findSkillRootDir } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function showHelpAndExit(errorMessage = '') {
  if (errorMessage) {
    console.error(`エラー: ${errorMessage}\n`);
  }
  console.log('使用方法:');
  console.log('  スライド途中挿入: node scripts/shift.js insert --index <挿入番号> [--slug <識別名>] [--type <bullet|divider|image>] [--dir <ディレクトリ>]');
  console.log('    例: node scripts/shift.js insert --index 5 --slug topic_detail');
  console.log('    例: node scripts/shift.js insert --index 5 --slug section_title --type divider');
  console.log('    例: node scripts/shift.js insert --index 1 --slug cover_image --type image');
  console.log('  スライド削除:     node scripts/shift.js remove --index <削除番号> [--dir <ディレクトリ>]');
  console.log('    例: node scripts/shift.js remove --index 5');
  console.log('\n※ ディレクトリ未指定時はカレントディレクトリを自動対象とします。');
  process.exit(1);
}

const action = process.argv[2]; // 'insert' または 'remove'
if (!action || (action !== 'insert' && action !== 'remove') || action === '--help' || action === '-h') {
  showHelpAndExit();
}

let values;
try {
  const parsed = parseArgs({
    args: process.argv.slice(3),
    options: {
      dir: { type: 'string' },
      deck: { type: 'string', short: 'd' },
      index: { type: 'string', short: 'i' },
      slug: { type: 'string', short: 's' },
      type: { type: 'string', short: 't' },
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

if (!values.index) {
  showHelpAndExit('--index オプションは必須です。');
}

const targetIndex = parseInt(values.index, 10);
if (isNaN(targetIndex) || targetIndex <= 0) {
  showHelpAndExit('--index には 1 以上の整数を指定してください。');
}

const slideSlug = values.slug || 'new_slide';
const slideType = values.type || 'bullet';

const slidesDir = path.join(targetDeckDir, 'slides');

function safeRename(oldPath, newPath) {
  // 常に標準の fs.renameSync でリネーム
  fs.renameSync(oldPath, newPath);
}

function safeRemove(filePath) {
  fs.unlinkSync(filePath);
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

function getTemplateContent(type, slug) {
  const skillRootDir = findSkillRootDir();
  const templatePath = path.join(skillRootDir, 'templates', `${type}.html`);

  if (fs.existsSync(templatePath)) {
    const raw = fs.readFileSync(templatePath, 'utf-8');
    return raw
      .replaceAll('{{title}}', slug)
      .replaceAll('{{slug}}', slug);
  }

  // フォールバック（従来通りの箇条書きテンプレート）
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${slug}</title>
  <link rel="stylesheet" href="../css/style.css">
  <script src="../js/slide.js"></script>
</head>
<body>
  <div class="slide-container">
    <header class="slide-header">
      <h1 class="slide-title">${slug}</h1>
      <div class="slide-logo"></div>
    </header>

    <main class="slide-content">
      <ul class="bullet-list">
        <li>
          主要な論点やトピックの提示
          <ul class="sub-list">
            <li>詳細な補足情報や具体的な背景の解説</li>
            <li>論拠となる事実やデータの提示</li>
          </ul>
        </li>
        <li>
          施策やアクションプランの要点
          <ul class="sub-list">
            <li>次のステップへ繋がる具体的な実行項目</li>
            <li>関係者との連携方針や期待される効果</li>
          </ul>
        </li>
      </ul>
    </main>

    <footer class="slide-footer"></footer>
  </div>
</body>
</html>
`;
}

async function handleInsert() {
  console.log(`スライド挿入処理を開始: インデックス ${targetIndex} (${slideSlug}, type: ${slideType}) in ${path.basename(targetDeckDir)}`);

  const files = getSlideFiles();
  // targetIndex 以上のファイルを降順（末尾から）にシフト
  const toShift = files.filter(f => f.num >= targetIndex).sort((a, b) => b.num - a.num);

  console.log(`既存スライドを末尾から降順シフトします (${toShift.length} 件)...`);
  for (const item of toShift) {
    const nextNum = item.num + 1;
    const oldPath = path.join(slidesDir, item.name);
    const newName = `${String(nextNum).padStart(2, '0')}${item.suffix}`;
    const newPath = path.join(slidesDir, newName);

    console.log(`  シフト: ${item.name} ➔ ${newName}`);
    safeRename(oldPath, newPath);

    // アセットフォルダ (assets/slides/XX) が存在していれば連動シフト
    const slideAssetsDir = path.join(targetDeckDir, 'assets', 'slides');
    const oldAssetDir = path.join(slideAssetsDir, String(item.num).padStart(2, '0'));
    const newAssetDir = path.join(slideAssetsDir, String(nextNum).padStart(2, '0'));
    if (fs.existsSync(oldAssetDir)) {
      safeRename(oldAssetDir, newAssetDir);
      console.log(`  アセット連動シフト: ${path.basename(oldAssetDir)} ➔ ${path.basename(newAssetDir)}`);
    }
  }

  // 空いた位置にテンプレートHTMLを作成
  const createdFileName = `${String(targetIndex).padStart(2, '0')}_${slideSlug}.html`;
  const createdFilePath = path.join(slidesDir, createdFileName);

  const templateContent = getTemplateContent(slideType, slideSlug);

  fs.writeFileSync(createdFilePath, templateContent, 'utf-8');
  console.log(`新規スライドを作成しました: ${createdFileName} (type: ${slideType})`);

  // 設定と枚数を即座に同期
  await runSync(targetDeckDir);
}

async function handleRemove() {
  console.log(`スライド削除処理を開始: インデックス ${targetIndex} in ${path.basename(targetDeckDir)}`);

  const files = getSlideFiles();
  const targetFile = files.find(f => f.num === targetIndex);

  if (!targetFile) {
    console.error(`エラー: 番号 ${targetIndex} のスライドが見つかりません。`);
    process.exit(1);
  }

  const targetPath = path.join(slidesDir, targetFile.name);
  console.log(`スライドを削除します: ${targetFile.name}`);
  safeRemove(targetPath);

  // 削除対象のアセットフォルダが存在していれば削除
  const slideAssetsDir = path.join(targetDeckDir, 'assets', 'slides');
  const targetAssetDir = path.join(slideAssetsDir, String(targetIndex).padStart(2, '0'));
  if (fs.existsSync(targetAssetDir)) {
    fs.rmSync(targetAssetDir, { recursive: true, force: true });
    console.log(`  アセットフォルダを削除しました: ${path.basename(targetAssetDir)}`);
  }

  // targetIndex より大きいファイルを昇順（若い番号から）に前詰めシフト
  const toShift = files.filter(f => f.num > targetIndex).sort((a, b) => a.num - b.num);

  console.log(`後続スライドを昇順に前詰めシフトします (${toShift.length} 件)...`);
  for (const item of toShift) {
    const nextNum = item.num - 1;
    const oldPath = path.join(slidesDir, item.name);
    const newName = `${String(nextNum).padStart(2, '0')}${item.suffix}`;
    const newPath = path.join(slidesDir, newName);

    console.log(`  前詰め: ${item.name} ➔ ${newName}`);
    safeRename(oldPath, newPath);

    // アセットフォルダも連動して前詰め
    const oldAssetDir = path.join(slideAssetsDir, String(item.num).padStart(2, '0'));
    const newAssetDir = path.join(slideAssetsDir, String(nextNum).padStart(2, '0'));
    if (fs.existsSync(oldAssetDir)) {
      safeRename(oldAssetDir, newAssetDir);
      console.log(`  アセット連動前詰め: ${path.basename(oldAssetDir)} ➔ ${path.basename(newAssetDir)}`);
    }
  }

  // 設定と枚数を即座に同期
  await runSync(targetDeckDir);
}

if (action === 'insert') {
  handleInsert().catch(err => {
    console.error('挿入処理中にエラーが発生しました:', err);
    process.exit(1);
  });
} else if (action === 'remove') {
  handleRemove().catch(err => {
    console.error('削除処理中にエラーが発生しました:', err);
    process.exit(1);
  });
}
