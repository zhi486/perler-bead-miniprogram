// utils/median_cut.js — 中位切割颜色量化
// 从 bead_pattern.html 直接移植

function medianCut(pixels, k) {
  if (pixels.length <= k) return pixels;

  let boxes = [{
    data: pixels,
    rMin: 0, rMax: 255, gMin: 0, gMax: 255, bMin: 0, bMax: 255
  }];

  while (boxes.length < k) {
    // 按色彩方差选择待分割色盒（替代旧算法的体积选择）
    // 方差大 → 盒内颜色差异大（如肤色+嘴唇共存）→ 应优先分配色板配额
    let bestI = 0, bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.data.length < 2) continue;  // 单像素无法再分割

      let sumR = 0, sumG = 0, sumB = 0;
      for (const p of b.data) { sumR += p[0]; sumG += p[1]; sumB += p[2]; }
      const n = b.data.length;
      const mR = sumR / n, mG = sumG / n, mB = sumB / n;

      let variance = 0;
      for (const p of b.data) {
        const dr = p[0] - mR, dg = p[1] - mG, db = p[2] - mB;
        variance += dr * dr + dg * dg + db * db;
      }

      if (variance > bestScore) { bestScore = variance; bestI = i; }
    }

    // 所有色盒方差为零 → 颜色已收敛，无需继续
    if (bestScore <= 0) break;

    const box = boxes[bestI];
    const rngR = box.rMax - box.rMin, rngG = box.gMax - box.gMin, rngB = box.bMax - box.bMin;
    const ch = rngR >= rngG && rngR >= rngB ? 0 : (rngG >= rngB ? 1 : 2);

    box.data.sort((a, b) => a[ch] - b[ch]);
    const mid = box.data.length >> 1;
    if (mid === 0) break;

    const left = box.data.slice(0, mid);
    const right = box.data.slice(mid);

    boxes[bestI] = {
      data: left,
      rMin: Math.min(...left.map(p => p[0])), rMax: Math.max(...left.map(p => p[0])),
      gMin: Math.min(...left.map(p => p[1])), gMax: Math.max(...left.map(p => p[1])),
      bMin: Math.min(...left.map(p => p[2])), bMax: Math.max(...left.map(p => p[2]))
    };
    boxes.push({
      data: right,
      rMin: Math.min(...right.map(p => p[0])), rMax: Math.max(...right.map(p => p[0])),
      gMin: Math.min(...right.map(p => p[1])), gMax: Math.max(...right.map(p => p[1])),
      bMin: Math.min(...right.map(p => p[2])), bMax: Math.max(...right.map(p => p[2]))
    });
  }

  return boxes.map(b => {
    const s = b.data.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    const n = b.data.length;
    return [Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n)];
  });
}

function quantize(grid, maxColors) {
  const H = grid.length, W = grid[0].length;

  // 统计原始网格中的唯一色数（不做加权，避免误判）
  const uniq = new Set();
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      uniq.add(grid[r][c].join(','));
  if (uniq.size <= maxColors) return grid;

  // 构建加权像素列表：局部对比度高的"特征像素"按比例复制
  // 使其在方差计算中获得更高权重 → 细小特征颜色更不易被吞并
  const pixels = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const p = grid[r][c];

      // 与 8 邻域的平均色彩差异（局部对比度）
      let contrast = 0, cnt = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
          const q = grid[nr][nc];
          contrast += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          cnt++;
        }
      }
      contrast = cnt > 0 ? contrast / cnt : 0;

      // 权重：基础 1 份 + 最多 4 份额外副本
      // contrast/500 ≈ 阈值：每通道差 ~13 得 1 份额外，差 ~22 得 3 份
      const extra = Math.min(4, Math.floor(contrast / 500));
      for (let w = 0; w <= extra; w++) {
        pixels.push([...p]);
      }
    }
  }

  const palette = medianCut(pixels, maxColors);

  const out = [];
  for (let r = 0; r < grid.length; r++) {
    out[r] = [];
    for (let c = 0; c < grid[0].length; c++) {
      const p = grid[r][c];
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < palette.length; i++) {
        const dr = p[0] - palette[i][0], dg = p[1] - palette[i][1], db = p[2] - palette[i][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      out[r][c] = palette[bestI];
    }
  }
  return out;
}

module.exports = { medianCut, quantize };
