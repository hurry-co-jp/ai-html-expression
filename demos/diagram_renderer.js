/**
 * AWS構成図ビューワー 内部固定定数 (CONSTANTS)
 * レンダラーの基本描画ルール。通常は変更しません。
 */
const CONSTANTS = {
  // ノード基本寸法
  NODE_WIDTH: 110,
  NODE_HEIGHT: 85,
  ICON_SIZE: 48,

  // カラー定数
  COLOR_LINE_DEFAULT: 'rgba(148, 163, 184, 0.7)',
  COLOR_LINE_ACTIVE: '#0284c7',
  COLOR_SELECTION_BG: 'rgba(245, 158, 11, 0.08)',
  COLOR_SELECTION_BORDER: '#f59e0b',
  COLOR_HOVER_BG: 'rgba(2, 132, 199, 0.08)',
  COLOR_HOVER_BORDER: '#0284c7',

  // ズームリミット
  ZOOM_MIN: 0.3,
  ZOOM_MAX: 3.0,
  ZOOM_FACTOR: 1.1,

  // デフォルトアイコンURL
  DEFAULT_ICON_URL: "https://raw.githubusercontent.com/awslabs/aws-icons-for-plantuml/v18.0/dist/General/GenericApplication.png"
};

/**
 * AwsDiagramRenderer
 * AWS公式アイコン対応・標準構成図スタイル（アイコン上部＋下部ラベル）
 * ＋ ズーム＆パン、スプライン中継点（waypoints）、アノテーション（annotations）対応汎用レンダラー
 */
class AwsDiagramRenderer {
  /**
   * @param {Object} options
   * @param {HTMLCanvasElement|string} options.canvas - Canvas要素またはID
   * @param {HTMLElement|string} [options.inspector] - インスペクタ表示用コンテナ
   * @param {HTMLElement|string} [options.selectBadge] - 選択中ノードID表示用バッジ要素
   * @param {HTMLElement|string} [options.nodeCount] - ノード数表示要素
   * @param {HTMLElement|string} [options.connCount] - コネクション数表示要素
   * @param {HTMLTextAreaElement|string} [options.jsonViewer] - JSONプレビュー用テキストエリア
   * @param {Function} [options.onSelectNode] - ノード選択時のコールバック
   */
  constructor(options = {}) {
    this.canvas = typeof options.canvas === 'string' ? document.getElementById(options.canvas) : options.canvas;
    if (!this.canvas) {
      throw new Error('Canvas element is required for AwsDiagramRenderer');
    }
    this.ctx = this.canvas.getContext('2d');

    this.inspectorEl = typeof options.inspector === 'string' ? document.getElementById(options.inspector) : options.inspector;
    this.selectBadgeEl = typeof options.selectBadge === 'string' ? document.getElementById(options.selectBadge) : options.selectBadge;
    this.nodeCountEl = typeof options.nodeCount === 'string' ? document.getElementById(options.nodeCount) : options.nodeCount;
    this.connCountEl = typeof options.connCount === 'string' ? document.getElementById(options.connCount) : options.connCount;
    this.jsonViewerEl = typeof options.jsonViewer === 'string' ? document.getElementById(options.jsonViewer) : options.jsonViewer;
    this.onSelectNode = options.onSelectNode || null;

    // データと状態
    this.data = { groups: [], nodes: [], connections: [], annotations: [] };
    this.selectedNodeId = null;
    this.hoveredNode = null;

    // ズーム＆パン（Viewport状態）
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.hasDragged = false;

    // オプション
    this.ignoreWaypoints = options.ignoreWaypoints || false;

    // アイコン画像キャッシュ
    this.iconCache = new Map();
    this.defaultIconUrl = CONSTANTS.DEFAULT_ICON_URL;

    this._createControls();
    this._bindEvents();
  }

  /**
   * 中継点の有効/無効を切り替え
   */
  setIgnoreWaypoints(ignore) {
    this.ignoreWaypoints = !!ignore;
    this.render();
  }

