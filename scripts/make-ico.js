// Packs the PNG size variants into a Windows .ico (PNG-compressed entries).
const fs = require('node:fs');
const path = require('node:path');

const dir = path.resolve(__dirname, '..', 'build');
const sizes = [16, 24, 32, 48, 64, 128, 256];

const pngs = sizes.map((s) => ({ s, data: fs.readFileSync(path.join(dir, `icon-${s}.png`)) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = [];
const blobs = [];

for (const { s, data } of pngs) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(s >= 256 ? 0 : s, 0);
  entry.writeUInt8(s >= 256 ? 0 : s, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  blobs.push(data);
  offset += data.length;
}

const out = Buffer.concat([header, ...entries, ...blobs]);
fs.writeFileSync(path.join(dir, 'icon.ico'), out);
console.log(`wrote ${path.join(dir, 'icon.ico')} (${out.length} bytes, ${sizes.length} sizes)`);
