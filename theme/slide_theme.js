/**
 * スライド共通自動採番スクリプト (theme/slide_theme.js)
 * 自分自身のファイル名 (例: 02_intro.html) から数字 "2" を全自動抽出し、
 * slide_config.css の --show-total-slides (true/false) オプションを判定して描画
 */
(function() {
  function initAutoPageNum() {
    const footer = document.querySelector('.slide-footer');
    if (!footer) return;

    // 1. ファイル名からページ番号を全自動抽出
    if (!footer.hasAttribute('data-page')) {
      const pathParts = location.pathname.split('/');
      const fileName = pathParts[pathParts.length - 1];
      const match = fileName.match(/(\d+)/);

      if (match) {
        const pageNum = parseInt(match[1], 10);
        footer.setAttribute('data-page', pageNum);
      }
    }

    // 2. CSSの --show-total-slides (true/false) 設定を判定
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
