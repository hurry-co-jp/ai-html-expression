import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 大元の slide-maker スキルディレクトリを探索・特定する
 */
export function findSkillRootDir() {
  // 1. 自身の親ディレクトリに template/index.html があるか
  const parent = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(parent, 'template', 'index.html'))) {
    return parent;
  }

  // 2. カレントディレクトリまたは __dirname から上位階層を走査して .agent/skills/slide-maker を探す
  for (const startPath of [__dirname, process.cwd()]) {
    let curr = startPath;
    while (curr && curr !== path.dirname(curr)) {
      const candidate = path.join(curr, '.agent', 'skills', 'slide-maker');
      if (fs.existsSync(path.join(candidate, 'template', 'index.html'))) {
        return candidate;
      }
      curr = path.dirname(curr);
    }
  }

  return parent;
}

const skillRootDir = findSkillRootDir();
const templateDir = path.join(skillRootDir, 'template');
const skillScriptsDir = path.join(skillRootDir, 'scripts');

export function getAvailableDecks() {
  const localDeckBase = path.join(skillRootDir, 'deck');
  if (!fs.existsSync(localDeckBase)) return [];
  return fs.readdirSync(localDeckBase)
    .filter(f => {
      const full = path.join(localDeckBase, f);
      return fs.statSync(full).isDirectory();
    });
}

/**
 * 対象スライドディレクトリを解決する
 * 引数が指定されていない場合は、カレントディレクトリ（process.cwd()）を自動判定
 */
export function resolveDeckDir(deckArg) {
  const target = deckArg || '.';
  const directPath = path.resolve(process.cwd(), target);

  if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
    // slides/ または index.html があればスライドディレクトリと確定
    if (fs.existsSync(path.join(directPath, 'slides')) || fs.existsSync(path.join(directPath, 'index.html'))) {
      return directPath;
    }
    // 明示的に指定されたパスならそのまま返す
    if (deckArg) {
      return directPath;
    }
  }

  // deck/<name> の形式（ローカルデッキディレクトリが存在する場合）
  if (deckArg) {
    const localDeckBase = path.join(skillRootDir, 'deck');
    if (fs.existsSync(localDeckBase)) {
      const namedPath = path.join(localDeckBase, deckArg);
      if (fs.existsSync(namedPath) && fs.statSync(namedPath).isDirectory()) {
        return namedPath;
      }
    }
  }

  return null;
}

/**
 * テンプレート側の最新ランタイム（CSS / JS / スクリプト群 / package.json）と対象ディレクトリを同期する
 */
