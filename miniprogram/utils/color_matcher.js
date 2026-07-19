// utils/color_matcher.js — 色卡最近邻匹配
// 从 bead_pattern.html 直接移植
const { rgbToLab, deltaE } = require('./color_space');

function findNearestColor(rgb, paletteLAB, palette) {
  const lab = rgbToLab(rgb);
  let bestI = 0, bestD = Infinity;

  for (let i = 0; i < paletteLAB.length; i++) {
    const d = deltaE(lab, paletteLAB[i]);
    if (d < bestD) { bestD = d; bestI = i; }
  }

  return {
    index: bestI,
    code: palette[bestI].code,
    hex: palette[bestI].hex,
    rgb: palette[bestI].rgb
  };
}

module.exports = { findNearestColor };
