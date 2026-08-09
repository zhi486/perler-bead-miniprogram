// pages/index/index.js
const { rgbToLab } = require('../../utils/color_space');
const { renderPattern } = require('../../utils/renderer');
const { cropAndScale, buildGrid, matchColors } = require('../../utils/processor');
const palette291    = require('../../data/palette_291');
const palette221    = require('../../data/palette_221');
const paletteTrans  = require('../../data/palette_transparent');
const paletteArtkalS = require('../../data/palette_artkal_s');
const paletteHama   = require('../../data/palette_hama');
const palettePerler = require('../../data/palette_perler');

// 品牌 → 材质 → 色卡 二级映射
const BRANDS = [
  {
    id: 'mard', name: 'MARD',
    materials: [
      { id: 'solid', name: '实色',   desc: '标准不透明（A-H+M系列，221色）',    palette: palette221 },
      { id: 'translucent', name: '半透明', desc: '透明底色（P/Q/R/T/Y/ZG系列，70色）', palette: paletteTrans,
        note: '⚠️ 半透明豆子拼在底板上会透出底板颜色，成品效果与实色不同，建议先确认底板颜色。' }
    ]
  },
  { id: 'artkal_s', name: 'Artkal S',   palette: paletteArtkalS },
  { id: 'hama',     name: 'Hama Midi',  palette: paletteHama },
  { id: 'perler',   name: 'Perler',     palette: palettePerler },
];

function resolvePalette(brandIdx, materialIdx) {
  const b = BRANDS[brandIdx];
  if (b.materials) return b.materials[materialIdx].palette;
  return b.palette;
}

const ZOOM = [5,8,10,12,15,18,20,25,30,40,50];

