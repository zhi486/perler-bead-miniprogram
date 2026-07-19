// utils/median_cut.js — 中位切割颜色量化
// 从 bead_pattern.html 直接移植

function medianCut(pixels, k) {
  if (pixels.length <= k) return pixels;

  let boxes = [{
    data: pixels,
    rMin: 0, rMax: 255, gMin: 0, gMax: 255, bMin: 0, bMax: 255
  }];

  while (boxes.length < k) {
    let bestI = 0, bestVol = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const vol = (b.rMax - b.rMin + 1) * (b.gMax - b.gMin + 1) * (b.bMax - b.bMin + 1);
      if (vol > bestVol) { bestVol = vol; bestI = i; }
    }

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
  const pixels = [];
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[0].length; c++)
      pixels.push([...grid[r][c]]);

  const uniq = new Set(pixels.map(p => p.join(',')));
  if (uniq.size <= maxColors) return grid;

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
