// pages/index/index.js
const { rgbToLab } = require('../../utils/color_space');
const { quantize } = require('../../utils/median_cut');
const { findNearestColor } = require('../../utils/color_matcher');
const { renderPattern } = require('../../utils/renderer');
const palette291 = require('../../data/palette_291');
const palette221 = require('../../data/palette_221');
const paletteArtkalS = require('../../data/palette_artkal_s');
const paletteHama = require('../../data/palette_hama');
const palettePerler = require('../../data/palette_perler');

const PALETTES = [
  { mode: 'mard291',  name: 'MARD 291色',    data: palette291 },
  { mode: 'mard221',  name: 'MARD 221色',    data: palette221 },
  { mode: 'artkal_s', name: 'Artkal S 199色', data: paletteArtkalS },
  { mode: 'hama',     name: 'Hama Midi 92色', data: paletteHama },
  { mode: 'perler',   name: 'Perler 103色',   data: palettePerler },
];

const ZOOM = [5,8,10,12,15,18,20,25,30,40,50];

Page({
  data: {
    hasImage: false, statusText: '',
    beadH: 52, beadW: 0, maxColors: 50,
    paletteMode: 'mard221', paletteIdx: 1,
    paletteNames: PALETTES.map(p => p.name), tileSize: 20,
    showGrid: true, showBoard: true, showCodes: true,
    boardSizes: ['52×52','72×72','102×102'], boardSizeIdx: 0,
    canvasWidth: 0, canvasHeight: 0,
    colorSummary: [], totalBeads: 0,
    showPalettePicker: false, showBoardPicker: false
  },

  onLoad() {
    this._paletteIdx = 1;
    this._setPalette(PALETTES[1].data);
  },

  // 基础库 3.16+ 隐私保护框架：在调用隐私相关 API 前先获取授权
  _withPrivacyAuth(callback) {
    if (typeof wx.requirePrivacyAuthorize === 'function') {
      wx.requirePrivacyAuthorize({
        success: () => callback(),
        fail: err => {
          console.error('[privacy] 隐私授权失败:', err);
          wx.showToast({ title: '需要同意隐私政策', icon: 'none' });
        }
      });
    } else {
      callback();
    }
  },

  onShow() {
    const task = getApp().globalData && getApp().globalData.cropTask;
    if (!task) return;
    getApp().globalData.cropTask = null;
    wx.showLoading({ title: '处理中' });
    if (task.sx !== undefined) {
      this._processCropped(task.path, task.sx, task.sy, task.sw, task.sh);
    } else {
      this._loadImage(task.path);
    }
  },

  _setPalette(p) {
    this.palette = p;
    this.paletteLAB = p.map(c => rgbToLab(c.rgb));
    this.paletteMap = {};
    p.forEach(c => { this.paletteMap[c.code] = c; });
  },

  chooseImage() {
    this._lastCropTask = null;
    // 基础库 3.16+ 隐私保护框架要求先获得隐私授权
    this._withPrivacyAuth(() => {
      wx.chooseImage({
        count: 1, sizeType: ['original'], sourceType: ['album','camera'],
        success: r => {
        const path = r.tempFilePaths[0];
        wx.showLoading({ title: '检测中...' });
        // 上传到云存储 → 内容安全检查
        wx.cloud.uploadFile({
          cloudPath: 'check/' + Date.now() + '.png',
          filePath: path,
          success: up => {
            wx.cloud.callFunction({
              name: 'imgCheck', data: { fileID: up.fileID },
              success: cr => {
                if (cr.result.ok) {
                  wx.hideLoading();
                  wx.showLoading({ title: '处理中' });
                  this._loadImage(path);
                } else {
                  wx.hideLoading();
                  wx.showToast({ title: '图片含违规内容', icon: 'none' });
                }
              },
              fail: () => {
                wx.hideLoading();
                wx.showToast({ title: '检测失败，请重试', icon: 'none' });
              }
            });
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '上传失败，请重试', icon: 'none' });
          }
        });
      },
      fail: e => {
        if (e.errMsg.indexOf('cancel') < 0) {
          console.error('chooseImage fail:', e.errMsg);
          wx.showToast({ title: '选择失败，请重试', icon: 'none' });
        }
      }
    });
    }); // _withPrivacyAuth
  },

  reChooseImage() {
    this.chooseImage();
  },

  /* ── 裁剪工具 ── */
  goToCrop() {
    wx.navigateTo({ url: '/pages/crop/crop' });
  },

  /* 处理裁剪页回传的裁剪坐标 */
  _processCropped(path, sx, sy, sw, sh) {
    this._lastCropTask = { path, sx, sy, sw, sh };
    this._lastPath = path;
    const beadH = this.data.beadH;
    const beadW = Math.max(1, Math.round(sw / sh * beadH));

    wx.getImageInfo({
      src: path,
      success: info => {
        // Step 1: 全图绘制到离屏 Canvas
        const full = wx.createOffscreenCanvas({ type: '2d', width: info.width, height: info.height });
        const fctx = full.getContext('2d');
        const img = full.createImage();
        img.onload = () => {
          try {
            fctx.drawImage(img, 0, 0, info.width, info.height);
            const fullData = fctx.getImageData(0, 0, info.width, info.height);
            // Step 2: 提取裁剪区域（ArrayBuffer 零拷贝子视图）
            const crop = new Uint8ClampedArray(sw * sh * 4);
            for (let r = 0; r < sh; r++) {
              const srcOff = ((sy + r) * info.width + sx) * 4;
              crop.set(new Uint8ClampedArray(fullData.data.buffer, srcOff, sw * 4), r * sw * 4);
            }
            // Step 3: 最近邻缩放到目标豆子尺寸
            const scaled = new Uint8ClampedArray(beadW * beadH * 4);
            for (let r = 0; r < beadH; r++) {
              const srcR = Math.floor(r * sh / beadH);
              for (let c = 0; c < beadW; c++) {
                const srcC = Math.floor(c * sw / beadW);
                const si = (srcR * sw + srcC) * 4;
                const di = (r * beadW + c) * 4;
                scaled[di]     = crop[si];
                scaled[di + 1] = crop[si + 1];
                scaled[di + 2] = crop[si + 2];
                scaled[di + 3] = 255;
              }
            }
            this._process(scaled, beadW, beadH);
          } catch (e) {
            wx.hideLoading();
            wx.showToast({ title: '处理失败，请重试', icon: 'none' });
          }
        };
        img.onerror = () => { wx.hideLoading(); wx.showToast({ title: '图片加载失败', icon: 'none' }); };
        img.src = path;
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '获取图片失败', icon: 'none' }); }
    });
  },

  _loadImage(path) {
    this._lastPath = path;
    wx.getImageInfo({
      src: path,
      success: info => {
        const H = this.data.beadH;
        const W = Math.max(1, Math.round(info.width / info.height * H));
        const off = wx.createOffscreenCanvas({ type: '2d', width: W, height: H });
        const ctx = off.getContext('2d');
        const img = off.createImage();
        img.onload = () => { ctx.drawImage(img, 0, 0, W, H); this._process(ctx.getImageData(0, 0, W, H).data, W, H); };
        img.src = path;
      }
    });
  },

  _process(data, W, H) {
    const grid = [];
    for (let r = 0; r < H; r++) { grid[r] = []; for (let c = 0; c < W; c++) { const i = (r * W + c) * 4; grid[r][c] = [data[i], data[i + 1], data[i + 2]]; } }
    this.rawGrid = grid;
    wx.hideLoading();
    this._matchAndDraw(grid, W, H, { isNew: true });
  },

  _matchAndDraw(srcGrid, W, H, opts) {
    const q = quantize(srcGrid, this.data.maxColors);
    const matched = [], indices = [], counts = {};
    for (let r = 0; r < H; r++) {
      matched[r] = []; indices[r] = [];
      for (let c = 0; c < W; c++) {
        const n = findNearestColor(q[r][c], this.paletteLAB, this.palette);
        matched[r][c] = n.rgb; indices[r][c] = n.index; counts[n.code] = (counts[n.code] || 0) + 1;
      }
    }
    this.grid = matched; this.idx = indices;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, e) => s + e[1], 0);
    const setOpts = {
      colorSummary: sorted.map(([code, cnt]) => ({ code, count: cnt, hex: this.paletteMap[code].hex })),
      totalBeads: total,
      statusText: `${W}×${H} · ${PALETTES[this._paletteIdx].name} · ${sorted.length}色 · ${total}颗`
    };
    if (opts.isNew) { setOpts.hasImage = true; setOpts.beadW = W; }
    this.setData(setOpts);
    this.draw();
  },

  draw() {
    if (!this.grid) return;
    const q = wx.createSelectorQuery();
    q.select('#previewCanvas').fields({ node: true, size: false }).exec(res => {
      if (!res[0]) return;
      const canvas = res[0].node, ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio;
      const W = this.grid[0].length, H = this.grid.length;
      const ts = this.data.tileSize, ml = 30, mt = 24;
      const cw = W * ts + ml, ch = H * ts + mt;

      canvas.width = cw * dpr; canvas.height = ch * dpr;

      renderPattern(ctx, dpr, {
        patternGrid: this.grid, patternIdx: this.idx, palette: this.palette,
        beadW: W, beadH: H, tileSize: ts,
        marginLeft: ml, marginTop: mt,
        showGrid: this.data.showGrid, showBoard: this.data.showBoard,
        boardSize: parseInt(this.data.boardSizes[this.data.boardSizeIdx]),
        showCodes: this.data.showCodes
      });

      this.setData({ canvasWidth: cw, canvasHeight: ch });
    });
  },

  zoomIn()  { let t = this.data.tileSize; for (const z of ZOOM) if (z>t) { t=z; break; } if (t===this.data.tileSize) t = Math.min(t+10,50); this.setData({ tileSize: t }); this.draw(); },
  zoomOut() { let t = this.data.tileSize; for (let i=ZOOM.length-1; i>=0; i--) if (ZOOM[i]<t) { t=ZOOM[i]; break; } if (t===this.data.tileSize) t = Math.max(t-10,3); this.setData({ tileSize: t }); this.draw(); },
  zoomReset() { this.setData({ tileSize: 20 }); this.draw(); },

  /* 双指缩放 */
  _getDist(t) { const dx=t[0].x-t[1].x, dy=t[0].y-t[1].y; return Math.sqrt(dx*dx+dy*dy); },
  onTouchStart(e) { if (e.touches.length===2) this._pinch={d:this._getDist(e.touches),ts:this.data.tileSize}; else this._pinch=null; },
  onTouchMove(e) {
    if (e.touches.length===2 && this._pinch) {
      const v=Math.max(3,Math.min(50,Math.round(this._pinch.ts*this._getDist(e.touches)/this._pinch.d)));
      if (v!==this.data.tileSize) { this.setData({tileSize:v}); this.draw(); }
    }
  },
  onTouchEnd() { this._pinch=null; },

  // 自定义下拉选择器
  togglePalettePicker() { this.setData({ showPalettePicker: !this.data.showPalettePicker, showBoardPicker: false }); },
  toggleBoardPicker()  { this.setData({ showBoardPicker: !this.data.showBoardPicker, showPalettePicker: false }); },
  closePickers() { this.setData({ showPalettePicker: false, showBoardPicker: false }); },
  noop() {},

  selectPalette(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ showPalettePicker: false });
    if (idx === this._paletteIdx) return;
    this._paletteIdx = idx;
    const p = PALETTES[idx];
    this._setPalette(p.data);
    this.setData({ paletteMode: p.mode, paletteIdx: idx });
    if (this.grid) this._reprocess();
  },
  selectBoard(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ boardSizeIdx: idx, showBoardPicker: false });
    this.draw();
  },

  switchPalette(e) {
    const idx = parseInt(e.detail.value);
    if (idx === this._paletteIdx) return;
    this._paletteIdx = idx;
    const p = PALETTES[idx];
    this._setPalette(p.data);
    this.setData({ paletteMode: p.mode, paletteIdx: idx });
    if (this.grid) this._reprocess();
  },

  onBeadHChanging(e) { this.setData({ beadH: e.detail.value }); },
  onBeadHSlider(e) {
    this.setData({ beadH: e.detail.value });
    if (this._lastCropTask) {
      wx.showLoading({ title: '处理中' });
      const t = this._lastCropTask;
      this._processCropped(t.path, t.sx, t.sy, t.sw, t.sh);
    } else if (this._lastPath) {
      wx.showLoading({ title: '处理中' });
      this._loadImage(this._lastPath);
    }
  },
  onBeadHInput(e) {
    const v = parseInt(e.detail.value) || 52;
    this.setData({ beadH: Math.max(5, Math.min(200, v)) });
    if (this._lastCropTask) {
      wx.showLoading({ title: '处理中' });
      const t = this._lastCropTask;
      this._processCropped(t.path, t.sx, t.sy, t.sw, t.sh);
    } else if (this._lastPath) {
      wx.showLoading({ title: '处理中' });
      this._loadImage(this._lastPath);
    }
  },
  onMaxColorsChanging(e) { this.setData({ maxColors: e.detail.value }); },
  onMaxColorsSlider(e) { if (!this.grid) { this.setData({ maxColors: e.detail.value }); return; } this.setData({ maxColors: e.detail.value }); this._reprocess(); },
  onMaxColorsInput(e)  { const v = parseInt(e.detail.value) || 50; this.setData({ maxColors: Math.max(4, Math.min(150, v)) }); if (this.grid) this._reprocess(); },

  _reprocess() {
    if (!this.grid) return;
    const src = this.rawGrid || this.grid;
    this._matchAndDraw(src, this.grid[0].length, this.grid.length, {});
  },

  onToggleGrid(e)  { this.setData({ showGrid: e.detail.value }); this.draw(); },
  onToggleBoard(e) { this.setData({ showBoard: e.detail.value }); this.draw(); },
  onToggleCodes(e) { this.setData({ showCodes: e.detail.value }); this.draw(); },
  onBoardSizeChange(e) { this.setData({ boardSizeIdx: parseInt(e.detail.value) }); this.draw(); },

  exportPNG() {
    if (!this.grid) return;
    wx.showLoading({ title: '导出中' });
    // 在页面上下文中获取 Canvas 节点，传给导出器
    wx.createSelectorQuery().select('#previewCanvas').fields({ node: true }).exec(res => {
      if (!res[0]) {
        wx.hideLoading();
        console.error('[exportPNG] 未找到 Canvas 节点');
        wx.showToast({ title: '导出失败，请重试', icon: 'none' });
        return;
      }
      const { exportToAlbum } = require('../../utils/exporter');
      exportToAlbum({
        canvasNode: res[0].node,
        patternGrid: this.grid, patternIdx: this.idx, palette: this.palette,
        paletteMode: this.data.paletteMode, colorSummary: this.data.colorSummary, totalBeads: this.data.totalBeads
      }).then(() => { wx.hideLoading(); wx.showToast({ title: '已保存到相册', icon: 'success' }); })
        .catch(e => {
          wx.hideLoading();
          console.error('[exportPNG] 导出失败:', e);
          if (e === 'denied') {
            wx.showModal({
              title: '需要相册权限',
              content: '保存图片需要相册写入权限，请在设置中允许',
              confirmText: '去设置',
              success: r => { if (r.confirm) wx.openSetting(); }
            });
          } else if (e === 'privacy_denied') {
            wx.showModal({
              title: '需要同意隐私政策',
              content: '根据微信要求，保存图片需要先同意隐私保护政策，请重新导出',
              showCancel: false,
              confirmText: '知道了'
            });
          } else if (e === 'cancelled') {
            wx.showToast({ title: '已取消', icon: 'none' });
          } else {
            const msg = (e && e.errMsg) ? e.errMsg : '导出失败，请重试';
            wx.showToast({ title: msg, icon: 'none' });
          }
        });
    });
  }
});
