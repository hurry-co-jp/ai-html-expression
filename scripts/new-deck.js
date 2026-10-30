import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runSync, getAvailableDecks } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(ROOT_DIR, 'template');
const DECK_DIR = path.join(ROOT_DIR, 'deck');

function showHelpAndExit(errorMessage = '') {
  if (errorMessage) {
    console.error(`エラー: ${errorMessage}\n`);
  }
  console.log('使用方法:');
  console.log('  pnpm new --name <デッキ名> [--title <スライドタイトル>]');
  console.log('例:');
  console.log('  pnpm new --name quarterly-report');
  console.log('  pnpm new --name quarterly-report --title "2026年 第3四半期 事業報告"');
  console.log('\n※ 位置引数は使用できません。必ず --name を指定してください。');
  console.log('\n現在のデッキ一覧:');
  for (const deck of getAvailableDecks()) {
    console.log(`  - ${deck}`);
  }
  process.exit(errorMessage ? 1 : 0);
}

let values;
try {
  const parsed = parseArgs({
    options: {
      name: { type: 'string', short: 'n' },
      title: { type: 'string', short: 't' },
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

if (!values.name) {
  showHelpAndExit('--name オプション（新規デッキのフォルダ名）は必須です。');
}

const deckName = values.name.trim();

// フォルダ名バリデーション
if (!/^[a-zA-Z0-9_\-]+$/.test(deckName)) {
  console.error(`エラー: デッキ名には半角英数字、ハイフン (-)、アンダースコア (_) のみ使用できます: "${deckName}"`);
  process.exit(1);
}

const targetDeckPath = path.join(DECK_DIR, deckName);

if (fs.existsSync(targetDeckPath)) {
  console.error(`エラー: 指定されたデッキ "${deckName}" は既に存在します: ${targetDeckPath}`);
  process.exit(1);
}

if (!fs.existsSync(TEMPLATE_DIR)) {
  console.error(`エラー: テンプレートディレクトリが見つかりません: ${TEMPLATE_DIR}`);
  process.exit(1);
}

console.log('========================================');
console.log(`新規スライドデッキを作成します: ${deckName}`);
console.log('========================================');

// 1. template/ からディレクトリを一括コピー
fs.cpSync(TEMPLATE_DIR, targetDeckPath, { recursive: true });
console.log(`✔ template/ から初期ファイルを展開しました: deck/${deckName}/`);

// 2. タイトル指定があれば slide_config.js を更新
const title = values.title ? values.title.trim() : deckName;
const configJsPath = path.join(targetDeckPath, 'slide_config.js');

if (fs.existsSync(configJsPath)) {
  let configContent = fs.readFileSync(configJsPath, 'utf-8');
  configContent = configContent.replace(/deckTitle:\s*["'][^"']*["']/, `deckTitle: "${title}"`);
  fs.writeFileSync(configJsPath, configContent, 'utf-8');
  console.log(`✔ スライドタイトルを設定しました: "${title}"`);
}

// 3. sync を実行して整合性を自動確保
await runSync(deckName);

console.log('\n========================================');
console.log(`✔ デッキの作成が完了しました！`);
console.log(`  配置先: deck/${deckName}/`);
console.log(`  開発サーバーを起動して確認: pnpm dev`);
console.log('========================================\n');
