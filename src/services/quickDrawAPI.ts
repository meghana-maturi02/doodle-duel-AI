/**
 * Quick Draw AI Integration
 *
 * Uses DoodleNet — the actual neural network behind Google's Quick, Draw!
 * game (345 object classes) — via ml5.js loaded from a CDN at runtime.
 *
 * The ml5 npm package ships a broken postinstall script on Windows, so we
 * load it as a global script instead. This also keeps the bundle small and
 * works identically in local dev and on Google Cloud hosting.
 */

export interface PredictionResult {
  className: string;
  probability: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    ml5?: any;
  }
}

const ML5_CDN = 'https://unpkg.com/ml5@1/dist/ml5.min.js';

let ml5LoadPromise: Promise<any> | null = null;
let classifierPromise: Promise<any> | null = null;

/** Load the ml5.js library from CDN (once). */
function loadMl5(): Promise<any> {
  if (window.ml5) return Promise.resolve(window.ml5);
  if (ml5LoadPromise) return ml5LoadPromise;

  ml5LoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ML5_CDN;
    script.async = true;
    script.onload = () => resolve(window.ml5);
    script.onerror = () => reject(new Error('Failed to load ml5.js from CDN'));
    document.head.appendChild(script);
  });

  return ml5LoadPromise;
}

/** Load the DoodleNet image classifier (once). */
function getClassifier(): Promise<any> {
  if (classifierPromise) return classifierPromise;

  classifierPromise = loadMl5().then(
    ml5 =>
      new Promise((resolve, reject) => {
        // DoodleNet: trained on 28x28 Quick Draw sketches, accepts any canvas/image
        ml5.imageClassifier('DoodleNet').then(resolve).catch(reject);
      })
  );

  return classifierPromise;
}

export class QuickDrawAPI {
  /** True once the model has been requested (used to warm it up early). */
  static preload() {
    void getClassifier().catch(err => console.error('DoodleNet failed to load:', err));
  }

  /**
   * Mirror Quick, Draw!'s own preprocessing: crop the sketch to its ink
   * bounding box and center it on a square white canvas.
   *
   * DoodleNet was trained on 28x28 bitmaps where the drawing fills the frame.
   * Feeding the raw game canvas (drawing occupying a small central area)
   * downscales the sketch into a tiny smudge and destroys accuracy.
   */
  static preprocessDrawing(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const { width, height } = canvas;
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;

    // Find the ink bounding box (dark pixels on the white background)
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && data[i] < 200) {
        const pixelIndex = i / 4;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < 0) return null; // nothing drawn

    // Add breathing room around the sketch (~8% padding)
    const boxSize = Math.max(maxX - minX, maxY - minY);
    const pad = boxSize * 0.08;
    minX = Math.max(0, Math.floor(minX - pad));
    minY = Math.max(0, Math.floor(minY - pad));
    maxX = Math.min(width - 1, Math.ceil(maxX + pad));
    maxY = Math.min(height - 1, Math.ceil(maxY + pad));

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;

