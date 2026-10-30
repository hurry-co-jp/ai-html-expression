/**
 * スライド基盤スクリプト (js/slide.js)
 * 1. Canvas共通レイアウト規格 (CANVAS_LAYOUT) の定義
 * 2. 自動採番: ファイル名から番号を抽出し、--show-total-slides 設定を反映
 */

// 1. Canvas スライド共通レイアウト規格定義
const CANVAS_LAYOUT = {
  SLIDE_WIDTH: 1920,
  SLIDE_HEIGHT: 1080,
  HEADER_HEIGHT: 120, // 上部ヘッダーの占有高さ
  FOOTER_HEIGHT: 60,  // 下部フッターの占有高さ
  CONTENT_WIDTH: 1920,
  CONTENT_HEIGHT: 1080 - (120 + 60) // 900: メイン描画エリア基準高さ
};

if (typeof window !== 'undefined') {
  window.CANVAS_LAYOUT = CANVAS_LAYOUT;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CANVAS_LAYOUT };
}

// 2. スライド共通自動採番スクリプト
(function() {
  function initAutoPageNum() {
    const footer = document.querySelector('.slide-footer');
    if (!footer) return;

    // ファイル名からページ番号を全自動抽出
    const pathParts = location.pathname.split('/');
    const fileName = pathParts[pathParts.length - 1];
    const match = fileName.match(/(\d+)/);

    if (match) {
      const pageNum = parseInt(match[1], 10);
      footer.setAttribute('data-page', pageNum);
    }

    // CSSの --show-total-slides (true/false) 設定を判定
    const showTotal = getComputedStyle(document.documentElement)
      .getPropertyValue('--show-total-slides')
      .trim();

    if (showTotal === 'true') {
      footer.setAttribute('data-show-total', 'true');
    } else {
      footer.removeAttribute('data-show-total');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoPageNum);
  } else {
    initAutoPageNum();
  }
})();