export function syncRuntimeFiles(targetDeckDir) {
  // 1. 基幹ランタイム（CSS / JS）の同期
  if (fs.existsSync(templateDir)) {
    const runtimeFiles = [
      { src: 'css/base.css', dest: 'css/base.css' },
      { src: 'css/style.css', dest: 'css/style.css' },
      { src: 'js/slide.js', dest: 'js/slide.js' }
    ];

    for (const item of runtimeFiles) {
      const srcFile = path.join(templateDir, item.src);
      const destFile = path.join(targetDeckDir, item.dest);

      if (fs.existsSync(srcFile)) {
        const destDir = path.dirname(destFile);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        const srcContent = fs.readFileSync(srcFile, 'utf-8');
        const destContent = fs.existsSync(destFile) ? fs.readFileSync(destFile, 'utf-8') : null;
        if (srcContent !== destContent) {
          fs.writeFileSync(destFile, srcContent, 'utf-8');
          console.log(`  [ランタイム自己修復] ${item.dest} を最新に同期しました`);
        }
      }
    }

    // package.json の同期（存在しない場合のみ生成）
    const templatePkg = path.join(templateDir, 'package.json');
    const destPkg = path.join(targetDeckDir, 'package.json');
    if (fs.existsSync(templatePkg) && !fs.existsSync(destPkg)) {
      fs.copyFileSync(templatePkg, destPkg);
      console.log('  [自己修復] package.json を生成しました');
    }

    // .gitignore の同期（存在しない場合のみ生成）
    const templateGitignore = path.join(templateDir, '.gitignore');
    const destGitignore = path.join(targetDeckDir, '.gitignore');
    if (fs.existsSync(templateGitignore) && !fs.existsSync(destGitignore)) {
      fs.copyFileSync(templateGitignore, destGitignore);
      console.log('  [自己修復] .gitignore を生成しました');
    }

    // AGENTS.md の同期（存在しない場合のみ生成）
    const templateAgents = path.join(templateDir, 'AGENTS.md');
    const destAgents = path.join(targetDeckDir, 'AGENTS.md');
    if (fs.existsSync(templateAgents) && !fs.existsSync(destAgents)) {
      fs.copyFileSync(templateAgents, destAgents);
      console.log('  [自己修復] AGENTS.md を生成しました');
    }
  }

  // 2. 運用スクリプト群の同期（大元スキル自身と対象ディレクトリが異なる場合のみ同期）
  const targetScriptsDir = path.join(targetDeckDir, 'scripts');
  if (fs.existsSync(skillScriptsDir) && path.resolve(targetDeckDir) !== path.resolve(skillRootDir)) {
    const scriptsToSync = [
      'dev-server.js',
      'sync.js',
      'export-pdf.js',
      'check-slides.js',
      'shift.js',
      'move.js',
      'capture-slides.js',
      'import-builder.js'
    ];

    if (!fs.existsSync(targetScriptsDir)) {
      fs.mkdirSync(targetScriptsDir, { recursive: true });
    }

    for (const scriptName of scriptsToSync) {
      const srcScript = path.join(skillScriptsDir, scriptName);
      const destScript = path.join(targetScriptsDir, scriptName);

      if (fs.existsSync(srcScript)) {
        const srcContent = fs.readFileSync(srcScript, 'utf-8');
        const destContent = fs.existsSync(destScript) ? fs.readFileSync(destScript, 'utf-8') : null;
        if (srcContent !== destContent) {
          fs.writeFileSync(destScript, srcContent, 'utf-8');
          console.log(`  [スクリプト自己修復] scripts/${scriptName} を最新に同期しました`);
        }
      }
    }
  }
}

export async function runSync(deckArg) {
  const targetDeckDir = resolveDeckDir(deckArg);
  if (!targetDeckDir) {
    console.error('エラー: 有効なスライドディレクトリが見つかりません。');
    console.error('スライドディレクトリ内で実行するか、--dir でパスを指定してください。');
    process.exit(1);
  }

  await runSyncSingle(targetDeckDir);
}

