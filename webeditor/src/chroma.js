// AI Sprite Studio — green-screen chroma key (browser-side, GPU-free, no Python)
//
// Image agents generate frames on a solid #00FF00 background (their transparent
// output isn't clean). Rather than chroma-keying in Python — which packer.py also
// does for hard edges — we key the spritesheet to transparency once at load, on a canvas
// for soft-edge preview.
// canvas pass (browser-only) just applies it over ImageData.

/**
 * Alpha for one pixel: 0 = key colour (drop it), 1 = keep.
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @param {{key?:number[], similarity?:number, smoothness?:number}} [opts]
 * @returns {number} 0..1
 */
export function chromaAlpha(r, g, b, opts = {}) {
  const key = opts.key || [0, 255, 0];
  const similarity = opts.similarity ?? 0.30;
  const smoothness = opts.smoothness ?? 0.10;
  const dr = r / 255 - key[0] / 255;
  const dg = g / 255 - key[1] / 255;
  const db = b / 255 - key[2] / 255;
  // Normalised RGB distance (0 at the key colour, 1 at the opposite corner).
  const d = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
  const a = (d - similarity) / Math.max(smoothness, 1e-4);
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/**
 * Key a source image/canvas to transparency, returning a new canvas the same size.
 * Browser-only (uses a 2D canvas). Also lightly suppresses green spill on edges.
 * @param {CanvasImageSource & {width:number,height:number}} source
 * @param {{key?:number[], similarity?:number, smoothness?:number}} [opts]
 * @returns {HTMLCanvasElement}
 */
export function keyGreen(source, opts = {}) {
  const w = source.width;
  const h = source.height;

  // Protect against huge canvases that might crash the browser (e.g., > 16M pixels)
  if (w * h > 16777216) {
    console.warn(`chroma.js: Image is too large (${w}x${h} = ${w*h} px). Skipping green-screen keying to avoid canvas crash.`);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(source, 0, 0);
    return cv;
  }

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const key = opts.key || [0, 255, 0];
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = chromaAlpha(d[i], d[i + 1], d[i + 2], opts);
    if (a < 1) {
      // Spill suppression: pull the dominant key colour toward the other two's max.
      if (key[1] >= 200) { // Green screen
        const mx = Math.max(d[i], d[i + 2]);
        if (d[i + 1] > mx) d[i + 1] = Math.round(mx + (d[i + 1] - mx) * a);
      } else if (key[2] >= 200) { // Blue screen
        const mx = Math.max(d[i], d[i + 1]);
        if (d[i + 2] > mx) d[i + 2] = Math.round(mx + (d[i + 2] - mx) * a);
      }
    }
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
