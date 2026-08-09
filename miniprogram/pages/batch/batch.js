// pages/batch/batch.js — 批量选图 & 裁剪
const { rgbToLab } = require('../../utils/color_space');
const { renderPattern } = require('../../utils/renderer');
const { cropAndScale, buildGrid, matchColors } = require('../../utils/processor');
const palette291    = require('../../data/palette_291');
const palette221    = require('../../data/palette_221');
const paletteTrans  = require('../../data/palette_transparent');
const paletteArtkalS = require('../../data/palette_artkal_s');
const paletteHama   = require('../../data/palette_hama');
const palettePerler = require('../../data/palette_perler');

// 品牌 → 材质 → 色卡（与 index.js 共用定义）
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

Page({
  data: {
    phase: 'pick',       // pick | checking | crop | processing | list | detail
    // pick 阶段
    thumbPaths: [],        // 已选图片缩略图
    checkResults: [],      // 内容检查结果（true/false/null）
    checksDone: false,     // 检查是否已完成（跳过重复检查）

    // progress
    progressPct: 0,
    progressText: '',

    // list 阶段
    images: [],            // 列表数据（id/colorCount/totalBeads/topColors）

    // detail 阶段
    activeIdx: 0,
    activeBeadH: 52,
    activeBeadHText: '52',
    activeMaxColors: 50,
    activeMaxColorsText: '50',
    activeBrandIdx: 0,
    activeMaterialIdx: 0,
    activeStatusText: '',
    activeColorSummary: [],
    activeTotalBeads: 0,
    dw: 0, dh: 0,

    // 品牌/材质选择器
    brandNames: BRANDS.map(b => b.name),
    hasMaterial: true,
    materialNames: [],
    materialDescs: [],
    materialNote: '',
    showBrandPicker: false,
    showMaterialPicker: false,
    showBoardPicker: false,

    // 显示选项
    showGrid: true, showBoard: true, showCodes: true,
    tileSize: 20,
  },

  onLoad() {
    this._brandIdx = 0;
    this._materialIdx = 0;
    this._syncMaterialData();
    this._setPalette(resolvePalette(0, 0));
    this._activePaletteIdx = 0;  // brandIdx for the currently-active palette
    this._activeMaterialPaletteIdx = 0;
  },

  // ── 隐私授权 ──
  _withPrivacyAuth(callback) {
    if (typeof wx.requirePrivacyAuthorize === 'function') {
      wx.requirePrivacyAuthorize({ success: () => callback(), fail: () => {} });
    } else {
      callback();
    }
  },

  onShow() {
    // 从裁剪页返回时接收 cropTask
    const task = getApp().globalData && getApp().globalData.cropTask;
    if (!task || this.data.phase !== 'crop') return;
    getApp().globalData.cropTask = null;

    if (task.sx !== undefined) {
      this._cropCoords = { sx: task.sx, sy: task.sy, sw: task.sw, sh: task.sh };
    } else {
      this._cropCoords = null; // 全图
    }
    this._startProcessing();
  },

  /* ═══════════════════════════════════════════
     Phase: pick
     ═══════════════════════════════════════════ */
  startPick() {
    this._withPrivacyAuth(() => {
      wx.chooseImage({
        count: 9, sizeType: ['original'], sourceType: ['album', 'camera'],
        success: r => {
          this._imagePaths = r.tempFilePaths;
          this.setData({
            thumbPaths: r.tempFilePaths,
            checkResults: [],
            phase: 'pick'
          });
        }
      });
    });
  },

  /* ═══════════════════════════════════════════
     Phase: checking — 并行上传 + 内容检查
     ═══════════════════════════════════════════ */
  async startCheck() {
    try {
      await this._checkAll();
    } catch (e) {
      console.error('[batch] _checkAll 异常:', e);
      wx.showToast({ title: '检查失败', icon: 'none' });
      this.setData({ phase: 'pick' });
      return;
    }
    const passed = this._imagePaths.filter((_, i) => this._checkResults[i] === true);
    if (!passed.length) {
      wx.showToast({ title: '没有通过检查的图片', icon: 'none' });
      this.setData({ phase: 'pick' });
      return;
    }
    // 不裁剪，直接全图处理
    this._cropCoords = null;
    this._startProcessing();
  },

  async startCheckAndCrop() {
    try {
      await this._checkAll();
    } catch (e) {
      console.error('[batch] _checkAll 异常:', e);
      wx.showToast({ title: '检查失败，请重试', icon: 'none' });
      this.setData({ phase: 'pick' });
      return;
    }

    const passed = this._imagePaths.filter((_, i) => this._checkResults[i] === true);
    console.log('[batch] 检查完成, 通过:', passed.length, '/', this._imagePaths.length);

    if (!passed.length) {
      wx.showToast({ title: '没有通过检查的图片', icon: 'none' });
      this.setData({ phase: 'pick' });
      return;
    }

    this._goCrop(passed);
  },

  // 检查已完成：跳过裁剪，直接全图处理（不重复检查）
  goToCropAfterCheck() {
    const passed = this._imagePaths.filter((_, i) => this._checkResults[i] === true);
    if (!passed.length) {
      wx.showToast({ title: '没有通过检查的图片', icon: 'none' });
      return;
    }
    this._cropCoords = null;
    this._startProcessing();
  },

  _goCrop(passed) {
    // 用通过检查的第一张进入裁剪
    getApp().globalData.cropSourcePath = passed[0];
    this.setData({ phase: 'crop' });
    wx.navigateTo({
      url: '/pages/crop/crop',
      fail: err => {
        console.error('[batch] navigateTo crop 失败:', err);
        wx.showToast({ title: '跳转失败，请重试', icon: 'none' });
        this.setData({ phase: 'pick' });
      }
    });
  },

  async _checkAll() {
    const paths = this._imagePaths;
    const n = paths.length;
    this._checkResults = new Array(n).fill(false);
    const batchTs = Date.now();

    this.setData({ phase: 'checking', progressPct: 0, progressText: '正在上传 0/' + n });

    // Step 1: 逐张上传（顺序执行避免云路径碰撞）
    const uploadResults = [];
    for (let i = 0; i < n; i++) {
      const res = await new Promise(resolve => {
        wx.cloud.uploadFile({
          cloudPath: 'check/batch_' + batchTs + '_' + i + '.png',
          filePath: paths[i],
          success: r => resolve({ ok: true, fileID: r.fileID }),
          fail: e => resolve({ ok: false, err: e.errMsg })
        });
      });
      uploadResults.push(res);
      this.setData({
        progressPct: Math.round(((i + 1) / n) * 50),
        progressText: '正在上传 ' + (i + 1) + '/' + n
      });
    }

    // Step 2: 逐张内容检查
    for (let i = 0; i < n; i++) {
      if (!uploadResults[i].ok) {
        this._checkResults[i] = false;
        this.setData({ progressPct: 50 + Math.round(((i + 1) / n) * 50), progressText: '正在检查 ' + (i + 1) + '/' + n, checkResults: [...this._checkResults] });
        continue;
      }
      const cr = await new Promise(resolve => {
        wx.cloud.callFunction({
          name: 'imgCheck', data: { fileID: uploadResults[i].fileID },
          success: r => resolve(r && r.result ? r.result : { ok: false }),
          fail: () => resolve({ ok: false })
        });
      });
      this._checkResults[i] = !!(cr && cr.ok);
      this.setData({
        progressPct: 50 + Math.round(((i + 1) / n) * 50),
        progressText: '正在检查 ' + (i + 1) + '/' + n,
        checkResults: [...this._checkResults]
      });
    }
  },

  /* ═══════════════════════════════════════════
     Phase: processing — 逐张处理
     ═══════════════════════════════════════════ */
  async _startProcessing() {
    const paths = this._imagePaths;
    const n = paths.length;
    this._images = [];

    this.setData({ phase: 'processing', progressPct: 0, progressText: '正在生成 0/' + n });

    for (let i = 0; i < n; i++) {
      const item = await this._processOne(paths[i], i);
      this._images.push(item);
      this.setData({
        progressPct: Math.round(((i + 1) / n) * 100),
        progressText: '正在生成 ' + (i + 1) + '/' + n
      });
    }

    // 初始化品牌相关 UI 为第一个图片的参数
    this._brandIdx = this._images[0].brandIdx;
    this._materialIdx = this._images[0].materialIdx;
    this._syncMaterialData();
    this._setPalette(resolvePalette(this._brandIdx, this._materialIdx));

    // 进入 list — 构建列表数据（含 topColors 色条）
    const listData = this._images.map(item => ({
      id: item.id,
      colorCount: item.colorCount || 0,
      totalBeads: item.totalBeads || 0,
      topColors: (item.colorSummary || []).slice(0, 5).map(c => c.hex)
    }));
    this.setData({ phase: 'list', activeIdx: 0, images: listData });
  },

  _processOne(path, id) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: path,
        success: info => {
          const beadW = 52;  // 默认宽度
          const coords = this._cropCoords;
          let sw, sh, sx, sy;

          if (coords) {
            sx = coords.sx; sy = coords.sy; sw = coords.sw; sh = coords.sh;
          } else {
            sx = 0; sy = 0; sw = info.width; sh = info.height;
          }
          const beadH = Math.max(1, Math.round(sh / sw * beadW));

          const full = wx.createOffscreenCanvas({ type: '2d', width: info.width, height: info.height });
          const fctx = full.getContext('2d');
          const img = full.createImage();
          img.onload = () => {
            try {
              fctx.drawImage(img, 0, 0, info.width, info.height);
              const fullData = fctx.getImageData(0, 0, info.width, info.height);
              const scaled = cropAndScale(fullData, info.width, sx, sy, sw, sh, beadW, beadH);
              const grid = buildGrid(scaled, beadW, beadH);

              // 使用默认 palette 匹配
              const defaultPalette = resolvePalette(0, 0);
              const defaultLAB = defaultPalette.map(c => rgbToLab(c.rgb));
              const defaultMap = {};
              defaultPalette.forEach(c => { defaultMap[c.code] = c; });

              const { matched, indices, counts } = matchColors(
                grid, beadW, beadH, defaultPalette, defaultLAB, defaultMap, 50
              );
              const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
              const total = sorted.reduce((s, e) => s + e[1], 0);

              resolve({
                id, path,
                grid: matched, idx: indices, rawGrid: grid,
                W: beadW, H: beadH,
                colorSummary: sorted.map(([code, cnt]) => ({ code, count: cnt, hex: defaultMap[code].hex })),
                totalBeads: total,
                statusText: `${beadW}×${beadH} · MARD 实色 · ${sorted.length}色 · ${total}颗`,
                processed: true,
                beadH: beadW, maxColors: 50,
                brandIdx: 0, materialIdx: 0,
                palette: defaultPalette, paletteLAB: defaultLAB, paletteMap: defaultMap,
                colorCount: sorted.length,
              });
            } catch (e) {
              console.error('_processOne error:', e);
              resolve({ id, path, processed: false, error: e });
            }
          };
          img.onerror = () => resolve({ id, path, processed: false, error: 'load' });
          img.src = path;
        },
        fail: e => resolve({ id, path, processed: false, error: e.errMsg })
      });
    });
  },

  /* ═══════════════════════════════════════════
     Phase: detail — 单图详情
     ═══════════════════════════════════════════ */
  openDetail(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ activeIdx: idx });
    this._showDetail(idx);
  },

  _showDetail(idx) {
    const item = this._images[idx];
    if (!item || !item.processed) return;

    // 从 BRANDS 解析当前图片的 palette（避免使用可能过期的 item.palette）
    this._brandIdx = item.brandIdx;
    this._materialIdx = item.materialIdx;
    this._syncMaterialData();
    const p = resolvePalette(item.brandIdx, item.materialIdx);
    this._setPalette(p);
    item.palette = p;
    item.paletteLAB = this.paletteLAB;
    item.paletteMap = this.paletteMap;

    this._activeItem = item;
    this._activeGrid = item.grid;
    this._activeIdx = item.idx;
    this._activeRawGrid = item.rawGrid;

    this.setData({
      phase: 'detail',
      activeBeadH: item.beadH,
      activeBeadHText: String(item.beadH),
      activeMaxColors: item.maxColors,
      activeMaxColorsText: String(item.maxColors),
      activeBrandIdx: item.brandIdx,
      activeMaterialIdx: item.materialIdx,
      activeStatusText: item.statusText,
      activeColorSummary: item.colorSummary,
      activeTotalBeads: item.totalBeads,
      dw: 0, dh: 0,  // 将由 _drawDetail 设置
    });

    setTimeout(() => this._drawDetail(), 200);
  },

  _drawDetail() {
    const item = this._activeItem;
    if (!item || !item.grid) return;

    const q = wx.createSelectorQuery();
    q.select('#detailCanvas').fields({ node: true }).exec(res => {
      if (!res[0]) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio;
      const W = item.grid[0].length;
      const H = item.grid.length;
      const ts = this.data.tileSize;
      const ml = 30, mt = 24;
      const cw = W * ts + ml;
      const ch = H * ts + mt;

      canvas.width = cw * dpr;
      canvas.height = ch * dpr;

      renderPattern(ctx, dpr, {
        patternGrid: item.grid,
        patternIdx: item.idx,
        palette: item.palette || [],
        beadW: W, beadH: H,
        tileSize: ts, marginLeft: ml, marginTop: mt,
        showGrid: this.data.showGrid,
        showBoard: this.data.showBoard,
        boardSize: 52,
        showCodes: this.data.showCodes
      });

      this.setData({ dw: cw, dh: ch });
    });
  },

  /* ── detail 导航 ── */
  backToList() {
    this._saveCurrentItem();
    const listData = this._images.map(item => ({
      id: item.id,
      colorCount: item.colorCount || 0,
      totalBeads: item.totalBeads || 0,
      topColors: (item.colorSummary || []).slice(0, 5).map(c => c.hex)
    }));
    this.setData({ phase: 'list', images: listData });
  },

  backToIndex() {
    wx.navigateBack();
  },

  prevImage() {
    this._saveCurrentItem();
    const idx = Math.max(0, this.data.activeIdx - 1);
    this.setData({ activeIdx: idx });
    this._showDetail(idx);
  },

  nextImage() {
    this._saveCurrentItem();
    const idx = Math.min(this._images.length - 1, this.data.activeIdx + 1);
    this.setData({ activeIdx: idx });
    this._showDetail(idx);
  },

  _saveCurrentItem() {
    const item = this._activeItem;
    if (!item) return;
    item.brandIdx = this._brandIdx;
    item.materialIdx = this._materialIdx;
    item.beadH = this.data.activeBeadH;
    item.maxColors = this.data.activeMaxColors;
    item.grid = this._activeGrid;
    item.idx = this._activeIdx;
    item.rawGrid = this._activeRawGrid;
    item.colorSummary = this.data.activeColorSummary;
    item.totalBeads = this.data.activeTotalBeads;
    item.statusText = this.data.activeStatusText;
    item.colorCount = this.data.activeColorSummary.length;
  },

  /* ── detail 参数控制 ── */
  onBeadHChanging(e) {
    this.setData({ activeBeadH: e.detail.value, activeBeadHText: String(e.detail.value) });
  },
  onBeadHSlider(e) {
    const v = e.detail.value;
    this.setData({ activeBeadH: v, activeBeadHText: String(v) });
    this._rescaleAndReprocessCurrent();
  },
  onBeadHInput(e) {
    this.setData({ activeBeadHText: e.detail.value });
  },
  onBeadHBlur(e) {
    const raw = e.detail.value;
    let v = parseInt(raw);
    if (isNaN(v) || v < 5) v = 5;
    if (v > 200) v = 200;
    this.setData({ activeBeadH: v, activeBeadHText: String(v) });
    this._rescaleAndReprocessCurrent();
  },

  onMaxColorsChanging(e) {
    this.setData({ activeMaxColors: e.detail.value, activeMaxColorsText: String(e.detail.value) });
  },
  onMaxColorsSlider(e) {
    const v = e.detail.value;
    this.setData({ activeMaxColors: v, activeMaxColorsText: String(v) });
    this._reprocessCurrent();
  },
  onMaxColorsInput(e) {
    this.setData({ activeMaxColorsText: e.detail.value });
  },
  onMaxColorsBlur(e) {
    const raw = e.detail.value;
    let v = parseInt(raw);
    if (isNaN(v) || v < 4) v = 4;
    if (v > 150) v = 150;
    this.setData({ activeMaxColors: v, activeMaxColorsText: String(v) });
    this._reprocessCurrent();
  },

  // beadH 变化：重新缩放原图 + 完整重处理
  _rescaleAndReprocessCurrent() {
    const item = this._activeItem;
    if (!item || !item.path) return;

    wx.showLoading({ title: '处理中' });
    const beadW = this.data.activeBeadH;
    const coords = this._cropCoords;

    wx.getImageInfo({
      src: item.path,
      success: info => {
        let sx, sy, sw, sh;
        if (coords) {
          sx = coords.sx; sy = coords.sy; sw = coords.sw; sh = coords.sh;
        } else {
          sx = 0; sy = 0; sw = info.width; sh = info.height;
        }
        const beadH = Math.max(1, Math.round(sh / sw * beadW));

        const full = wx.createOffscreenCanvas({ type: '2d', width: info.width, height: info.height });
        const fctx = full.getContext('2d');
        const img = full.createImage();
        img.onload = () => {
          try {
            fctx.drawImage(img, 0, 0, info.width, info.height);
            const fullData = fctx.getImageData(0, 0, info.width, info.height);
            const scaled = cropAndScale(fullData, info.width, sx, sy, sw, sh, beadW, beadH);
            const grid = buildGrid(scaled, beadW, beadH);

            item.rawGrid = grid;
            item.W = beadW;
            item.H = beadH;
            item.beadH = beadW;
            this._activeRawGrid = grid;

            // 继续做色号匹配
            this._reprocessCurrent();
            wx.hideLoading();
          } catch (e) {
            wx.hideLoading();
            console.error('_rescaleAndReprocessCurrent error:', e);
          }
        };
        img.onerror = () => { wx.hideLoading(); };
        img.src = item.path;
      },
      fail: () => { wx.hideLoading(); }
    });
  },

  _reprocessCurrent() {
    const item = this._activeItem;
    if (!item || !item.rawGrid) return;
    const { matched, indices, counts } = matchColors(
      item.rawGrid, item.W, item.H,
      this.palette, this.paletteLAB, this.paletteMap,
      this.data.activeMaxColors
    );
    this._activeGrid = matched;
    this._activeIdx = indices;
    item.grid = matched;
    item.idx = indices;

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, e) => s + e[1], 0);
    const label = this._paletteLabel();
    this.setData({
      activeColorSummary: sorted.map(([code, cnt]) => ({ code, count: cnt, hex: this.paletteMap[code].hex })),
      activeTotalBeads: total,
      activeStatusText: `${item.W}×${item.H} · ${label} · ${sorted.length}色 · ${total}颗`
    });
    item.colorSummary = this.data.activeColorSummary;
    item.totalBeads = total;
    item.statusText = this.data.activeStatusText;
    item.colorCount = sorted.length;
    // 同步 palette 引用（品牌切换后可能已变）
    item.palette = this.palette;
    item.paletteLAB = this.paletteLAB;
    item.paletteMap = this.paletteMap;
    item.brandIdx = this._brandIdx;
    item.materialIdx = this._materialIdx;

    this._drawDetail();
  },

  /* ── detail 触摸缩放 ── */
  _getDist(t) { const dx = t[0].x - t[1].x, dy = t[0].y - t[1].y; return Math.sqrt(dx * dx + dy * dy); },
  onTouchStart(e) {
    if (e.touches.length === 2) this._pinch = { d: this._getDist(e.touches), ts: this.data.tileSize };
    else this._pinch = null;
  },
  onTouchMove(e) {
    if (e.touches.length === 2 && this._pinch) {
      const v = Math.max(3, Math.min(50, Math.round(this._pinch.ts * this._getDist(e.touches) / this._pinch.d)));
      if (v !== this.data.tileSize) { this.setData({ tileSize: v }); this._drawDetail(); }
    }
  },
  onTouchEnd() { this._pinch = null; },

  /* ── detail 显示选项 ── */
  onToggleGrid(e)  { this.setData({ showGrid: e.detail.value }); this._drawDetail(); },
  onToggleBoard(e) { this.setData({ showBoard: e.detail.value }); this._drawDetail(); },
  onToggleCodes(e) { this.setData({ showCodes: e.detail.value }); this._drawDetail(); },

  /* ── detail 品牌/材质选择器 ── */
  toggleBrandPicker()    { this.setData({ showBrandPicker: !this.data.showBrandPicker, showMaterialPicker: false }); },
  toggleMaterialPicker() { this.setData({ showMaterialPicker: !this.data.showMaterialPicker, showBrandPicker: false }); },
  closePickers() { this.setData({ showBrandPicker: false, showMaterialPicker: false }); },
  noop() {},

  selectBrand(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ showBrandPicker: false });
    if (idx === this._brandIdx) return;
    this._brandIdx = idx;
    this._materialIdx = 0;
    this._syncMaterialData();
    const p = resolvePalette(idx, 0);
    this._setPalette(p);
    this.setData({ activeBrandIdx: idx, activeMaterialIdx: 0, materialNote: '' });
    if (this._activeItem && this._activeItem.rawGrid) this._reprocessCurrent();
  },

  selectMaterial(e) {
    const idx = parseInt(e.currentTarget.dataset.idx);
    this.setData({ activeMaterialIdx: idx, showMaterialPicker: false });
    this._materialIdx = idx;
    const p = resolvePalette(this._brandIdx, idx);
    this._setPalette(p);
    const b = BRANDS[this._brandIdx];
    const note = (b.materials && b.materials[idx].note) ? b.materials[idx].note : '';
    this.setData({ activeMaterialIdx: idx, materialNote: note });
    if (this._activeItem && this._activeItem.rawGrid) this._reprocessCurrent();
  },

  /* ── 品牌/材质辅助 ── */
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

  _paletteLabel(brandIdx, materialIdx) {
    const bi = brandIdx !== undefined ? brandIdx : this._brandIdx;
    const mi = materialIdx !== undefined ? materialIdx : this._materialIdx;
    const b = BRANDS[bi];
    if (b.materials) return b.name + ' · ' + b.materials[mi].name;
    return b.name;
  },

  _setPalette(p) {
    this.palette = p;
    this.paletteLAB = p.map(c => rgbToLab(c.rgb));
    this.paletteMap = {};
    p.forEach(c => { this.paletteMap[c.code] = c; });
  },

  /* ═══════════════════════════════════════════
     Export（单图 + 批量）
     ═══════════════════════════════════════════ */
  exportOne() {
    const item = this._activeItem;
    if (!item || !item.grid) return;

    wx.showLoading({ title: '导出中' });
    wx.createSelectorQuery().select('#detailCanvas').fields({ node: true }).exec(res => {
      if (!res[0]) { wx.hideLoading(); return; }
      const { exportToAlbum } = require('../../utils/exporter');
      exportToAlbum({
        canvasNode: res[0].node,
        patternGrid: item.grid, patternIdx: item.idx, palette: item.palette || [],
        paletteLabel: this._paletteLabel(),
        colorSummary: item.colorSummary, totalBeads: item.totalBeads
      }).then(() => { wx.hideLoading(); wx.showToast({ title: '已保存到相册', icon: 'success' }); })
        .catch(e => {
          wx.hideLoading();
          if (e === 'denied') wx.showModal({ title: '需要相册权限', content: '请在设置中允许', confirmText: '去设置', success: r => { if (r.confirm) wx.openSetting(); } });
          else wx.showToast({ title: '导出失败', icon: 'none' });
        });
    });
  },

  async exportAll() {
    const processed = this._images.filter(im => im.processed);
    if (!processed.length) { wx.showToast({ title: '没有可导出的图纸', icon: 'none' }); return; }

    wx.showLoading({ title: '导出中 1/' + processed.length });

    const { exportToAlbum } = require('../../utils/exporter');

    for (let i = 0; i < processed.length; i++) {
      const item = processed[i];

      await new Promise((resolve) => {
        const q = wx.createSelectorQuery();
        q.select('#exportCanvas').fields({ node: true }).exec(res => {
          if (!res[0]) { resolve(); return; }

          exportToAlbum({
            canvasNode: res[0].node,
            patternGrid: item.grid,
            patternIdx: item.idx,
            palette: item.palette || [],
            paletteLabel: this._paletteLabel(item.brandIdx, item.materialIdx),
            colorSummary: item.colorSummary,
            totalBeads: item.totalBeads
          }).then(() => resolve())
            .catch(() => resolve());
        });
      });

      wx.showLoading({ title: '导出中 ' + (i + 1) + '/' + processed.length });
      await new Promise(r => setTimeout(r, 800));
    }

    wx.hideLoading();
    wx.showToast({ title: '全部导出完成', icon: 'success' });
  }
});