async function runSyncSingle(targetDeckDir) {
  const deckName = path.basename(targetDeckDir);

  console.log('========================================');
  console.log(`スライド設定・連番・自己修復の自動同期を開始: ${deckName}`);
  console.log(`対象ディレクトリ: ${targetDeckDir}`);
  console.log('========================================');

  // ランタイム（CSS/JS/スクリプト/package.json）の自動同期
  syncRuntimeFiles(targetDeckDir);

  const slidesDir = path.join(targetDeckDir, 'slides');
  const configJsPath = path.join(targetDeckDir, 'slide_config.js');
  const configCssPath = path.join(targetDeckDir, 'slide_config.css');

  if (!fs.existsSync(slidesDir)) {
    console.error(`エラー: slides ディレクトリが見つかりません: ${slidesDir}`);
    process.exit(1);
  }

  // 1. スライドHTMLの収集（番号順ソート）
  const files = fs.readdirSync(slidesDir)
    .filter(f => f.endsWith('.html') && /^\d+/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)/)[1], 10);
      const numB = parseInt(b.match(/^(\d+)/)[1], 10);
      return numA - numB;
    });

  if (files.length === 0) {
    console.warn(`警告: ${slidesDir} にスライドHTMLが見つかりません。`);
    return;
  }

  console.log(`検出されたスライドHTML: ${files.length} 件`);

  // 連番の連続性チェック
  let prevNum = 0;
  for (const f of files) {
    const num = parseInt(f.match(/^(\d+)/)[1], 10);
    if (prevNum > 0 && num !== prevNum + 1) {
      console.warn(`  [連番飛び検知] ${prevNum} ➔ ${num} (${f})`);
    }
    prevNum = num;
  }

  // 2. 既存の slide_config.js からメタ情報（skipPdf, isDemo, pdfFileName 等）を退避
  let existingSlidesMap = new Map();
  let deckTitle = deckName;
  let pdfFileName = null;

  if (fs.existsSync(configJsPath)) {
    try {
      const configModule = await import(`file://${configJsPath}?t=${Date.now()}`);
      if (configModule.slideDeckConfig) {
        deckTitle = configModule.slideDeckConfig.deckTitle || deckTitle;
        if (configModule.slideDeckConfig.pdfFileName) {
          pdfFileName = configModule.slideDeckConfig.pdfFileName;
        }
        const exSlides = configModule.slideDeckConfig.slides || [];
        for (const s of exSlides) {
          if (typeof s === 'object' && s.url) {
            existingSlidesMap.set(s.url, s);
          }
        }
      }
    } catch (e) {
      console.warn(`既存 slide_config.js の読み込みスキップ: ${e.message}`);
    }
  }

  // 3. 各HTMLからタイトル・セクション名を抽出
  const updatedSlides = [];
  for (const file of files) {
    const filePath = path.join(slidesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const relUrl = `slides/${file}`;

    let section = '';
    const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      section = titleMatch[1].trim();
    } else {
      const h1Match = content.match(/<h1>([^<]+)<\/h1>/i);
      if (h1Match) {
        section = h1Match[1].trim();
      } else {
        section = file.replace(/^\d+_?/, '').replace(/\.html$/, '');
      }
    }

    const existing = existingSlidesMap.get(relUrl) || {};
    const slideItem = {
      url: relUrl,
      section: section || existing.section
    };
    if (existing.skipPdf) {
      slideItem.skipPdf = true;
    }
    if (existing.isDemo) {
      slideItem.isDemo = true;
    }

    updatedSlides.push(slideItem);
    console.log(`  [${String(updatedSlides.length).padStart(2, '0')}] ${relUrl} -> "${slideItem.section}"`);
  }

  // 4. slide_config.js を再生成
  const newConfigJsContent = `/**
 * スライド構成設定ファイル (slide_config.js)
 * ※ scripts/sync.js により自動同期・更新されます
 */
export const slideDeckConfig = {
  deckTitle: ${JSON.stringify(deckTitle)},
${pdfFileName ? `  pdfFileName: ${JSON.stringify(pdfFileName)},\n` : ''}  slides: ${JSON.stringify(updatedSlides, null, 2)}
};
`;
  fs.writeFileSync(configJsPath, newConfigJsContent, 'utf-8');
  console.log(`\n設定ファイルを更新しました: ${configJsPath}`);

  // 5. slide_config.css の --total-slides を更新
  if (fs.existsSync(configCssPath)) {
    let cssContent = fs.readFileSync(configCssPath, 'utf-8');
    const totalCount = updatedSlides.length;
    if (/--total-slides:\s*"[^"]*";/.test(cssContent)) {
      cssContent = cssContent.replace(/--total-slides:\s*"[^"]*";/, `--total-slides: "${totalCount}";`);
    } else {
      cssContent += `\n:root {\n  --total-slides: "${totalCount}";\n}\n`;
    }
    fs.writeFileSync(configCssPath, cssContent, 'utf-8');
    console.log(`テーマ変数を更新しました: ${configCssPath} (--total-slides: "${totalCount}")`);
  }

  console.log('同期が完了しました。\n');
}

// 直接実行された場合（シンボリックリンク経由も考慮）
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return process.argv[1] === fileURLToPath(import.meta.url);
  }
}

if (isDirectRun()) {
  let values;
  try {
    const { parseArgs } = await import('node:util');
    const parsed = parseArgs({
      options: {
        dir: { type: 'string' },
        deck: { type: 'string', short: 'd' },
        help: { type: 'boolean', short: 'h' }
      },
      allowPositionals: false
    });
    values = parsed.values;
  } catch (err) {
    console.error(`エラー: ${err.message}\n`);
    console.log('使用方法:');
    console.log('  node scripts/sync.js [--dir <スライドディレクトリパス>]');
    process.exit(1);
  }

  if (values.help) {
    console.log('使用方法:');
    console.log('  node scripts/sync.js [--dir <スライドディレクトリパス>]');
    console.log('※ ディレクトリ未指定時はカレントディレクトリを自動対象とします。');
    process.exit(0);
  }

  const targetPath = values.dir || values.deck;
  runSync(targetPath).catch(err => {
    console.error('同期中にエラーが発生しました:', err);
    process.exit(1);
  });
}
