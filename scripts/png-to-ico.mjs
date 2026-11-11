// Wrap a square PNG (ideally 256x256) into a single-image .ico.
// Windows Vista+ accepts PNG payloads inside ICO, so no bitmap re-encoding is needed.
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/png-to-ico.mjs <input.png> <output.ico>');
  process.exit(1);
}
const png = readFileSync(input);
if (png.toString('latin1', 1, 4) !== 'PNG') throw new Error('input is not a PNG file');
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== height) throw new Error(`icon must be square, got ${width}x${height}`);
if (width > 256) throw new Error(`icon must be <= 256px, got ${width}`);

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(1, 4); // image count

const entry = Buffer.alloc(16);
entry.writeUInt8(width === 256 ? 0 : width, 0); // 0 means 256
entry.writeUInt8(height === 256 ? 0 : height, 1);
entry.writeUInt8(0, 2); // palette size
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // offset = 6 + 16

writeFileSync(output, Buffer.concat([dir, entry, png]));
console.log(`wrote ${output} (${width}x${height}, ${png.length + 22} bytes)`);