    // Contain-fit the cropped sketch into a centered square
    const SIZE = 256;
    const out = document.createElement('canvas');
    out.width = SIZE;
    out.height = SIZE;
    const outCtx = out.getContext('2d');
    if (!outCtx) return null;

    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, SIZE, SIZE);

    const scale = Math.min(SIZE / boxW, SIZE / boxH);
    const drawW = boxW * scale;
    const drawH = boxH * scale;
    outCtx.drawImage(
      canvas,
      minX,
      minY,
      boxW,
      boxH,
      (SIZE - drawW) / 2,
      (SIZE - drawH) / 2,
      drawW,
      drawH
    );

    // Binarize: DoodleNet was trained on near-binary black/white bitmaps.
    // Anti-aliased gray stroke edges confuse it, so snap every pixel to
    // pure black or pure white.
    const outData = outCtx.getImageData(0, 0, SIZE, SIZE);
    const px = outData.data;
    for (let i = 0; i < px.length; i += 4) {
      const v = px[i] < 140 ? 0 : 255; // red channel suffices (grayscale sketch)
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
    outCtx.putImageData(outData, 0, 0);

    return out;
  }

  /**
   * Export the sketch as a compact JPEG data URL for the reveal screen.
   * JPEG keeps it small enough for realtime transport.
   */
  static exportDrawing(canvas: HTMLCanvasElement): string {
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  /**
   * Classify the drawing on a canvas with DoodleNet.
   * Expects dark strokes on a white background (the game canvas handles this).
   */
  static async predictDrawing(canvas: HTMLCanvasElement): Promise<PredictionResult[]> {
    try {
      const prepared = this.preprocessDrawing(canvas);
      if (!prepared) {
        return [{ className: 'empty', probability: 0 }];
      }

      const classifier = await getClassifier();
      // Request deep ranks — the correct class often sits below #1
      const results = await classifier.classify(prepared, 10);
      console.log(
        '[DoodleNet] raw predictions:',
        (results as Array<{ label: string; confidence: number }>).map(
          r => `${r.label} ${(r.confidence * 100).toFixed(1)}%`
        )
      );
      return (results as Array<{ label: string; confidence: number }>).map(r => ({
        className: r.label,
        probability: r.confidence,
      }));
    } catch (error) {
      console.error('DoodleNet prediction failed:', error);
      return this.fallbackPrediction(canvas);
    }
  }

  /**
   * Score a set of predictions against the round prompt.
   * DoodleNet classes are single words ("cat", "pizza", "lighthouse"), while
   * prompts are phrases ("A cat wearing sunglasses") — so we match on the
   * main noun of the prompt.
   */
  static scoreAgainstPrompt(predictions: PredictionResult[], prompt: string): number {
    if (!predictions.length) return 0;

    const stopWords = new Set([
      'a', 'an', 'the', 'wearing', 'with', 'eating', 'drinking', 'riding',
      'launching', 'into', 'on', 'in', 'of', 'and', 'doing', 'from',
    ]);

    const promptWords = prompt
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w && !stopWords.has(w));

    let best = 0;
    for (const pred of predictions) {
      const label = pred.className.toLowerCase();
      // Exact noun match ("cat" in "A cat wearing sunglasses")
      if (promptWords.includes(label)) {
        best = Math.max(best, pred.probability);
        continue;
      }
      // Partial match ("pizza" vs "pizzslice" style stems)
      for (const word of promptWords) {
        if (word.startsWith(label) || label.startsWith(word)) {
          best = Math.max(best, pred.probability * 0.9);
        }
      }
    }
    return best;
  }

  /**
   * Heuristic fallback if the model can't load (e.g. offline).
   * Keeps the game playable — results are clearly not AI-verified.
   */
  private static fallbackPrediction(canvas: HTMLCanvasElement): PredictionResult[] {
    const ctx = canvas.getContext('2d');
    if (!ctx) return [{ className: 'unknown', probability: 0 }];

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let inkCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Dark pixels on the white background count as ink
      if (data[i] < 128 && data[i + 3] > 128) inkCount++;
    }

    if (inkCount === 0) return [{ className: 'empty', probability: 0 }];

    // Deterministic pseudo-scores so the round still resolves
    const seed = inkCount % 100 / 100;
    return [
      { className: 'circle', probability: 0.4 + seed * 0.2 },
      { className: 'line', probability: 0.3 - seed * 0.1 },
      { className: 'zigzag', probability: 0.2 },
    ];
  }

  /* ============ Quick, Draw! dataset comparison ============ */

  /** Kick off fetching a sample of real dataset drawings for the prompt. */
  static preloadDataset(word: string): void {
    void this.loadTemplates(word);
  }

  /** Resolves once the dataset sample for the prompt is ready (or failed). */
  static async datasetReady(word: string): Promise<boolean> {
    return (await this.loadTemplates(word)) !== null;
  }

  /**
   * Score a submitted sketch (data URL) against real Quick, Draw! dataset
   * drawings of the prompt category. Returns 0..1 resemblance to the best
   * matching dataset drawing, or null when no sample is available.
   */
  static async scoreAgainstDataset(
    imageDataUrl: string,
    word: string
  ): Promise<number | null> {
    const set = await this.loadTemplates(word);
    if (!set || set.blurred.length === 0) return null;

    try {
      const img = await loadImage(imageDataUrl);
      const src = document.createElement('canvas');
      src.width = img.naturalWidth || img.width;
      src.height = img.naturalHeight || img.height;
      if (src.width < 2 || src.height < 2) return null;
      const sctx = src.getContext('2d');
      if (!sctx) return null;
      sctx.drawImage(img, 0, 0);

      // Same crop/center/binarize/dilate pipeline as the templates
      const prepared = this.preprocessDrawing(src);
      if (!prepared) return 0;
      // Dataset templates are rendered at 28x28. Downscale the prepared
      // player drawing to that same shape before comparing pixel arrays.
      const comparison = document.createElement('canvas');
      comparison.width = 28;
      comparison.height = 28;
      const comparisonCtx = comparison.getContext('2d');
      if (!comparisonCtx) return null;
      comparisonCtx.fillStyle = '#ffffff';
      comparisonCtx.fillRect(0, 0, 28, 28);
      comparisonCtx.drawImage(prepared, 0, 0, 28, 28);

      const pd = comparisonCtx.getImageData(0, 0, 28, 28).data;
      const size = 28 * 28;
      const bin = new Uint8Array(size);
      let ink = false;
      for (let i = 0; i < size; i++) {
        const v = pd[i * 4] < 160 ? 1 : 0;
        bin[i] = v;
        if (v) ink = true;
      }
      if (!ink) return 0;

      const user = blurGrid(bin);
      let best = 0;
      for (const tpl of set.blurred) {
        const s = softIou(user, tpl);
        if (s > best) best = s;
      }
      // Perceptual calibration: lift mid-range similarities so percentages
      // feel meaningful while preserving ranking order.
      return Math.min(0.99, Math.pow(best, 0.75));
    } catch (error) {
      console.error('Dataset scoring failed:', error);
      return null;
    }
  }

  /** Fetch (once per category) a small sample of dataset drawings. */
  private static loadTemplates(word: string): Promise<TemplateSet | null> {
    const category = categoryForPrompt(word);
    if (!category) return Promise.resolve(null);
    const existing = templateCache.get(category);
    if (existing) return existing;

    const job = (async () => {
      try {
        const path = `${encodeURIComponent(category)}.ndjson`;
        // storage.googleapis.com serves the dataset but may block browser
        // CORS; try direct first, then public read-only proxies.
        // The Vite dev server proxies this same-origin request to Google
        // Storage, avoiding browser CORS restrictions during local play.
        const urls = [`/quickdraw-data/${path}`];

        let text = '';
        for (const url of urls) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            // Stream only the first few hundred KB — plenty of drawings,
            // avoids downloading the multi-MB full category file.
            text = '';
            const reader = resp.body?.getReader();
            if (reader) {
              const decoder = new TextDecoder();
              let bytes = 0;
              while (bytes < TEMPLATE_MAX_BYTES) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                text += decoder.decode(value, { stream: true });
                if (text.split('\n').length >= TEMPLATE_TARGET + 1) break;
              }
              try {
                await reader.cancel();
              } catch {
                /* stream already closed */
              }
            } else {
              text = (await resp.text()).slice(0, TEMPLATE_MAX_BYTES);
            }

            if (text.includes('"drawing"')) break; // got real data
          } catch (error) {
            console.warn(`[QuickDraw] fetch failed (${url.slice(0, 60)}…):`, error);
          }
        }

        if (!text.includes('"drawing"')) {
          throw new Error('all dataset sources failed');
        }

        const blurred: Float32Array[] = [];
        const raw: number[][][][] = [];
        for (const line of text.split('\n')) {
          if (blurred.length >= TEMPLATE_TARGET) break;
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed) as { drawing?: number[][][] };
            if (Array.isArray(obj.drawing)) {
              raw.push(obj.drawing);
              const grid = dilate(renderTemplate(obj.drawing));
              if (grid) blurred.push(blurGrid(grid));
            }
          } catch {
            /* truncated final line at the byte cap — ignore */
          }
        }

        if (blurred.length === 0) return null;
        console.log(`[QuickDraw] loaded ${blurred.length} "${category}" reference drawings`);
        return { category, blurred, raw } as TemplateSet;
      } catch (error) {
        console.warn('[QuickDraw] dataset sample unavailable:', error);
        return null;
      }
    })();

    templateCache.set(category, job);
    return job;
  }

  /**
   * Render N real dataset drawings of the category as displayable data URLs
   * (for the "Neural Network Guesses" panel). Empty array when unavailable.
   */
  static async getDatasetSamples(word: string, count = 2): Promise<string[]> {
    const set = await this.loadTemplates(word);
    if (!set || set.raw.length === 0) return [];

    const picks: string[] = [];
    const step = Math.max(1, Math.floor(set.raw.length / count));
    for (let i = 0; i < set.raw.length && picks.length < count; i += step) {
      const url = strokesToDataUrl(set.raw[i]);
      if (url) picks.push(url);
    }
    return picks;
  }
}

