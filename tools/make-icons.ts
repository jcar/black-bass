// Rasterises public/icons/icon.svg into the PNG sizes iOS and the PWA manifest need.
import sharp from 'sharp';

const SRC = 'public/icons/icon.svg';
const sizes: [string, number][] = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/apple-touch-icon.png', 180],
];
for (const [out, size] of sizes) {
  await sharp(SRC).resize(size, size).png().toFile(out);
  console.log('wrote', out);
}
