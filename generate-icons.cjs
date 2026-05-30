const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

function createPNG(size) {
  const cx = size / 2, cy = size / 2;
  const r = size / 2;

  const ex = cx, ey = cy + size * 0.05;
  const erx = size * 0.28, ery = size * 0.18;

  const sx = cx, sy = cy - size * 0.10;
  const sr = size * 0.14;

  const rowLen = size * 4;
  const raw = Buffer.alloc((rowLen + 1) * size);

  for (let y = 0; y < size; y++) {
    raw[y * (rowLen + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      const offset = y * (rowLen + 1) + 1 + x * 4;
      const inOuter = dx * dx + dy * dy <= r * r;
      if (!inOuter) {
        raw[offset] = raw[offset+1] = raw[offset+2] = raw[offset+3] = 0;
        continue;
      }
      const ex2 = x - ex + 0.5, ey2 = y - ey + 0.5;
      const inEllipse = (ex2*ex2)/(erx*erx) + (ey2*ey2)/(ery*ery) <= 1;
      const sdx = x - sx + 0.5, sdy = y - sy + 0.5;
      const inSmall = sdx*sdx + sdy*sdy <= sr*sr;
      if (inEllipse || inSmall) {
        raw[offset] = 0x0E; raw[offset+1] = 0x1F; raw[offset+2] = 0x40; raw[offset+3] = 255;
      } else {
        raw[offset] = 0x8D; raw[offset+1] = 0xD6; raw[offset+2] = 0x3F; raw[offset+3] = 255;
      }
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });

for (const size of [180, 192, 512]) {
  const png = createPNG(size);
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  fs.writeFileSync(path.join(__dirname, 'public', name), png);
  console.log(`Generated public/${name} (${png.length} bytes)`);
}
console.log('Icons generated successfully.');
