// utils/exporter.js — PNG 导出到相册

function exportToAlbum(opts) {
  const {
    canvasNode,
    patternGrid, patternIdx, palette,
    paletteMode, colorSummary, totalBeads
  } = opts;

  const beadW = patternGrid[0].length, beadH = patternGrid.length;
  const { renderPattern } = require('./renderer');

  // 导出高清图（tileSize 放大到 30px）
  const exportTile = 30;
  const marginLeft = 30, marginTop = 24;
  const srcW = beadW * exportTile + marginLeft;
  const srcH = beadH * exportTile + marginTop;

  // 布局参数
  const innerPad = 20, titleH = 32, entryH = 20, summaryH = 32, footerH = 28;
  const colW = 145, qrAreaW = 250;
  const sorted = colorSummary;
  const cols = Math.min(5, Math.max(1, Math.ceil(sorted.length / 18)));
  const rowsPerCol = Math.ceil(sorted.length / cols);
  const legendH = titleH + rowsPerCol * entryH + summaryH + innerPad;
  const legendW = Math.max(srcW, cols * colW + innerPad * 2 + qrAreaW);
  const totalH = srcH + legendH + footerH;

  // 创建离屏合成画布
  const offCanvas = wx.createOffscreenCanvas({
    type: '2d',
    width: legendW,
    height: totalH
  });
  const ctx = offCanvas.getContext('2d');

  // 白色背景
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, legendW, totalH);

  // 绘制预览图案
  renderPattern(ctx, 1, {
    patternGrid, patternIdx, palette,
    beadW, beadH, tileSize: exportTile,
    marginLeft, marginTop,
    showGrid: true, showBoard: true, showCodes: true
  });

  // 分隔线
  const sepY = srcH;
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(innerPad, sepY);
  ctx.lineTo(legendW - innerPad, sepY);
  ctx.stroke();

  // 图例标题
  let ly = sepY + 12;
  ctx.fillStyle = '#333';
  ctx.font = 'bold 14px -apple-system, "Microsoft YaHei", sans-serif';
  ctx.fillText('📋 所需豆子清单', innerPad, ly + 13);

  // 颜色条目
  ly += titleH;
  for (let i = 0; i < sorted.length; i++) {
    const { code, count, hex } = sorted[i];
    const col = Math.floor(i / rowsPerCol);
    const row = i % rowsPerCol;
    const ex = innerPad + col * colW;
    const ey = ly + row * entryH;

    ctx.fillStyle = hex;
    ctx.fillRect(ex, ey + 2, 16, 14);
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ex, ey + 2, 16, 14);

    ctx.fillStyle = '#222';
    ctx.font = 'bold 12px -apple-system, "Microsoft YaHei", sans-serif';
    ctx.fillText(code, ex + 22, ey + 13);

    ctx.fillStyle = '#555';
    ctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif';
    ctx.fillText(count + ' 颗', ex + 72, ey + 13);
  }

  // 汇总
  ly += rowsPerCol * entryH + 8;
  ctx.fillStyle = '#333';
  ctx.font = 'bold 12px -apple-system, "Microsoft YaHei", sans-serif';
  ctx.fillText(
    '共 ' + sorted.length + ' 种颜色 · ' + totalBeads + ' 颗豆子 · ' +
    beadW + '×' + beadH + ' · ' + paletteMode + '色卡',
    innerPad, ly + 10
  );

  // 页脚
  ctx.fillStyle = '#bbb';
  ctx.font = '11px -apple-system, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🧩 拼豆图纸生成器 · 微信小程序', legendW / 2, totalH - 8);
  ctx.textAlign = 'start';

  // ═══ 异步加载二维码 → 画在图例右侧 → 导出 ═══
  return new Promise((resolve, reject) => {
    if (!canvasNode) { reject(new Error('no canvas')); return; }

    const qrImg = offCanvas.createImage();
    qrImg.onload = () => {
      try {
        drawQRright(ctx, legendW, sepY, qrImg);
        doExport(canvasNode, offCanvas, legendW, totalH, resolve, reject);
      } catch (e) { reject(e); }
    };
    qrImg.onerror = () => {
      doExport(canvasNode, offCanvas, legendW, totalH, resolve, reject);
    };
    try {
      const fs = wx.getFileSystemManager();
      const b64 = fs.readFileSync('/assets/qrcode.jpg', 'base64');
      qrImg.src = 'data:image/jpeg;base64,' + b64;
    } catch (e) {
      doExport(canvasNode, offCanvas, legendW, totalH, resolve, reject);
    }
  });
}

/* ── 在图例右侧画二维码，顶部与图例标题齐平 ── */
function drawQRright(ctx, legendW, sepY, qrImg) {
  const innerPad = 20;
  const qrSize = 110;
  const qrLeft = legendW - innerPad - qrSize;
  // 顶部与图例标题 "📋 所需豆子清单" 齐平
  const qrTop = sepY + 12;

  // 左侧引导文字
  ctx.textAlign = 'right';
  ctx.fillStyle = '#444';
  ctx.font = 'bold 15px -apple-system, "Microsoft YaHei", sans-serif';
  ctx.fillText('扫码使用 拼豆图纸生成器', qrLeft - 14, qrTop + 22);
  ctx.fillStyle = '#999';
  ctx.font = '12px -apple-system, "Microsoft YaHei", sans-serif';
  ctx.fillText('微信小程序 · 免费使用', qrLeft - 14, qrTop + 42);
  ctx.textAlign = 'start';

  // 二维码白边
  const qrPad = 4;
  ctx.fillStyle = '#fff';
  ctx.fillRect(qrLeft - qrPad, qrTop - qrPad, qrSize + qrPad * 2, qrSize + qrPad * 2);
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.strokeRect(qrLeft - qrPad, qrTop - qrPad, qrSize + qrPad * 2, qrSize + qrPad * 2);
  ctx.drawImage(qrImg, qrLeft, qrTop, qrSize, qrSize);
}

/* ── 借真实 Canvas 导出到相册 ── */
function doExport(canvasNode, offCanvas, legendW, totalH, resolve, reject) {
  const rctx = canvasNode.getContext('2d');
  const prevW = canvasNode.width, prevH = canvasNode.height;

  canvasNode.width = legendW;
  canvasNode.height = totalH;
  rctx.fillStyle = '#fff';
  rctx.fillRect(0, 0, legendW, totalH);
  rctx.drawImage(offCanvas, 0, 0);

  const restore = () => {
    canvasNode.width = prevW;
    canvasNode.height = prevH;
    const pages = getCurrentPages();
    const pg = pages[pages.length - 1];
    if (pg && typeof pg.draw === 'function') pg.draw();
  };

  setTimeout(() => {
    wx.canvasToTempFilePath({
      canvas: canvasNode,
      x: 0, y: 0, width: legendW, height: totalH,
      success: r => {
        restore();
        wx.saveImageToPhotosAlbum({
          filePath: r.tempFilePath,
          success: resolve,
          fail: err => {
            if (err.errMsg.indexOf('auth deny') !== -1) reject('denied');
            else reject(err);
          }
        });
      },
      fail: err => { restore(); reject(err); }
    });
  }, 150);
}

module.exports = { exportToAlbum };
