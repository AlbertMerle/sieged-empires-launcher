/** Square launcher icons from SE-logo.jpeg (white background punched to alpha). */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const root = path.join(__dirname, '..');
const srcCandidates = [
  path.join(root, 'SE-logo.jpeg'),
  path.join(root, 'SE-logo.jpg'),
  path.join(root, 'SE Logo .jpeg'),
  path.join(root, '..', 'logo.png'),
];
const pngTargets = [
  path.join(root, 'assets', 'icon-transparent.png'),
  path.join(root, 'assets', 'icon.png'),
  path.join(root, 'app', 'assets', 'icon-transparent.png'),
  path.join(root, 'app', 'assets', 'icon.png'),
];
const icoTargets = [
  path.join(root, 'assets', 'icon.ico'),
  path.join(root, 'app', 'assets', 'icon.ico'),
];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function findSrc() {
  return srcCandidates.find((p) => fs.existsSync(p));
}

function decodeImage(file) {
  const buf = fs.readFileSync(file);
  if (file.toLowerCase().endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  return jpeg.decode(buf, { maxMemoryUsageInMB: 256 });
}

function idx(x, y, w) {
  return (y * w + x) * 4;
}

function isWhiteBg(data, i) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  return mn >= 232 && mx - mn <= 22;
}

function punchWhite({ width, height, data }) {
  const pixels = Buffer.from(data);
  const seen = Buffer.alloc(width * height);
  const qx = [];
  const qy = [];

  function tryPush(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    const i = p * 4;
    if (!isWhiteBg(pixels, i)) return;
    seen[p] = 1;
    qx.push(x);
    qy.push(y);
  }

  for (let x = 0; x < width; x++) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  while (qx.length) {
    const x = qx.pop();
    const y = qy.pop();
    const i = idx(x, y, width);
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
    pixels[i + 3] = 0;
    tryPush(x - 1, y);
    tryPush(x + 1, y);
    tryPush(x, y - 1);
    tryPush(x, y + 1);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y, width);
      if (!pixels[i + 3] || !isWhiteBg(pixels, i)) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        pixels[idx(x - 1, y, width) + 3] === 0 ||
        pixels[idx(x + 1, y, width) + 3] === 0 ||
        pixels[idx(x, y - 1, width) + 3] === 0 ||
        pixels[idx(x, y + 1, width) + 3] === 0;
      if (edge) pixels[i + 3] = 0;
    }
  }

  return { width, height, data: pixels };
}

function cropToLogo({ width, height, data }, padRatio = 0.06) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[idx(x, y, width) + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) throw new Error('logo became fully transparent after background removal');

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const pad = Math.max(8, Math.round(Math.max(bw, bh) * padRatio));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = idx(minX, minY + y, width);
    data.copy(out, y * cw * 4, srcStart, srcStart + cw * 4);
  }
  return { width: cw, height: ch, data: out };
}

function toSquare(img, size = 1024) {
  const side = Math.max(img.width, img.height);
  const square = Buffer.alloc(side * side * 4);
  const ox = Math.floor((side - img.width) / 2);
  const oy = Math.floor((side - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    const srcStart = idx(0, y, img.width);
    const destStart = idx(ox, oy + y, side);
    img.data.copy(square, destStart, srcStart, srcStart + img.width * 4);
  }
  return resizeRgba({ width: side, height: side, data: square }, size, size);
}

function resizeRgba(img, tw, th) {
  if (img.width === tw && img.height === th) return img;
  const out = Buffer.alloc(tw * th * 4);
  const xRatio = img.width / tw;
  const yRatio = img.height / th;
  for (let y = 0; y < th; y++) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < tw; x++) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const fx = sx - x0;
      const i00 = idx(x0, y0, img.width);
      const i10 = idx(x1, y0, img.width);
      const i01 = idx(x0, y1, img.width);
      const i11 = idx(x1, y1, img.width);
      const o = idx(x, y, tw);
      for (let c = 0; c < 4; c++) {
        const v0 = img.data[i00 + c] * (1 - fx) + img.data[i10 + c] * fx;
        const v1 = img.data[i01 + c] * (1 - fx) + img.data[i11 + c] * fx;
        out[o + c] = Math.round(v0 * (1 - fy) + v1 * fy);
      }
    }
  }
  return { width: tw, height: th, data: out };
}

function encodePng(img) {
  const png = new PNG({ width: img.width, height: img.height });
  Buffer.from(img.data).copy(png.data);
  return PNG.sync.write(png);
}

function pngToIco(images) {
  const count = images.length;
  const headerSize = 6 + 16 * count;
  let offset = headerSize;
  const entries = images.map((img) => {
    const entry = {
      width: img.size >= 256 ? 0 : img.size,
      bytes: img.png.length,
      offset,
    };
    offset += img.png.length;
    return entry;
  });
  const buf = Buffer.alloc(offset);
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(count, 4);
  let p = 6;
  for (const e of entries) {
    buf[p] = e.width;
    buf[p + 1] = e.width;
    buf[p + 2] = 0;
    buf[p + 3] = 0;
    buf.writeUInt16LE(1, p + 4);
    buf.writeUInt16LE(32, p + 6);
    buf.writeUInt32LE(e.bytes, p + 8);
    buf.writeUInt32LE(e.offset, p + 12);
    p += 16;
  }
  for (let i = 0; i < images.length; i++) {
    images[i].png.copy(buf, entries[i].offset);
  }
  return buf;
}

function main() {
  const src = findSrc();
  if (!src) {
    const have = [...pngTargets, ...icoTargets].every((p) => fs.existsSync(p));
    if (have) {
      console.log('SE-logo.jpeg not found — keeping existing icon assets');
      return;
    }
    throw new Error('SE-logo.jpeg not found');
  }

  const square = toSquare(cropToLogo(punchWhite(decodeImage(src))), 1024);
  const png = encodePng(square);
  for (const dest of pngTargets) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, png);
  }

  const icoImages = ICO_SIZES.map((size) => ({
    size,
    png: encodePng(resizeRgba(square, size, size)),
  }));
  const ico = pngToIco(icoImages);
  for (const dest of icoTargets) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, ico);
  }

  console.log(`Synced ${path.basename(src)} -> PNG + ICO (transparent background)`);
}

main();
