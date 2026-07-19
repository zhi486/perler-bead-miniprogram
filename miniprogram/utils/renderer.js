// utils/renderer.js — Canvas 2D 图案渲染
// 从 bead_pattern.html render() 移植，适配微信 Canvas 2D

function renderPattern(ctx, dpr, opts) {
  const {
    patternGrid, patternIdx, palette,
    beadW, beadH, tileSize,
    marginLeft = 30, marginTop = 24,
    showGrid = true, showBoard = true,
    boardSize = 52, showCodes = true
  } = opts;

  ctx.save();
  ctx.scale(dpr, dpr);

  // 白色背景
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, (beadW * tileSize + marginLeft), (beadH * tileSize + marginTop));

  // 绘制像素色块
  for (let r = 0; r < beadH; r++) {
    for (let c = 0; c < beadW; c++) {
      const [rr, gg, bb] = patternGrid[r][c];
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fillRect(marginLeft + c * tileSize, marginTop + r * tileSize, tileSize, tileSize);
    }
  }

  // 网格线
  if (showGrid) {
    // 普通网格线（浅灰细线）
    for (let y = 1; y < beadH; y++) {
      if (y % 5 !== 0) {
        ctx.fillStyle = '#ddd';
        ctx.fillRect(marginLeft, marginTop + y * tileSize, beadW * tileSize, 1);
      }
    }
    for (let x = 1; x < beadW; x++) {
      if (x % 5 !== 0) {
        ctx.fillStyle = '#ddd';
        ctx.fillRect(marginLeft + x * tileSize, marginTop, 1, beadH * tileSize);
      }
    }
    // 强调网格线（白色光晕 + 深色线芯）
    for (let y = 5; y < beadH; y += 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.50)';
      ctx.fillRect(marginLeft, marginTop + y * tileSize - 1, beadW * tileSize, 3);
      ctx.fillStyle = '#444';
      ctx.fillRect(marginLeft, marginTop + y * tileSize, beadW * tileSize, 1);
    }
    for (let x = 5; x < beadW; x += 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.50)';
      ctx.fillRect(marginLeft + x * tileSize - 1, marginTop, 3, beadH * tileSize);
      ctx.fillStyle = '#444';
      ctx.fillRect(marginLeft + x * tileSize, marginTop, 1, beadH * tileSize);
    }
    // 交叉点断点
    for (let y = 0; y < beadH; y++) {
      for (let x = 0; x < beadW; x++) {
        const hEmph = y % 5 === 0, vEmph = x % 5 === 0;
        if (hEmph || vEmph) {
          const gap = Math.max(hEmph ? 3 : 1, vEmph ? 3 : 1);
          const [rr, gg, bb] = patternGrid[y][x];
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
          ctx.fillRect(marginLeft + x * tileSize, marginTop + y * tileSize, gap, gap);
        }
      }
    }
  }

  // 底板边界线
  if (showGrid && showBoard) {
    ctx.fillStyle = '#5090d0';
    for (let y = boardSize; y < beadH; y += boardSize)
      ctx.fillRect(marginLeft, marginTop + y * tileSize, beadW * tileSize, 1);
    for (let x = boardSize; x < beadW; x += boardSize)
      ctx.fillRect(marginLeft + x * tileSize, marginTop, 1, beadH * tileSize);
  }

  // 色号标注
  if (showCodes && tileSize >= 10) {
    const fontSize = Math.max(7, Math.round(tileSize * 0.45));
    ctx.font = `${fontSize}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < beadH; r++) {
      for (let c = 0; c < beadW; c++) {
        const code = palette[patternIdx[r][c]].code;
        const [rr, gg, bb] = patternGrid[r][c];
        const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
        ctx.fillStyle = lum > 128 ? '#000' : '#fff';
        ctx.fillText(code, marginLeft + c * tileSize + tileSize / 2, marginTop + r * tileSize + tileSize / 2);
      }
    }
  }

  // 坐标标签
  const interval = Math.max(beadW, beadH) < 30 ? 1 : 5;
  ctx.fillStyle = '#666';
  ctx.font = `${Math.max(9, tileSize - 4)}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  for (let c = 0; c < beadW; c += interval)
    ctx.fillText(String(c + 1), marginLeft + c * tileSize + tileSize / 2, marginTop - 6);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < beadH; r += interval)
    ctx.fillText(String(r + 1), marginLeft - 4, marginTop + r * tileSize + tileSize / 2);
  ctx.textBaseline = 'alphabetic';

  ctx.restore();
}

module.exports = { renderPattern };
