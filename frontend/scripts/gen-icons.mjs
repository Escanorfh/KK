// يستخرج أيقونات PWA (PNG) بدون أي اعتماديات خارجية
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const BG = [29, 78, 216]; // primary-700
const FG = [255, 255, 255];
const ACCENT = [96, 165, 250];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** عجلة مسننة: نصف قطر الحد الخارجي يتغير مع عدد الأسنان */
function gearRadius(angle, teeth, base, tip) {
  const step = (Math.PI * 2) / teeth;
  const a = ((angle % step) + step) % step;
  const half = step * 0.32;
  if (a < half || a > step - half) return tip;
  return base;
}

function draw(size, { scale, holeRatio, ring }) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const base = size * 0.245 * scale;
  const tip = size * 0.315 * scale;
  const hole = size * holeRatio * scale;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let rgb = BG;
      let a = 255;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const edge = gearRadius(Math.atan2(dy, dx), 9, base, tip);
      // جسم العجلة: يملأ بين الثقب الخارجي والحد، مع تنعيم الحواف بيكسل واحد
      if (d < edge + 1 && d > hole) {
        rgb = FG;
        a = Math.round(255 * clamp01(edge + 1 - d));
      }
      if (ring && Math.abs(d - size * 0.42 * scale) < size * 0.012) rgb = ACCENT;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = a;
    }
  }
  return px;
}

const outDir = path.resolve(process.argv[2] || "public");
fs.mkdirSync(outDir, { recursive: true });

// الأيقونات القياسية (خلفية مربعة كاملة — الأغلفة تدوّرها تلقائيًا)
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `pwa-${size}x${size}.png`), encodePng(size, draw(size, { scale: 1, holeRatio: 0.10, ring: true })));
}
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), encodePng(180, draw(180, { scale: 1, holeRatio: 0.10, ring: false })));
// أيقونة maskable: نفس التصميم مع تقليص المحتوى داخل المنطقة الآمنة
fs.writeFileSync(path.join(outDir, "pwa-maskable-512.png"), encodePng(512, draw(512, { scale: 0.78, holeRatio: 0.11, ring: false })));

/** ملف .ico بحجم واحد 256×256 يحمل PNG داخليًا (مدعوم من Windows Vista+) */
function encodeIco(pngBuffer, size) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // نوع: أيقونة
  dir.writeUInt16LE(1, 4); // عدد الصور
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[4] = 1; // planes
  entry[6] = 32; // عمق اللون
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(dir.length + entry.length, 12);
  return Buffer.concat([dir, entry, pngBuffer]);
}

const icoDir = path.resolve("build");
fs.mkdirSync(icoDir, { recursive: true });
const icon256 = encodePng(256, draw(256, { scale: 1, holeRatio: 0.10, ring: true }));
fs.writeFileSync(path.join(icoDir, "icon.ico"), encodeIco(icon256, 256));
fs.writeFileSync(path.join(icoDir, "icon.png"), icon256);
console.log("icons written to", outDir, "and", icoDir);
