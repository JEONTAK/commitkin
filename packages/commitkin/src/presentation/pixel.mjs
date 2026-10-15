import { deflateSync } from 'node:zlib';

// Original 5x7 bitmap lettering; no external font or sprite file is loaded.
const GLYPHS = {
  A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['111','010','010','010','010','010','111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],'1':['010','110','010','010','010','010','111'],'2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],'6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],
  '-':['000','000','000','111','000','000','000'],'.':['0','0','0','0','0','1','1'],':':['0','1','1','0','1','1','0'],'/':['00001','00001','00010','00100','01000','10000','10000'],'+':['000','010','010','111','010','010','000'],'?':['01110','10001','00010','00100','00100','00000','00100'],' ':['000','000','000','000','000','000','000'],
  '·':['0','0','0','1','0','0','0'],',':['00','00','00','00','00','01','10'],"'":['1','1','0','0','0','0','0'],'’':['1','1','0','0','0','0','0']
};

export function canvas(width, height, background = [15, 22, 30]) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 2000000) throw new TypeError('CANVAS_INVALID');
  const pixels = Buffer.alloc(width * height * 3);
  const rect = (x, y, w, h, color) => {
    for (let cy = Math.max(0, Math.floor(y)); cy < Math.min(height, y + h); cy++) for (let cx = Math.max(0, Math.floor(x)); cx < Math.min(width, x + w); cx++) {
      const at = (cy * width + cx) * 3; pixels[at] = color[0]; pixels[at + 1] = color[1]; pixels[at + 2] = color[2];
    }
  };
  rect(0, 0, width, height, background);
  function text(value, x, y, color, scale = 2, maxWidth = width - x) {
    let at = x;
    for (const char of String(value).toUpperCase()) {
      const glyph = GLYPHS[char] ?? GLYPHS['?'];
      const advance = (glyph[0].length + 1) * scale;
      if (at + advance > x + maxWidth) break;
      glyph.forEach((row, gy) => [...row].forEach((point, gx) => { if (point === '1') rect(at + gx * scale, y + gy * scale, scale, scale, color); }));
      at += advance;
    }
    return at;
  }
  return { width, height, pixels, rect, text };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => { let c = index; for (let n = 0; n < 8; n++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(data) { let c = 0xffffffff; for (const byte of data) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const label = Buffer.from(type); const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); label.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([label, data])), data.length + 8); return result;
}
export function encodePng(surface) {
  const { width, height, pixels } = surface;
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
