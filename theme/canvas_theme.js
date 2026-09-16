/**
 * Canvas スライド共通レイアウト規格定義 (theme/canvas_theme.js)
 * 
 * 16:9 スライド規格（1920 × 1080）および、
 * 上下バー（ヘッダー・フッター）を除いたメイン描画エリアの基準サイズを定義します。
 */
const CANVAS_LAYOUT = {
  SLIDE_WIDTH: 1920,
  SLIDE_HEIGHT: 1080,
  HEADER_HEIGHT: 120, // 上部ヘッダーの占有高さ
  FOOTER_HEIGHT: 60,  // 下部フッターの占有高さ
  CONTENT_WIDTH: 1920,
  CONTENT_HEIGHT: 1080 - (120 + 60) // 900: メイン描画エリア基準高さ
};

// ブラウザ環境（グローバル）への公開
if (typeof window !== 'undefined') {
  window.CANVAS_LAYOUT = CANVAS_LAYOUT;
}

// Node.js 環境への公開（スクリプトテスト用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CANVAS_LAYOUT };
}
