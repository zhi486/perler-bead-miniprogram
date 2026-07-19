// 从 beadcolors GitHub 仓库下载色卡 CSV 并转为小程序 JS 格式
// 用法: node tools/fetch_palettes.js
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const BRANDS = [
  { file: 'artkal_s.csv', out: 'palette_artkal_s.js', name: 'Artkal S (5mm)' },
  { file: 'hama.csv',      out: 'palette_hama.js',      name: 'Hama Midi' },
  { file: 'perler.csv',    out: 'palette_perler.js',    name: 'Perler' },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'bead-palette-fetcher' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data.trim()));
    }).on('error', reject);
  });
}

function csvToJS(csv) {
  const colors = [];
  for (const line of csv.split('\n')) {
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const code = parts[0].trim();
    const r = parseInt(parts[2]), g = parseInt(parts[3]), b = parseInt(parts[4]);
    if (isNaN(r)) continue;
    const hex = '#' + [r,g,b].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
    colors.push({ code, hex, rgb: [r, g, b] });
  }
  // 单行输出节省体积
  return 'module.exports=' + JSON.stringify(colors) + ';';
}

async function main() {
  const BASE = 'https://raw.githubusercontent.com/maxcleme/beadcolors/master/raw/';
  for (const b of BRANDS) {
    const csv = await fetch(BASE + b.file);
    const js = csvToJS(csv);
    const outPath = path.join(DATA_DIR, b.out);
    fs.writeFileSync(outPath, js);
    const count = csv.split('\n').filter(l => l.includes(',')).length;
    console.log(`✅ ${b.name}: ${count} 色 → ${b.out}`);
  }
  console.log('\n完成！请在小程序中引入新的色卡文件。');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
