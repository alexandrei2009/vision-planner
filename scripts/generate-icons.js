const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "icons");

const COLORS = {
  background: [16, 24, 32, 255],
  gold: [233, 180, 76, 255],
  ink: [16, 24, 32, 255],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function setPixel(buffer, size, x, y, color) {
  if (x < 0 || x >= size || y < 0 || y >= size) {
    return;
  }

  const index = (y * size + x) * 4;
  buffer[index] = color[0];
  buffer[index + 1] = color[1];
  buffer[index + 2] = color[2];
  buffer[index + 3] = color[3];
}

function fillRect(buffer, size, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setPixel(buffer, size, col, row, color);
    }
  }
}

function fillRoundedRect(buffer, size, x, y, width, height, radius, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const left = col < x + radius;
      const right = col >= x + width - radius;
      const top = row < y + radius;
      const bottom = row >= y + height - radius;

      if ((left || right) && (top || bottom)) {
        const cx = left ? x + radius : x + width - radius - 1;
        const cy = top ? y + radius : y + height - radius - 1;
        const dx = col - cx;
        const dy = row - cy;
        if (dx * dx + dy * dy > radius * radius) {
          continue;
        }
      }

      setPixel(buffer, size, col, row, color);
    }
  }
}

function drawThickLine(buffer, size, x1, y1, x2, y2, thickness, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const radius = Math.floor(thickness / 2);

  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + (dx * step) / steps);
    const y = Math.round(y1 + (dy * step) / steps);
    fillRect(buffer, size, x - radius, y - radius, thickness, thickness, color);
  }
}

function drawIcon(size, maskable = false) {
  const pixels = Buffer.alloc(size * size * 4);
  fillRect(pixels, size, 0, 0, size, size, COLORS.background);

  const pad = Math.round(size * (maskable ? 0.16 : 0.12));
  fillRoundedRect(
    pixels,
    size,
    pad,
    pad,
    size - pad * 2,
    size - pad * 2,
    Math.round(size * 0.16),
    COLORS.gold,
  );

  const stroke = Math.max(10, Math.round(size * 0.065));
  drawThickLine(pixels, size, Math.round(size * 0.29), Math.round(size * 0.32), Math.round(size * 0.42), Math.round(size * 0.71), stroke, COLORS.ink);
  drawThickLine(pixels, size, Math.round(size * 0.56), Math.round(size * 0.32), Math.round(size * 0.42), Math.round(size * 0.71), stroke, COLORS.ink);

  const pX = Math.round(size * 0.59);
  const pY = Math.round(size * 0.31);
  const pW = Math.round(size * 0.19);
  const pH = Math.round(size * 0.42);
  const bar = Math.round(size * 0.055);
  fillRect(pixels, size, pX, pY, bar, pH, COLORS.ink);
  fillRect(pixels, size, pX, pY, pW, bar, COLORS.ink);
  fillRect(pixels, size, pX, pY + Math.round(size * 0.2), pW, bar, COLORS.ink);
  fillRect(pixels, size, pX + pW - bar, pY, bar, Math.round(size * 0.25), COLORS.ink);

  return encodePng(size, size, pixels);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(OUT_DIR, "icon-192.png"), drawIcon(192)),
    fs.writeFile(path.join(OUT_DIR, "icon-512.png"), drawIcon(512)),
    fs.writeFile(path.join(OUT_DIR, "maskable-192.png"), drawIcon(192, true)),
    fs.writeFile(path.join(OUT_DIR, "maskable-512.png"), drawIcon(512, true)),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