Page({
  data: {
    hasImage: false, statusText: '',
    beadH: 52, beadW: 0, maxColors: 50,
    beadHText: '52', maxColorsText: '50',
    brandIdx: 0, brandNames: BRANDS.map(b => b.name),
    materialIdx: 0,
    hasMaterial: true,  // 当前品牌是否有材质子选项
    materialNames: [],
    materialDescs: [],
    materialNote: '',
    showBrandPicker: false,
    showMaterialPicker: false,
    tileSize: 20,
    showGrid: true, showBoard: true, showCodes: true,
    boardSizes: ['52×52','78×78','104×104','208×208'], boardSizeIdx: 0,
    canvasWidth: 0, canvasHeight: 0,
    colorSummary: [], totalBeads: 0,
    showBoardPicker: false
  },

  onLoad() {
    // 默认: MARD 实色 → palette_221
    this._brandIdx = 0;
    this._materialIdx = 0;
    this._syncMaterialData();
    this._setPalette(resolvePalette(0, 0));
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

  /* 根据当前品牌同步材质子选项 */
  _syncMaterialData() {
    const b = BRANDS[this._brandIdx];
    if (b.materials) {
      this.setData({
        hasMaterial: true,
        materialNames: b.materials.map(m => m.name),
        materialDescs: b.materials.map(m => m.desc),
      });
    } else {
      this.setData({ hasMaterial: false });
    }
  },

  /* 获取当前色卡描述文本 */
  _paletteLabel() {
    const b = BRANDS[this._brandIdx];
    if (b.materials) {
      return b.name + ' · ' + b.materials[this._materialIdx].name;
    }
    return b.name;
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
    // 已有图片时直接传入裁剪页，省去重新选图
    if (this._lastPath) {
      getApp().globalData.cropSourcePath = this._lastPath;
    }
    wx.navigateTo({ url: '/pages/crop/crop' });
  },

  goToBatch() {
    wx.navigateTo({ url: '/pages/batch/batch' });
  },

  /* 处理裁剪页回传的裁剪坐标 */
  _processCropped(path, sx, sy, sw, sh) {
    this._lastCropTask = { path, sx, sy, sw, sh };
    this._lastPath = path;
    // beadH 控制宽度（水平豆子数），高度按比例自动计算
    const beadW = this.data.beadH;
    const beadH = Math.max(1, Math.round(sh / sw * beadW));

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
            // Step 2+3: 裁剪提取 + 最近邻缩放（processor 纯函数）
            const scaled = cropAndScale(fullData, info.width, sx, sy, sw, sh, beadW, beadH);
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
        // beadH 控制宽度（水平豆子数），高度按比例自动计算
        const W = this.data.beadH;
        const H = Math.max(1, Math.round(info.height / info.width * W));
        const off = wx.createOffscreenCanvas({ type: '2d', width: W, height: H });
        const ctx = off.getContext('2d');
        const img = off.createImage();
        img.onload = () => { ctx.drawImage(img, 0, 0, W, H); this._process(ctx.getImageData(0, 0, W, H).data, W, H); };
        img.src = path;
      }
    });
  },

  _process(data, W, H) {
    const grid = buildGrid(data, W, H);
    this.rawGrid = grid;
    wx.hideLoading();
    this._matchAndDraw(grid, W, H, { isNew: true });
  },

  _matchAndDraw(srcGrid, W, H, opts) {
    const { matched, indices, counts } = matchColors(
      srcGrid, W, H, this.palette, this.paletteLAB, this.paletteMap, this.data.maxColors
    );
    this.grid = matched; this.idx = indices;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, e) => s + e[1], 0);
    const setOpts = {
      colorSummary: sorted.map(([code, cnt]) => ({ code, count: cnt, hex: this.paletteMap[code].hex })),
      totalBeads: total,
      statusText: `${W}×${H} · ${this._paletteLabel()} · ${sorted.length}色 · ${total}颗`
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
  toggleBrandPicker()   { this.setData({ showBrandPicker: !this.data.showBrandPicker, showBoardPicker: false, showMaterialPicker: false }); },
  toggleBoardPicker()   { this.setData({ showBoardPicker: !this.data.showBoardPicker, showBrandPicker: false, showMaterialPicker: false }); },
  toggleMaterialPicker(){ this.setData({ showMaterialPicker: !this.data.showMaterialPicker, showBrandPicker: false, showBoardPicker: false }); },
  closePickers() { this.setData({ showBrandPicker: false, showBoardPicker: false, showMaterialPicker: false }); },
  noop() {},

  selectBrand(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ showBrandPicker: false });
    if (idx === this._brandIdx) return;
    this._brandIdx = idx;
    this._materialIdx = 0;  // 切换品牌时重置材质
    this._syncMaterialData();
    const p = resolvePalette(idx, 0);
    this._setPalette(p);
    this.setData({ brandIdx: idx, materialIdx: 0, materialNote: '' });
    if (this.grid) this._reprocess();
  },
  selectMaterial(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ materialIdx: idx, showMaterialPicker: false });
    this._materialIdx = idx;
    const p = resolvePalette(this._brandIdx, idx);
    this._setPalette(p);
    // 半透明附注
    const b = BRANDS[this._brandIdx];
    const note = (b.materials && b.materials[idx].note) ? b.materials[idx].note : '';
    this.setData({ materialIdx: idx, materialNote: note });
    if (this.grid) this._reprocess();
  },
  selectBoard(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ boardSizeIdx: idx, showBoardPicker: false });
    this.draw();
  },

  onBeadHChanging(e) { this.setData({ beadH: e.detail.value, beadHText: String(e.detail.value) }); },
  onBeadHSlider(e) {
    this.setData({ beadH: e.detail.value, beadHText: String(e.detail.value) });
    if (this._lastCropTask) {
      wx.showLoading({ title: '处理中' });
      const t = this._lastCropTask;
      this._processCropped(t.path, t.sx, t.sy, t.sw, t.sh);
    } else if (this._lastPath) {
      wx.showLoading({ title: '处理中' });
      this._loadImage(this._lastPath);
    }
  },
  // 输入框打字中：只更新文本，不触发处理
  onBeadHInput(e) {
    this.setData({ beadHText: e.detail.value });
  },
  // 输入框失焦 / 确认：校验值并触发处理
  onBeadHBlur(e) {
    const raw = e.detail.value;
    let v = parseInt(raw);
    if (isNaN(v) || v < 5) v = 5;
    if (v > 200) v = 200;
    this.setData({ beadH: v, beadHText: String(v) });
    if (this._lastCropTask) {
      wx.showLoading({ title: '处理中' });
      const t = this._lastCropTask;
      this._processCropped(t.path, t.sx, t.sy, t.sw, t.sh);
    } else if (this._lastPath) {
      wx.showLoading({ title: '处理中' });
      this._loadImage(this._lastPath);
    }
  },
  onMaxColorsChanging(e) { this.setData({ maxColors: e.detail.value, maxColorsText: String(e.detail.value) }); },
  onMaxColorsSlider(e) {
    const v = e.detail.value;
    this.setData({ maxColors: v, maxColorsText: String(v) });
    if (this.grid) this._reprocess();
  },
  // 输入框打字中：只更新文本，不触发处理
  onMaxColorsInput(e) {
    this.setData({ maxColorsText: e.detail.value });
  },
  // 输入框失焦 / 确认：校验值并触发处理
  onMaxColorsBlur(e) {
    const raw = e.detail.value;
    let v = parseInt(raw);
    if (isNaN(v) || v < 4) v = 4;
    if (v > 150) v = 150;
    this.setData({ maxColors: v, maxColorsText: String(v) });
    if (this.grid) this._reprocess();
  },

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
        paletteLabel: this._paletteLabel(), colorSummary: this.data.colorSummary, totalBeads: this.data.totalBeads
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