/* ============ dataset helpers (module scope) ============ */

const TEMPLATE_TARGET = 80; // reference drawings per category
const TEMPLATE_MAX_BYTES = 400_000; // download cap

interface TemplateSet {
  category: string;
  blurred: Float32Array[];
  /** Raw simplified stroke data kept for rendering display samples.
   * Each entry is one drawing: an array of strokes, each stroke [xs, ys]. */
  raw: number[][][][];
}

const templateCache = new Map<string, Promise<TemplateSet | null>>();

/** Map a game prompt to a Quick, Draw! dataset category name. */
const CATEGORY_HINTS: Record<string, string> = {
  snowman: 'snowman',
  rabbit: 'rabbit',
  bunny: 'rabbit',
  'cell phone': 'cell phone',
  phone: 'cell phone',
  fan: 'fan',
  tree: 'tree',
  forest: 'tree',
  dinosaur: 'dinosaur',
  'ice cream': 'ice cream',
  alien: 'alien',
  lighthouse: 'lighthouse',
  dragon: 'dragon',
  carpet: 'carpet',
};

function categoryForPrompt(prompt: string): string {
  const clean = prompt.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (CATEGORY_HINTS[clean]) return CATEGORY_HINTS[clean];
  const words = clean.split(' ').filter(Boolean);
  for (const w of words) {
    if (CATEGORY_HINTS[w]) return CATEGORY_HINTS[w];
  }
  for (const key of Object.keys(CATEGORY_HINTS)) {
    if (key.includes(' ') && clean.includes(key)) return CATEGORY_HINTS[key];
  }
  return words[words.length - 1] ?? '';
}