  /**
   * ズーム操作用UI（右下ツールバー）の動的挿入
   */
  _createControls() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    if (parent.querySelector('.diagram-zoom-controls')) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'diagram-zoom-controls absolute bottom-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur border border-slate-200 rounded-lg p-1 shadow-sm text-xs font-mono select-none z-10';
    toolbar.innerHTML = `
      <button id="zoom-in" class="px-2 py-1 hover:bg-slate-100 rounded text-slate-700 font-bold" title="ズームイン">＋</button>
      <span id="zoom-level" class="px-1.5 py-0.5 text-[11px] text-slate-500 font-bold min-w-[3rem] text-center">100%</span>
      <button id="zoom-out" class="px-2 py-1 hover:bg-slate-100 rounded text-slate-700 font-bold" title="ズームアウト">－</button>
      <button id="zoom-fit" class="px-2 py-1 hover:bg-slate-100 rounded text-slate-700 text-[11px] ml-0.5 border-l border-slate-200 font-sans" title="全体表示リセット">Fit</button>
    `;
    parent.appendChild(toolbar);

    toolbar.querySelector('#zoom-in').addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomBy(1.2);
    });
    toolbar.querySelector('#zoom-out').addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomBy(0.8);
    });
    toolbar.querySelector('#zoom-fit').addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetView();
    });
    this.zoomLevelEl = toolbar.querySelector('#zoom-level');
  }

  _updateZoomDisplay() {
    if (this.zoomLevelEl) {
      this.zoomLevelEl.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  zoomBy(factor, centerX = null, centerY = null) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = centerX !== null ? centerX : rect.width / 2;
    const cy = centerY !== null ? centerY : rect.height / 2;

    const newScale = Math.min(CONSTANTS.ZOOM_MAX, Math.max(CONSTANTS.ZOOM_MIN, this.scale * factor));
    if (newScale === this.scale) return;

    this.offsetX = cx - (cx - this.offsetX) * (newScale / this.scale);
    this.offsetY = cy - (cy - this.offsetY) * (newScale / this.scale);
    this.scale = newScale;

    this._updateZoomDisplay();
    this.render();
  }

  resetView() {
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this._updateZoomDisplay();
    this.render();
  }

  _resolveIconUrl(icon) {
    if (!icon || icon.trim() === '') {
      return this.defaultIconUrl;
    }
    return icon;
  }

  _preloadIcon(url) {
    if (!this.iconCache.has(url)) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      img.onload = () => {
        this.iconCache.set(url, { img, loaded: true });
        this.render();
      };
      img.onerror = () => {
        if (url !== this.defaultIconUrl) {
          this._preloadIcon(this.defaultIconUrl);
          this.iconCache.set(url, this.iconCache.get(this.defaultIconUrl) || { img: null, loaded: false });
        }
      };
      this.iconCache.set(url, { img, loaded: false });
    }
    return this.iconCache.get(url);
  }

  setData(diagramData, initialSelectedNodeId = null) {
    this.data = {
      groups: diagramData.groups || [],
      nodes: diagramData.nodes || [],
      connections: diagramData.connections || [],
      annotations: diagramData.annotations || []
    };

    this.data.nodes.forEach(node => {
      const iconUrl = this._resolveIconUrl(node.icon);
      this._preloadIcon(iconUrl);
    });
    this._preloadIcon(this.defaultIconUrl);

    if (initialSelectedNodeId) {
      this.selectedNodeId = initialSelectedNodeId;
    } else if (this.data.nodes.length > 0 && !this.selectedNodeId) {
      this.selectedNodeId = this.data.nodes[0].id;
    }

    if (this.nodeCountEl) this.nodeCountEl.textContent = this.data.nodes.length;
    if (this.connCountEl) this.connCountEl.textContent = this.data.connections.length;
    if (this.jsonViewerEl) this.jsonViewerEl.value = JSON.stringify(this.data, null, 2);

    const selectedNode = this.data.nodes.find(n => n.id === this.selectedNodeId) || null;
    this.updateInspector(selectedNode);
    this.resetView();
  }

  _bindEvents() {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? CONSTANTS.ZOOM_FACTOR : (1 / CONSTANTS.ZOOM_FACTOR);
      this.zoomBy(zoomFactor, mouseX, mouseY);
    }, { passive: false });

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.hasDragged = false;
      this.dragStartX = e.clientX - this.offsetX;
      this.dragStartY = e.clientY - this.offsetY;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const newOffsetX = e.clientX - this.dragStartX;
        const newOffsetY = e.clientY - this.dragStartY;
        if (Math.abs(newOffsetX - this.offsetX) > 3 || Math.abs(newOffsetY - this.offsetY) > 3) {
          this.hasDragged = true;
          this.offsetX = newOffsetX;
          this.offsetY = newOffsetY;
          this.canvas.style.cursor = 'grabbing';
          this.render();
        }
      } else {
        const pos = this._getWorldMousePos(e);
        const hit = this._getNodeAtPos(pos.x, pos.y);
        if (hit !== this.hoveredNode) {
          this.hoveredNode = hit;
          this.canvas.style.cursor = hit ? 'pointer' : 'default';

          const activeNode = this._getActiveNode();
          this.updateInspector(activeNode);
          this.render();
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'default';
      }
    });

    this.canvas.addEventListener('click', (e) => {
      if (this.hasDragged) return;

      const pos = this._getWorldMousePos(e);
      const hitNode = this._getNodeAtPos(pos.x, pos.y);
      if (hitNode) {
        if (this.selectedNodeId === hitNode.id) {
          this.selectedNodeId = null;
        } else {
          this.selectedNodeId = hitNode.id;
        }
      } else {
        this.selectedNodeId = null;
      }

      const activeNode = this._getActiveNode();
      this.updateInspector(activeNode);
      if (this.onSelectNode) this.onSelectNode(activeNode);
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (!this.isDragging && this.hoveredNode) {
        this.hoveredNode = null;
        const activeNode = this._getActiveNode();
        this.updateInspector(activeNode);
        this.render();
      }
    });

    window.addEventListener('resize', () => {
      this.render();
    });
  }

  _getActiveNode() {
    if (this.hoveredNode) return this.hoveredNode;
    if (this.selectedNodeId) {
      return this.data.nodes.find(n => n.id === this.selectedNodeId) || null;
    }
    return null;
  }

  _getWorldMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - this.offsetX) / this.scale,
      y: (screenY - this.offsetY) / this.scale
    };
  }

  _getNodeAtPos(worldX, worldY) {
    if (!this.data.nodes) return null;
    for (let i = this.data.nodes.length - 1; i >= 0; i--) {
      const n = this.data.nodes[i];
      const w = n.w || CONSTANTS.NODE_WIDTH;
      const h = n.h || CONSTANTS.NODE_HEIGHT;
      if (worldX >= n.x && worldX <= n.x + w && worldY >= n.y && worldY <= n.y + h) {
        return n;
      }
    }
    return null;
  }

  _roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _drawConnection(ctx, conn, fromNode, toNode, isRelated) {
    const fromW = fromNode.w || CONSTANTS.NODE_WIDTH;
    const fromH = fromNode.h || CONSTANTS.NODE_HEIGHT;
    const toW = toNode.w || CONSTANTS.NODE_WIDTH;
    const toH = toNode.h || CONSTANTS.NODE_HEIGHT;

    const fromCenterX = fromNode.x + fromW / 2;
    const fromCenterY = fromNode.y + fromH / 2;
    const toCenterX = toNode.x + toW / 2;
    const toCenterY = toNode.y + toH / 2;

    ctx.save();
    ctx.strokeStyle = isRelated ? CONSTANTS.COLOR_LINE_ACTIVE : CONSTANTS.COLOR_LINE_DEFAULT;
    ctx.lineWidth = isRelated ? 2.4 : (conn.dashed ? 1.2 : 1.5);
    if (conn.dashed) {
      ctx.setLineDash([5, 4]);
    } else {
      ctx.setLineDash([]);
    }

    let endX, endY, angle, midLabelX, midLabelY;

    if (!this.ignoreWaypoints && conn.waypoints && Array.isArray(conn.waypoints) && conn.waypoints.length > 0) {
      const firstWp = conn.waypoints[0];
      const dxStart = firstWp.x - fromCenterX;
      const dyStart = firstWp.y - fromCenterY;
      let startX, startY;

      if (Math.abs(dxStart) >= Math.abs(dyStart)) {
        startX = dxStart >= 0 ? fromNode.x + fromW : fromNode.x;
        startY = fromCenterY;
      } else {
        startX = fromCenterX;
        startY = dyStart >= 0 ? fromNode.y + fromH : fromNode.y;
      }

      const lastWp = conn.waypoints[conn.waypoints.length - 1];
      const dxEnd = toCenterX - lastWp.x;
      const dyEnd = toCenterY - lastWp.y;

      if (Math.abs(dxEnd) >= Math.abs(dyEnd)) {
        endX = dxEnd >= 0 ? toNode.x : toNode.x + toW;
        endY = toCenterY;
      } else {
        endX = toCenterX;
        endY = dyEnd >= 0 ? toNode.y : toNode.y + toH;
      }

      const points = [{ x: startX, y: startY }, ...conn.waypoints, { x: endX, y: endY }];

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      const lastIdx = points.length - 1;
      ctx.quadraticCurveTo(points[lastIdx - 1].x, points[lastIdx - 1].y, points[lastIdx].x, points[lastIdx].y);
      ctx.stroke();

      angle = Math.atan2(points[lastIdx].y - points[lastIdx - 1].y, points[lastIdx].x - points[lastIdx - 1].x);

      const midPointIdx = Math.floor(points.length / 2);
      midLabelX = points[midPointIdx].x;
      midLabelY = points[midPointIdx].y;

    } else {
      const dx = toCenterX - fromCenterX;
      const dy = toCenterY - fromCenterY;
      let fromX, fromY, toX, toY, cp1X, cp1Y, cp2X, cp2Y;

      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx >= 0) {
          fromX = fromNode.x + fromW; fromY = fromCenterY;
          toX = toNode.x; toY = toCenterY;
        } else {
          fromX = fromNode.x; fromY = fromCenterY;
          toX = toNode.x + toW; toY = toCenterY;
        }
        const curveOffset = Math.min(60, Math.abs(toX - fromX) * 0.4);
        const sign = dx >= 0 ? 1 : -1;
        cp1X = fromX + curveOffset * sign; cp1Y = fromY;
        cp2X = toX - curveOffset * sign; cp2Y = toY;
        angle = Math.atan2(toY - cp2Y, toX - cp2X);
      } else if (Math.abs(dy) > Math.abs(dx) * 1.5) {
        if (dy >= 0) {
          fromX = fromCenterX; fromY = fromNode.y + fromH;
          toX = toCenterX; toY = toNode.y;
        } else {
          fromX = fromCenterX; fromY = fromNode.y;
          toX = toCenterX; toY = toNode.y + toH;
        }
        const curveOffset = Math.min(60, Math.abs(toY - fromY) * 0.4);
        const sign = dy >= 0 ? 1 : -1;
        cp1X = fromX; cp1Y = fromY + curveOffset * sign;
        cp2X = toX; cp2Y = toY - curveOffset * sign;
        angle = Math.atan2(toY - cp2Y, toX - cp2X);
      } else {
        if (dy > 0) {
          fromX = fromCenterX; fromY = fromNode.y + fromH;
          toX = toCenterX; toY = toNode.y;
        } else {
          fromX = fromCenterX; fromY = fromNode.y;
          toX = toCenterX; toY = toNode.y + toH;
        }
        cp1X = fromX + dx * 0.2; cp1Y = fromY + dy * 0.4;
        cp2X = toX - dx * 0.2; cp2Y = toY - dy * 0.4;
        angle = Math.atan2(toY - cp2Y, toX - cp2X);
      }

      endX = toX;
      endY = toY;

      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, toX, toY);
      ctx.stroke();

      const t = 0.5;
      midLabelX = Math.pow(1-t, 3)*fromX + 3*Math.pow(1-t, 2)*t*cp1X + 3*(1-t)*Math.pow(t, 2)*cp2X + Math.pow(t, 3)*toX;
      midLabelY = Math.pow(1-t, 3)*fromY + 3*Math.pow(1-t, 2)*t*cp1Y + 3*(1-t)*Math.pow(t, 2)*cp2Y + Math.pow(t, 3)*toY;
    }

    const arrowSize = 6;
    ctx.setLineDash([]);
    ctx.fillStyle = isRelated ? CONSTANTS.COLOR_LINE_ACTIVE : '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - arrowSize * 1.5 * Math.cos(angle - Math.PI / 6),
      endY - arrowSize * 1.5 * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      endX - arrowSize * 1.5 * Math.cos(angle + Math.PI / 6),
      endY - arrowSize * 1.5 * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();

    if (conn.label) {
      ctx.font = isRelated ? 'bold 10px monospace' : '9px monospace';
      const tw = ctx.measureText(conn.label).width;

      ctx.fillStyle = isRelated ? '#ffffff' : '#f8fafc';
      ctx.strokeStyle = isRelated ? CONSTANTS.COLOR_LINE_ACTIVE : '#cbd5e1';
      ctx.lineWidth = 1;
      this._roundRect(ctx, midLabelX - tw/2 - 5, midLabelY - 9, tw + 10, 18, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isRelated ? CONSTANTS.COLOR_LINE_ACTIVE : '#64748b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(conn.label, midLabelX, midLabelY);
    }

    ctx.restore();
  }

  _drawAnnotations(ctx) {
    if (!this.data.annotations) return;

    for (const a of this.data.annotations) {
      ctx.save();
      const w = a.w || 160;
      const h = a.h || 50;

      this._roundRect(ctx, a.x, a.y, w, h, 6);
      ctx.fillStyle = a.bgColor || '#ffffff';
      ctx.fill();

      ctx.strokeStyle = a.borderColor || '#ea580c';
      ctx.lineWidth = a.lineWidth || 1.2;
      if (a.dashed) ctx.setLineDash([4, 3]);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = a.textColor || '#c2410c';
      ctx.font = a.font || 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const lines = (a.text || '').split('\n');
      const lineHeight = 14;
      const startY = a.y + h / 2 - ((lines.length - 1) * lineHeight) / 2;

      lines.forEach((line, idx) => {
        ctx.fillText(line, a.x + w / 2, startY + idx * lineHeight);
      });

      if (a.arrowTo) {
        ctx.strokeStyle = a.borderColor || '#ea580c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x + w, a.y + h / 2);
        ctx.lineTo(a.arrowTo.x, a.arrowTo.y);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  render() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    this.ctx.clearRect(0, 0, width, height);

    // 1. 背景グリッド
    this.ctx.fillStyle = '#f8fafc';
    for (let x = 20; x < width; x += 30) {
      for (let y = 20; y < height; y += 30) {
        this.ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    // --- ワールド座標系（ズーム＆パン） ---
    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    // 2. グループ枠
    if (this.data.groups) {
      for (const g of this.data.groups) {
        this.ctx.save();
        this._roundRect(this.ctx, g.x, g.y, g.w, g.h, g.radius !== undefined ? g.radius : 10);
        this.ctx.fillStyle = g.bgColor || 'transparent';
        this.ctx.fill();

        this.ctx.strokeStyle = g.borderColor || '#cbd5e1';
        this.ctx.lineWidth = g.lineWidth || 1.4;
        if (g.dashed !== false) {
          this.ctx.setLineDash([5, 4]);
        } else {
          this.ctx.setLineDash([]);
        }
        this.ctx.stroke();

        if (g.label) {
          this.ctx.setLineDash([]);
          this.ctx.font = 'bold 11.5px sans-serif';
          this.ctx.fillStyle = g.textColor || '#64748b';
          this.ctx.textAlign = 'left';
          this.ctx.fillText(g.label, g.x + 14, g.y + 20);
        }
        this.ctx.restore();
      }
    }

    const nodeMap = {};
    for (const n of this.data.nodes) {
      nodeMap[n.id] = n;
    }

    // 3. 接続線
    const activeNode = this._getActiveNode();
    const activeId = activeNode ? activeNode.id : null;
    if (this.data.connections) {
      for (const conn of this.data.connections) {
        const fromNode = nodeMap[conn.from];
        const toNode = nodeMap[conn.to];
        if (fromNode && toNode) {
          const isRelated = activeId && (conn.from === activeId || conn.to === activeId);
          this._drawConnection(this.ctx, conn, fromNode, toNode, isRelated);
        }
      }
    }

    // 4. アノテーション
    this._drawAnnotations(this.ctx);

    // 5. ノード
    for (const n of this.data.nodes) {
      this.ctx.save();

      const w = n.w || CONSTANTS.NODE_WIDTH;
      const h = n.h || CONSTANTS.NODE_HEIGHT;
      const isHover = this.hoveredNode && this.hoveredNode.id === n.id;
      const isSelected = !this.hoveredNode && this.selectedNodeId === n.id;
      const isActive = isHover || (this.selectedNodeId === n.id);

      if (isActive) {
        this._roundRect(this.ctx, n.x - 4, n.y - 4, w + 8, h + 8, 8);
        this.ctx.fillStyle = isHover ? CONSTANTS.COLOR_HOVER_BG : CONSTANTS.COLOR_SELECTION_BG;
        this.ctx.fill();
        this.ctx.strokeStyle = isHover ? CONSTANTS.COLOR_HOVER_BORDER : CONSTANTS.COLOR_SELECTION_BORDER;
        this.ctx.lineWidth = 1.8;
        this.ctx.stroke();
      }

      const iconSize = n.iconSize || CONSTANTS.ICON_SIZE;
      const iconX = n.x + (w - iconSize) / 2;
      const iconY = n.y + 4;

      const iconUrl = this._resolveIconUrl(n.icon);
      const cached = this.iconCache.get(iconUrl);

      if (cached && cached.loaded && cached.img) {
        this.ctx.drawImage(cached.img, iconX, iconY, iconSize, iconSize);
      } else {
        this.ctx.fillStyle = '#e2e8f0';
        this.ctx.fillRect(iconX, iconY, iconSize, iconSize);
      }

      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#0f172a';
      this.ctx.font = isSelected ? 'bold 11.5px sans-serif' : '11px sans-serif';
      
      const labelY = iconY + iconSize + 14;
      this.ctx.fillText(n.name, n.x + w / 2, labelY);

      if (n.type) {
        this.ctx.fillStyle = '#64748b';
        this.ctx.font = '9.5px sans-serif';
        this.ctx.fillText(n.type, n.x + w / 2, labelY + 13);
      }

      this.ctx.restore();
    }

    this.ctx.restore();
  }

  updateInspector(node) {
    if (!this.inspectorEl) return;

    if (!node) {
      if (this.selectBadgeEl) {
        this.selectBadgeEl.textContent = "未選択";
        this.selectBadgeEl.className = "text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono";
      }
      this.inspectorEl.innerHTML = `
        <div class="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400 border border-dashed border-slate-200 rounded-lg">
          <span class="text-3xl mb-2 text-slate-300">🖱️</span>
          <span class="text-xs font-bold text-slate-700">ノードが選択されていません</span>
          <span class="text-[11px] text-slate-500 mt-1 leading-relaxed">
            構成図上のノードにホバーまたはクリックすると、詳細パラメータが展開されます。
          </span>
        </div>
      `;
      return;
    }

    if (this.selectBadgeEl) {
      this.selectBadgeEl.textContent = node.id;
      this.selectBadgeEl.className = "text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-mono font-bold border border-amber-200";
    }

    const incoming = (this.data.connections || []).filter(c => c.to === node.id);
    const outgoing = (this.data.connections || []).filter(c => c.from === node.id);

    let paramsHtml = '';
    if (node.params && Object.keys(node.params).length > 0) {
      paramsHtml = Object.entries(node.params).map(([key, val]) => `
        <div class="flex flex-col gap-0.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
          <span class="text-[11px] font-bold text-slate-500">${key}</span>
          <span class="text-xs text-slate-900 font-mono font-medium break-all">${val}</span>
        </div>
      `).join('');
    }

    let connHtml = '';
    if (incoming.length > 0 || outgoing.length > 0) {
      connHtml = `
        <div class="space-y-2 pt-2 border-t border-slate-200">
          <div class="text-xs font-bold text-slate-900">関連する通信ルート</div>
          <div class="space-y-1.5 text-xs">
            ${incoming.map(c => `
              <div class="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-200">
                <span class="text-slate-600">受信 ← <strong class="text-slate-900 font-bold">${c.from}</strong></span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">${c.label || 'LINK'}</span>
              </div>
            `).join('')}
            ${outgoing.map(c => `
              <div class="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-200">
                <span class="text-slate-600">送信 → <strong class="text-slate-900 font-bold">${c.to}</strong></span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-bold">${c.label || 'LINK'}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const iconUrl = this._resolveIconUrl(node.icon);

    this.inspectorEl.innerHTML = `
      <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center gap-3">
        <div class="w-12 h-12 p-1.5 bg-white rounded-lg border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
          <img src="${iconUrl}" alt="${node.name}" class="w-full h-full object-contain" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-base font-bold text-slate-900 truncate">${node.name}</div>
          <div class="text-xs text-slate-500 mt-0.5 font-medium">${node.type || ''}</div>
          <div class="text-[10px] text-slate-400 font-mono mt-0.5">ID: ${node.id}</div>
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-xs font-bold text-slate-900">設定パラメータ ＆ スペック</div>
        <div class="grid grid-cols-1 gap-2">
          ${paramsHtml || '<div class="text-xs text-slate-400">パラメータ定義なし</div>'}
        </div>
      </div>

      ${connHtml}
    `;
  }
}
