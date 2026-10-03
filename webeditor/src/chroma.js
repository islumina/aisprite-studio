// AI Sprite Studio — chroma key colour detection
//
// Image agents generate frames on a flat background (green #00FF00, or blue for
// reimu's ~rgb(20, 62, 182)). The preview keys that colour out on the GPU
// (chroma-filter.js); this module picks the colour per image from its border,
// and recognises images that already have alpha (packed sheets are pre-keyed by
// packer.py), which are not keyed at all. The detection is pure so it runs in
// node tests; readBorderPixels() is the only browser-only part.

/** Soft-key defaults; similarity is the UI slider's starting value. */
export const CHROMA_DEFAULTS = Object.freeze({ similarity: 0.30, smoothness: 0.10, spill: 1 });

// Per-channel distance that still counts as the background colour (JPEG/WebP noise, gradients).
const KEY_TOLERANCE = 40;
// Share of opaque border pixels that must match the key: below it there is no flat background.
const MIN_KEY_SHARE = 0.5;
// A key channel must exceed both others by this much to get spill suppression.
const SPILL_MARGIN = 64;

/**
 * Pick the chroma key colour from an image's border pixels: the dominant opaque
 * colour, refined to the mean of every pixel within KEY_TOLERANCE of it.
 * @param {ArrayLike<number>} rgba  Border pixels as straight (non-premultiplied) RGBA bytes.
 * @returns {{ key: [number, number, number] } | { key: null, reason: 'empty'|'alpha'|'mixed' }}
 *   `alpha`: the border is mostly transparent, so the image is already keyed.
 *   `mixed`: no colour covers at least half the border, so there is no flat background.
 */
export function detectKeyColor(rgba) {
  const total = Math.floor(rgba.length / 4);
  if (total === 0) return { key: null, reason: 'empty' };

  // Pass 1: coarse 4-bit-per-channel histogram of the opaque pixels.
  const bins = new Map();
  let transparent = 0;
  for (let i = 0; i < total * 4; i += 4) {
    if (rgba[i + 3] < 128) {
      transparent++;
      continue;
    }
    const bin = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const sums = bins.get(bin) ?? [0, 0, 0, 0];
    sums[0] += rgba[i];
    sums[1] += rgba[i + 1];
    sums[2] += rgba[i + 2];
    sums[3]++;
    bins.set(bin, sums);
  }
  let mode = null;
  for (const sums of bins.values()) if (!mode || sums[3] > mode[3]) mode = sums;
  if (!mode) return { key: null, reason: 'alpha' };
  const centre = [mode[0] / mode[3], mode[1] / mode[3], mode[2] / mode[3]];

  // Pass 2: gather every opaque pixel near the mode, so a colour split across bins still counts once.
  const near = [0, 0, 0, 0];
  for (let i = 0; i < total * 4; i += 4) {
    if (rgba[i + 3] < 128) continue;
    if (Math.abs(rgba[i] - centre[0]) > KEY_TOLERANCE
      || Math.abs(rgba[i + 1] - centre[1]) > KEY_TOLERANCE
      || Math.abs(rgba[i + 2] - centre[2]) > KEY_TOLERANCE) continue;
    near[0] += rgba[i];
    near[1] += rgba[i + 1];
    near[2] += rgba[i + 2];
    near[3]++;
  }
  if (transparent >= near[3]) return { key: null, reason: 'alpha' };
  if (near[3] / total < MIN_KEY_SHARE) return { key: null, reason: 'mixed' };
  return { key: [0, 1, 2].map((c) => Math.round(near[c] / near[3])) };
}

/**
 * Channel mask for spill suppression: the key's dominant channel, when it clearly
 * dominates (green or blue screen), else no suppression.
 * @param {[number, number, number]} key  0-255.
 * @returns {[number, number, number]} One-hot mask, or all zeros.
 */
export function spillMask(key) {
  const mask = [0, 0, 0];
  const top = key.indexOf(Math.max(...key));
  const others = key.filter((_, channel) => channel !== top);
  if (others.every((value) => key[top] - value >= SPILL_MARGIN)) mask[top] = 1;
  return mask;
}

/**
 * Read the outermost row and column on each side of an image (browser only).
 * Copies just those strips instead of decoding the whole sheet into ImageData.
 * @param {CanvasImageSource & { width: number, height: number }} source
 * @returns {Uint8ClampedArray} RGBA bytes of the four edges.
 */
export function readBorderPixels(source) {
  const { width, height } = source;
  const rows = document.createElement('canvas');
  rows.width = width;
  rows.height = 2;
  const rowContext = rows.getContext('2d');
  rowContext.drawImage(source, 0, 0, width, 1, 0, 0, width, 1);
  rowContext.drawImage(source, 0, height - 1, width, 1, 0, 1, width, 1);
  const columns = document.createElement('canvas');
  columns.width = 2;
  columns.height = height;
  const columnContext = columns.getContext('2d');
  columnContext.drawImage(source, 0, 0, 1, height, 0, 0, 1, height);
  columnContext.drawImage(source, width - 1, 0, 1, height, 1, 0, 1, height);
  const top = rowContext.getImageData(0, 0, width, 2).data;
  const sides = columnContext.getImageData(0, 0, 2, height).data;
  const pixels = new Uint8ClampedArray(top.length + sides.length);
  pixels.set(top);
  pixels.set(sides, top.length);
  return pixels;
}
