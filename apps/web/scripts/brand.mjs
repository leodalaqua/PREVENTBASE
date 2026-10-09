// Gera logo recortada e ícones do PWA a partir de brand/preventbase-logo.png (logo sobre fundo preto):
// node scripts/brand.mjs
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [path.dirname(require.resolve("next/package.json"))] }));

const root = path.resolve(import.meta.dirname, "..");
const SRC = path.join(root, "brand", "preventbase-logo.png");
const PUB = path.join(root, "public");
const TILE = "#18181b";
const INK = [39, 39, 42];

const src = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = src.info.width;
const H = src.info.height;
const px = src.data;
const lum = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]);

function rowsLit(y0, y1, x0 = 0, x1 = W) {
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (lum(px, (y * W + x) * 4) > 40) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  return { minX, maxX, minY, maxY };
}

// O símbolo (capacete) e o nome são separados pela maior faixa horizontal vazia.
let best = { y: 0, len: 0 }, run = 0, seenInk = false;
for (let y = 0; y < H; y++) {
  if (rowsLit(y, y + 1).maxX < 0) run++;
  else {
    if (seenInk && run > best.len) best = { y: y - run, len: run };
    seenInk = true;
    run = 0;
  }
}
const split = best.y + Math.floor(best.len / 2);

function crop(box, pad) {
  const x0 = Math.max(0, box.minX - pad), y0 = Math.max(0, box.minY - pad);
  const w = Math.min(W, box.maxX + pad + 1) - x0, h = Math.min(H, box.maxY + pad + 1) - y0;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) px.copy(out, y * w * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4);
  return { data: out, w, h };
}

function unblend(d, i) {
  const m = lum(d, i);
  if (m < 6) return void (d[i + 3] = 0);
  for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.round((d[i + c] * 255) / m));
  d[i + 3] = m;
}

// Remove só o preto conectado à borda: contornos internos (viseira, check) continuam pretos.
function knockout({ data, w, h }) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || lum(data, p * 4) > 48) continue;
    seen[p] = 1;
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  for (let p = 0; p < w * h; p++) if (seen[p]) unblend(data, p * 4);
  return { data, w, h };
}

function knockoutAll(img) {
  for (let i = 0; i < img.data.length; i += 4) unblend(img.data, i);
  return img;
}

// Texto neutro (branco) vira grafite para uso sobre fundo claro; dourado é mantido.
function inkOnLight(img) {
  const data = Buffer.from(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    if (sat < 40) [data[i], data[i + 1], data[i + 2]] = INK;
  }
  return { ...img, data };
}

const raw = (img) => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } });

const mark = knockout(crop(rowsLit(0, split), 4));
const word = knockoutAll(crop(rowsLit(split, H), 3));

await mkdir(path.join(PUB, "brand"), { recursive: true });
await raw(mark).png().toFile(path.join(PUB, "brand", "mark.png"));
await raw(word).png().toFile(path.join(PUB, "brand", "wordmark.png"));
await raw(inkOnLight(word)).png().toFile(path.join(PUB, "brand", "wordmark-dark.png"));
console.log(`brand/mark.png ${mark.w}x${mark.h}, brand/wordmark*.png ${word.w}x${word.h}`);

async function icon(file, size, { scale, radius }) {
  const inner = Math.round(size * scale);
  const glyph = await raw(mark).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" }).png().toBuffer();
  const r = Math.round(size * radius);
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${TILE}"/></svg>`);
  await sharp(bg).composite([{ input: glyph, gravity: "center" }]).png().toFile(path.join(PUB, file));
  console.log(`${file} ${size}px`);
}

await icon("icon-192.png", 192, { scale: 0.78, radius: 0.22 });
await icon("icon-512.png", 512, { scale: 0.78, radius: 0.22 });
await icon("favicon-32.png", 32, { scale: 0.86, radius: 0.2 });
await icon("icon-maskable-192.png", 192, { scale: 0.6, radius: 0 });
await icon("icon-maskable-512.png", 512, { scale: 0.6, radius: 0 });
await icon("apple-touch-icon.png", 180, { scale: 0.7, radius: 0 });
