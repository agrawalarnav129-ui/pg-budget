// Generates the PWA / Home Screen icons without any image tooling.
// Design: teal square with a white rupee-coin circle and three rising bars.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const TEAL = [15, 118, 110];
const WHITE = [255, 255, 255];
const LIGHT = [153, 222, 212];

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4× supersampling for smooth edges
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 2; sy++)
        for (let sx = 0; sx < 2; sx++) {
          const c = pixel((x + (sx + 0.5) / 2) / size, (y + (sy + 0.5) / 2) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r / 4; raw[i + 1] = g / 4; raw[i + 2] = b / 4; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Full-bleed square (iOS rounds corners itself; also safe as maskable).
function pixel(u, v) {
  // Bars, anchored to a baseline, within the maskable safe zone (centre 60%).
  const base = 0.72;
  const bars = [
    { x0: 0.27, x1: 0.39, top: 0.52, color: LIGHT },
    { x0: 0.44, x1: 0.56, top: 0.41, color: LIGHT },
    { x0: 0.61, x1: 0.73, top: 0.28, color: WHITE },
  ];
  for (const b of bars) {
    const r = 0.03;
    if (u >= b.x0 && u <= b.x1 && v <= base && v >= b.top) {
      // rounded top corners
      const cy = b.top + r;
      if (v < cy) {
        const cx = u < b.x0 + r ? b.x0 + r : u > b.x1 - r ? b.x1 - r : u;
        if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) continue;
      }
      return b.color;
    }
  }
  return TEAL;
}

mkdirSync('public/icons', { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(`public/icons/${name}`, png(size, pixel));
}
writeFileSync(
  'public/icons/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0f766e"/><rect x="27" y="52" width="12" height="20" rx="3" fill="#99ded4"/><rect x="44" y="41" width="12" height="31" rx="3" fill="#99ded4"/><rect x="61" y="28" width="12" height="44" rx="3" fill="#fff"/></svg>`,
);
console.log('icons written');