/** Render simplified dataset strokes ([xs],[ys] pairs) to a 28x28 bitmap. */
function renderTemplate(strokes: number[][][]): Uint8Array | null {
  const GRID = 28;
  const c = document.createElement('canvas');
  c.width = GRID;
  c.height = GRID;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, GRID, GRID);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [xs, ys] of strokes) {
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i];
      if (ys[i] > maxY) maxY = ys[i];
    }
  }
  if (!isFinite(minX) || maxX < minX) return null;

  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = Math.min((GRID - 2) / w, (GRID - 2) / h);
  const ox = (GRID - w * scale) / 2 - minX * scale;
  const oy = (GRID - h * scale) / 2 - minY * scale;

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [xs, ys] of strokes) {
    ctx.beginPath();
    ctx.moveTo(xs[0] * scale + ox, ys[0] * scale + oy);
    for (let i = 1; i < xs.length; i++) {
      ctx.lineTo(xs[i] * scale + ox, ys[i] * scale + oy);
    }
    ctx.stroke();
  }

  const d = ctx.getImageData(0, 0, GRID, GRID).data;
  const out = new Uint8Array(GRID * GRID);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] < 128 ? 1 : 0;
  return out;
}

/** Grow ink pixels outward (3x3 min-filter), matching user-stroke weight. */
function dilate(src: Uint8Array | null, passes = 2): Uint8Array | null {
  if (!src) return null;
  const GRID = 28;
  let cur = src;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
            if (cur[ny * GRID + nx]) {
              v = 1;
              break;
            }
          }
        }
        next[y * GRID + x] = v;
      }
    }
    cur = next;
  }
  return cur;
}

/** Two passes of 3x3 box blur — tolerates small misalignments in IoU. */
function blurGrid(src: Uint8Array): Float32Array {
  const GRID = 28;
  let a = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) a[i] = src[i];
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
            sum += a[ny * GRID + nx];
            n++;
          }
        }
        b[y * GRID + x] = sum / n;
      }
    }
    a = b;
  }
  return a;
}

/** Soft IoU (Jaccard) on blurred bitmaps — 0 (no overlap) .. 1 (identical). */
function softIou(a: Float32Array, b: Float32Array): number {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    inter += Math.min(a[i], b[i]);
    uni += Math.max(a[i], b[i]);
  }
  return uni > 0 ? inter / uni : 0;
}

/** Render a dataset stroke drawing to a PNG data URL for display. */
function strokesToDataUrl(strokes: number[][][], size = 140): string | null {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [xs, ys] of strokes) {
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (ys[i] < minY) minY = ys[i];
      if (ys[i] > maxY) maxY = ys[i];
    }
  }
  if (!isFinite(minX) || maxX < minX) return null;

  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = Math.min((size - 16) / w, (size - 16) / h);
  const ox = (size - w * scale) / 2 - minX * scale;
  const oy = (size - h * scale) / 2 - minY * scale;

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = Math.max(2, size * 0.03);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [xs, ys] of strokes) {
    ctx.beginPath();
    ctx.moveTo(xs[0] * scale + ox, ys[0] * scale + oy);
    for (let i = 1; i < xs.length; i++) {
      ctx.lineTo(xs[i] * scale + ox, ys[i] * scale + oy);
    }
    ctx.stroke();
  }

  return c.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}
