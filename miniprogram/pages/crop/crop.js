// pages/crop/crop.js
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
    phase: 'pick',  // pick | crop | result
    // 裁剪状态
    cropPath: '', cropDw: 0, cropDh: 0,
    cropScale: 1, cropX: 0, cropY: 0, cropW: 160, cropH: 160,
    // 结果状态
    hasImage: false, statusText: '',
    beadH: 52, beadW: 0, maxColors: 50,
    paletteMode: 'mard221', paletteIdx: 1,
    paletteNames: PALETTES.map(p => p.name), tileSize: 20,
    showGrid: true, showBoard: true, showCodes: true,
    boardSizes: ['52×52','72×72','102×102'], boardSizeIdx: 0,
    canvasWidth: 0, canvasHeight: 0,
    colorSummary: [], totalBeads: 0,
    showPalettePicker: false, showBoardPicker: false,
  },

  onLoad() {
    this._paletteIdx = 1;
    this._setPalette(PALETTES[1].data);
  },

  _setPalette(p) {
    this.palette = p;
    this.paletteLAB = p.map(c => rgbToLab(c.rgb));
    this.paletteMap = {};
    p.forEach(c => { this.paletteMap[c.code] = c; });
  },

  /* ── 阶段切换 ── */
  backToPick() {
    this.grid = null; this.idx = null; this.rawGrid = null;
    this._origPath = null; this._cropInfo = null; this._lastPath = null;
    this.setData({ phase: 'pick', hasImage: false });
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

  /* ── 选图 ── */
  pickImage() {
    this._withPrivacyAuth(() => {
      wx.chooseImage({
        count: 1, sizeType: ['original'], sourceType: ['album','camera'],
      success: r => {
        const path = r.tempFilePaths[0];
        wx.showLoading({ title: '检测中...' });
        wx.cloud.uploadFile({
          cloudPath: 'check/' + Date.now() + '.png',
          filePath: path,
          success: up => {
            wx.cloud.callFunction({
              name: 'imgCheck', data: { fileID: up.fileID },
              success: cr => {
                if (cr.result.ok) {
                  wx.hideLoading();
                  this._prepareCrop(path);
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
          console.error('pickImage fail:', e.errMsg);
          wx.showToast({ title: '选择失败，请重试', icon: 'none' });
        }
      }
    });
    }); // _withPrivacyAuth
  },

  /* ── 裁剪交互 ── */
  _prepareCrop(path) {
    wx.showLoading({ title: '加载中' });
    wx.getImageInfo({
      src: path,
      success: info => {
        wx.hideLoading();
        const sys = wx.getSystemInfoSync();
        const winW = sys.windowWidth;
        const maxW = winW - 48;
        const scale = info.width / maxW;
        const dw = maxW, dh = Math.round(info.height / scale);

        // 固定留白边距
        const pad = 50;
        const stageW = dw + pad * 2, stageH = dh + pad * 2;
        const imgLeft = pad, imgTop = pad;

        // 裁剪框初始在图片区域内，占图片 60%
        const m = 0.6;
        const fw = Math.round(dw * m), fh = Math.round(dh * m);
        const fx = imgLeft + Math.round((dw - fw) / 2);
        const fy = imgTop  + Math.round((dh - fh) / 2);

        this._cropX = fx; this._cropY = fy;
        this._cropW = fw; this._cropH = fh;
        this._imgLeft = imgLeft; this._imgTop = imgTop;
        this._imgW = dw; this._imgH = dh;
        this._cropDrag = null; this._cropPinch = null; this._cropResize = null; this._cropTs = 0;

        this.setData({
          phase: 'crop', cropPath: path,
          cropDw: stageW, cropDh: stageH, cropScale: scale,
          imgLeft, imgTop, imgDw: dw, imgDh: dh,
          cropX: fx, cropY: fy, cropW: fw, cropH: fh
        });

        // 估算 stage 在屏幕上的位置
        this._sl = Math.max(0, Math.round((winW - stageW) / 2));
        this._st = (sys.statusBarHeight || 0) + 44 + 60 + 12;
        setTimeout(() => {
          wx.createSelectorQuery().select('.crop-stage').boundingClientRect(rect => {
            if (rect && rect.left !== undefined && rect.top > 0) {
              this._sl = rect.left; this._st = rect.top;
            }
          }).exec();
        }, 300);
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '加载失败', icon: 'none' }); }
    });
  },

  /* 将 pageX/pageY 转为 stage 内坐标 */
  _toLocal(touch) {
    return { x: touch.pageX - (this._sl || 0), y: touch.pageY - (this._st || 0) };
  },

  onCropTouchStart(e) {
    const t = e.touches;
    if (t.length >= 2) {
      // 双指：独立 x/y 缩放
      const p0 = this._toLocal(t[0]), p1 = this._toLocal(t[1]);
      const dx = Math.abs(p0.x - p1.x), dy = Math.abs(p0.y - p1.y);
      if (dx > 20 || dy > 20) {
        this._cropPinch = { dx, dy, w: this._cropW, h: this._cropH, cx: this._cropX + this._cropW / 2, cy: this._cropY + this._cropH / 2 };
        this._cropDrag = null; this._cropResize = null;
      }
    } else if (t.length === 1) {
      const p = this._toLocal(t[0]);
      const HW = 22; // 手柄命中半径
      // 右下角手柄 → 调大小
      if (Math.abs(p.x - (this._cropX + this._cropW)) < HW && Math.abs(p.y - (this._cropY + this._cropH)) < HW) {
        this._cropResize = { sx: p.x, sy: p.y, fw: this._cropW, fh: this._cropH };
        this._cropDrag = null; this._cropPinch = null;
      // 框内或左上角手柄 → 移动
      } else if (p.x >= this._cropX - HW && p.x <= this._cropX + this._cropW + HW &&
                 p.y >= this._cropY - HW && p.y <= this._cropY + this._cropH + HW) {
        this._cropDrag = { sx: p.x, sy: p.y, fx: this._cropX, fy: this._cropY };
        this._cropResize = null; this._cropPinch = null;
      }
    }
  },

  onCropTouchMove(e) {
    const t = e.touches, now = Date.now();
    const il = this._imgLeft, it = this._imgTop, iw = this._imgW, ih = this._imgH;
    if (t.length >= 2 && this._cropPinch) {
      const p0 = this._toLocal(t[0]), p1 = this._toLocal(t[1]);
      const dx = Math.abs(p0.x - p1.x), dy = Math.abs(p0.y - p1.y);
      if (dx < 20 && dy < 20) return;
      const sx = Math.max(0.3, Math.min(3, dx / Math.max(1, this._cropPinch.dx)));
      const sy = Math.max(0.3, Math.min(3, dy / Math.max(1, this._cropPinch.dy)));
      let nw = Math.max(60, Math.min(iw, Math.round(this._cropPinch.w * sx)));
      let nh = Math.max(60, Math.min(ih, Math.round(this._cropPinch.h * sy)));
      let nx = Math.round(this._cropPinch.cx - nw / 2);
      let ny = Math.round(this._cropPinch.cy - nh / 2);
      // 约束在图片区域内
      nx = Math.max(il, Math.min(il + iw - nw, nx));
      ny = Math.max(it, Math.min(it + ih - nh, ny));
      this._cropX = nx; this._cropY = ny; this._cropW = nw; this._cropH = nh;
      if (now - this._cropTs > 40) { this._cropTs = now; this.setData({ cropX: nx, cropY: ny, cropW: nw, cropH: nh }); }
    } else if (t.length === 1 && this._cropResize) {
      const p = this._toLocal(t[0]);
      const dx = p.x - this._cropResize.sx, dy = p.y - this._cropResize.sy;
      const nw = Math.max(60, Math.min(il + iw - this._cropX, this._cropResize.fw + dx));
      const nh = Math.max(60, Math.min(it + ih - this._cropY, this._cropResize.fh + dy));
      this._cropW = nw; this._cropH = nh;
      if (now - this._cropTs > 40) { this._cropTs = now; this.setData({ cropW: nw, cropH: nh }); }
    } else if (t.length === 1 && this._cropDrag) {
      const p = this._toLocal(t[0]);
      const dx = p.x - this._cropDrag.sx, dy = p.y - this._cropDrag.sy;
      const nx = Math.max(il, Math.min(il + iw - this._cropW, this._cropDrag.fx + dx));
      const ny = Math.max(it, Math.min(it + ih - this._cropH, this._cropDrag.fy + dy));
      this._cropX = nx; this._cropY = ny;
      if (now - this._cropTs > 40) { this._cropTs = now; this.setData({ cropX: nx, cropY: ny }); }
    }
  },

  onCropTouchEnd() {
    if (this._cropDrag || this._cropPinch || this._cropResize) {
      this.setData({ cropX: this._cropX, cropY: this._cropY, cropW: this._cropW, cropH: this._cropH });
    }
    this._cropDrag = null; this._cropPinch = null; this._cropResize = null; this._cropTs = 0;
  },

  confirmCrop() {
    const s = this.data.cropScale;
    // stage 坐标 → 图片坐标
    const ix = this._cropX - this._imgLeft, iy = this._cropY - this._imgTop;
    // 钳位到图片区域内
    const cx = Math.max(0, Math.min(this._imgW - 1, ix));
    const cy = Math.max(0, Math.min(this._imgH - 1, iy));
    const cw = Math.max(1, Math.min(this._imgW - cx, this._cropW - Math.max(0, -ix)));
    const ch = Math.max(1, Math.min(this._imgH - cy, this._cropH - Math.max(0, -iy)));
    // 换算到原图像素坐标
    getApp().globalData.cropTask = {
      path: this.data.cropPath,
      sx: Math.round(cx * s), sy: Math.round(cy * s),
      sw: Math.round(cw * s), sh: Math.round(ch * s)
    };
    wx.navigateBack();
  },

  skipCrop() {
    getApp().globalData.cropTask = {
      path: this.data.cropPath
      // 无 sx/sy/sw/sh → 全图处理
    };
    wx.navigateBack();
  },

  /* ── 核心处理：裁剪提取 + 缩放到目标尺寸 + 色号匹配 ── */
  _extractAndProcess() {
    const { sx, sy, sw, sh } = this._cropInfo;
    const path = this._origPath;
    const beadH = this.data.beadH;
    const beadW = Math.max(1, Math.round(sw / sh * beadH));

    wx.getImageInfo({
      src: path,
      success: info => {
        // Step 1: 全图绘制（与 _loadImage 同样的可靠方式）
        const full = wx.createOffscreenCanvas({ type: '2d', width: info.width, height: info.height });
        const fctx = full.getContext('2d');
        const img = full.createImage();
        img.onload = () => {
          try {
            fctx.drawImage(img, 0, 0, info.width, info.height);
            const fullData = fctx.getImageData(0, 0, info.width, info.height);

            // Step 2: 从完整 ImageData 中提取裁剪区域（ArrayBuffer 零拷贝子视图）
            const crop = new Uint8ClampedArray(sw * sh * 4);
            for (let r = 0; r < sh; r++) {
              const srcOff = ((sy + r) * info.width + sx) * 4;
              crop.set(new Uint8ClampedArray(fullData.data.buffer, srcOff, sw * 4), r * sw * 4);
            }

            // Step 3: 最近邻缩放到目标豆子尺寸（避免 Canvas 9 参 drawImage 兼容问题）
            const scaled = new Uint8ClampedArray(beadW * beadH * 4);
            for (let r = 0; r < beadH; r++) {
              const srcR = Math.floor(r * sh / beadH);
              for (let c = 0; c < beadW; c++) {
                const srcC = Math.floor(c * sw / beadW);
                const si = (srcR * sw + srcC) * 4;
                const di = (r * beadW + c) * 4;
                scaled[di] = crop[si];
                scaled[di + 1] = crop[si + 1];
                scaled[di + 2] = crop[si + 2];
                scaled[di + 3] = 255;
              }
            }

            this.setData({ phase: 'result' });
            wx.showLoading({ title: '处理中' });
            this._process(scaled, beadW, beadH);
          } catch (e) {
            wx.hideLoading();
            wx.showToast({ title: '裁剪失败，请重试', icon: 'none' });
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
        img.onload = () => {
          ctx.drawImage(img, 0, 0, W, H);
          this.setData({ phase: 'result' });
          this._process(ctx.getImageData(0, 0, W, H).data, W, H);
        };
        img.src = path;
      }
    });
  },

  _process(data, W, H) {
    const grid = [];
    for (let r = 0; r < H; r++) {
      grid[r] = [];
      for (let c = 0; c < W; c++) {
        const i = (r * W + c) * 4;
        grid[r][c] = [data[i], data[i + 1], data[i + 2]];
      }
    }
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
        matched[r][c] = n.rgb; indices[r][c] = n.index;
        counts[n.code] = (counts[n.code] || 0) + 1;
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

  /* ── 画布 ── */
  draw() {
    if (!this.grid) return;
    const q = wx.createSelectorQuery();
    q.select('#cropPreviewCanvas').fields({ node: true, size: false }).exec(res => {
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

  /* ── 预览触摸缩放 ── */
  onTouchStart(e) { if (e.touches.length === 2) this._pinch = { d: this._getDist(e.touches), ts: this.data.tileSize }; else this._pinch = null; },
  onTouchMove(e) {
    if (e.touches.length === 2 && this._pinch) {
      const v = Math.max(3, Math.min(50, Math.round(this._pinch.ts * this._getDist(e.touches) / this._pinch.d)));
      if (v !== this.data.tileSize) { this.setData({ tileSize: v }); this.draw(); }
    }
  },
  onTouchEnd() { this._pinch = null; },

  /* ── 缩放按钮 ── */
  zoomIn()  { let t = this.data.tileSize; for (const z of ZOOM) if (z > t) { t = z; break; } if (t === this.data.tileSize) t = Math.min(t + 10, 50); this.setData({ tileSize: t }); this.draw(); },
  zoomOut() { let t = this.data.tileSize; for (let i = ZOOM.length - 1; i >= 0; i--) if (ZOOM[i] < t) { t = ZOOM[i]; break; } if (t === this.data.tileSize) t = Math.max(t - 10, 3); this.setData({ tileSize: t }); this.draw(); },
  zoomReset() { this.setData({ tileSize: 20 }); this.draw(); },

  /* ── 参数控制 ── */
  onBeadHChanging(e) { this.setData({ beadH: e.detail.value }); },
  onBeadHSlider(e) {
    if (!this._origPath) { this.setData({ beadH: e.detail.value }); return; }
    wx.showLoading({ title: '处理中' });
    this.setData({ beadH: e.detail.value });
    this._cropInfo ? this._extractAndProcess() : this._loadImage(this._origPath);
  },
  onBeadHInput(e) {
    const v = parseInt(e.detail.value) || 52;
    this.setData({ beadH: Math.max(5, Math.min(200, v)) });
    if (!this._origPath) return;
    wx.showLoading({ title: '处理中' });
    this._cropInfo ? this._extractAndProcess() : this._loadImage(this._origPath);
  },

  onMaxColorsChanging(e) { this.setData({ maxColors: e.detail.value }); },
  onMaxColorsSlider(e) {
    if (!this.grid) { this.setData({ maxColors: e.detail.value }); return; }
    this.setData({ maxColors: e.detail.value }); this._reprocess();
  },
  onMaxColorsInput(e) {
    const v = parseInt(e.detail.value) || 50;
    this.setData({ maxColors: Math.max(4, Math.min(150, v)) });
    if (this.grid) this._reprocess();
  },

  _reprocess() {
    if (!this.grid) return;
    const src = this.rawGrid || this.grid;
    this._matchAndDraw(src, this.grid[0].length, this.grid.length, {});
  },

  /* ── 开关 ── */
  onToggleGrid(e)  { this.setData({ showGrid: e.detail.value }); this.draw(); },
  onToggleBoard(e) { this.setData({ showBoard: e.detail.value }); this.draw(); },
  onToggleCodes(e) { this.setData({ showCodes: e.detail.value }); this.draw(); },

  /* ── 下拉选择器 ── */
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

  /* ── 导出 ── */
  exportPNG() {
    if (!this.grid) return;
    wx.showLoading({ title: '导出中' });
    const { exportToAlbum } = require('../../utils/exporter');
    exportToAlbum({
      patternGrid: this.grid, patternIdx: this.idx, palette: this.palette,
      paletteMode: this.data.paletteMode, colorSummary: this.data.colorSummary, totalBeads: this.data.totalBeads
    }).then(() => { wx.hideLoading(); wx.showToast({ title: '已保存到相册', icon: 'success' }); })
      .catch(e => {
        wx.hideLoading();
        if (e === 'denied') wx.showModal({ title: '需要相册权限', content: '请在设置中允许', confirmText: '去设置', success: r => { if (r.confirm) wx.openSetting(); } });
        else wx.showToast({ title: '导出失败', icon: 'none' });
      });
  },
});
