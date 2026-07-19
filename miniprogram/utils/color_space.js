// utils/color_space.js — CIE LAB 色彩空间转换
// 从 bead_pattern.html 直接移植

function rgbToLab([r, g, b]) {
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  const x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  const y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750) / 1.0;
  const z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;

  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const L = 116 * f(y) - 16;
  const a = 500 * (f(x) - f(y));
  const bv = 200 * (f(y) - f(z));

  return [L, a, bv];
}

function deltaE(l1, l2) {
  const dL = l1[0] - l2[0], da = l1[1] - l2[1], db = l1[2] - l2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

module.exports = { rgbToLab, deltaE };
