import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
// Deterministic, original artwork. PNG is generated without image dependencies.
const size = 512; const data = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const i = y * (size * 4 + 1) + 1 + x * 4;
  const inside = (x >= 100 && x < 412 && y >= 170 && y < 410) || (x >= 62 && x < 100 && y >= 244 && y < 338) || (x >= 412 && x < 450 && y >= 244 && y < 338) || (x >= 241 && x < 271 && y >= 102 && y < 170);
  const hole = (x >= 170 && x < 204 && y >= 250 && y < 290) || (x >= 308 && x < 342 && y >= 250 && y < 290) || (x >= 202 && x < 310 && y >= 346 && y < 367);
  const color = inside && !hole ? [178, 198, 160] : [25, 31, 31];
  data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
writeFileSync('assets/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]));
