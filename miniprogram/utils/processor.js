// utils/processor.js — 共享图片处理纯函数
// 供 index.js / crop.js / batch.js 复用，无 wx API 依赖
const { quantize } = require('./median_cut');
const { findNearestColor } = require('./color_matcher');

/**
 * 从全图 ImageData 中提取裁剪区域，最近邻缩放到目标尺寸
 * @param {ImageData} fullImageData - 全图的 ImageData
 * @param {number} imgWidth - 全图宽度（像素）
 * @param {number} sx - 裁剪起点 x（原图像素坐标）
 * @param {number} sy - 裁剪起点 y
 * @param {number} sw - 裁剪区宽度
 * @param {number} sh - 裁剪区高度
 * @param {number} targetW - 目标宽度（豆子数）
 * @param {number} targetH - 目标高度（豆子数）
 * @returns {Uint8ClampedArray} 缩放后的 RGBA 像素数组（targetW × targetH × 4）
 */
function cropAndScale(fullImageData, imgWidth, sx, sy, sw, sh, targetW, targetH) {
  // Step 1: 从 ArrayBuffer 零拷贝提取裁剪区域
  const crop = new Uint8ClampedArray(sw * sh * 4);
  for (let r = 0; r < sh; r++) {
    const srcOff = ((sy + r) * imgWidth + sx) * 4;
    crop.set(new Uint8ClampedArray(fullImageData.data.buffer, srcOff, sw * 4), r * sw * 4);
  }

  // Step 2: 最近邻缩放到目标豆子尺寸
  const scaled = new Uint8ClampedArray(targetW * targetH * 4);
  for (let r = 0; r < targetH; r++) {
    const srcR = Math.floor(r * sh / targetH);
    for (let c = 0; c < targetW; c++) {
      const srcC = Math.floor(c * sw / targetW);
      const si = (srcR * sw + srcC) * 4;
      const di = (r * targetW + c) * 4;
      scaled[di]     = crop[si];
      scaled[di + 1] = crop[si + 1];
      scaled[di + 2] = crop[si + 2];
      scaled[di + 3] = 255;
    }
  }
  return scaled;
}

/**
 * 将 RGBA 像素数组构建为二维 RGB grid
 * @param {Uint8ClampedArray} data - RGBA 像素数据
 * @param {number} W - 宽度（列数）
 * @param {number} H - 高度（行数）
 * @returns {Array<Array<[number,number,number]>>} H×W 的 [r,g,b] 数组
 */
function buildGrid(data, W, H) {
  const grid = [];
  for (let r = 0; r < H; r++) {
    grid[r] = [];
    for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4;
      grid[r][c] = [data[i], data[i + 1], data[i + 2]];
    }
  }
  return grid;
}

/**
 * 量化 + 色号匹配 + 汇总统计
 * @param {Array<Array<[number,number,number]>>} srcGrid - H×W 的原始 RGB grid
 * @param {number} W - 宽度
 * @param {number} H - 高度
 * @param {Array} palette - 色卡数组
 * @param {Array} paletteLAB - 预计算的 LAB 值
 * @param {Object} paletteMap - code → { code, hex, rgb } 映射
 * @param {number} maxColors - 量化目标颜色数
 * @returns {{ matched: Array, indices: Array, counts: Object }}
 */
function matchColors(srcGrid, W, H, palette, paletteLAB, paletteMap, maxColors) {
  const q = quantize(srcGrid, maxColors);
  const matched = [], indices = [], counts = {};
  for (let r = 0; r < H; r++) {
    matched[r] = []; indices[r] = [];
    for (let c = 0; c < W; c++) {
      const n = findNearestColor(q[r][c], paletteLAB, palette);
      matched[r][c] = n.rgb;
      indices[r][c] = n.index;
      counts[n.code] = (counts[n.code] || 0) + 1;
    }
  }
  return { matched, indices, counts };
}

module.exports = { cropAndScale, buildGrid, matchColors };
