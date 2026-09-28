/**
 * Reading a card from a camera frame or a photo, in the browser.
 *
 * Tesseract runs on the phone, served from this app (scripts/copy-tesseract),
 * loaded the first time a card is read and kept for the next. Rather than
 * reading the whole card - slow, and the rules text is noise - it reads two
 * strips: the name bar, and the bottom-left small print with the collector
 * number and set code. Each is cut out, enlarged and turned to high-contrast
 * grey before reading; small print is unreadable at camera size otherwise.
 *
 * Where a strip sits is a proportion of the card, which is the guide box on
 * the camera or, for a photo, the picture or a card-shaped part of its middle
 * (photoRegions).
 */

import type { Worker } from 'tesseract.js';

import { bestNameLine, readBottomLine, type BottomLine } from './scan';

const BASE = process.env.NEXT_PUBLIC_MTG_BASE_PATH ?? '';

export interface Region { x: number; y: number; w: number; h: number }

// Where the strips are, as fractions of the card - generous, since a card
// is never held perfectly in the guide.
const TITLE = { x0: 0.04, x1: 0.8, y0: 0.025, y1: 0.12 };
// Lower, for a card held a little low in the guide or an older frame.
const TITLE_LOW = { x0: 0.04, x1: 0.8, y0: 0.045, y1: 0.145 };
const BOTTOM = { x0: 0.025, x1: 0.55, y0: 0.9, y1: 0.992 };

let worker: Promise<Worker> | null = null;

/** The OCR engine, started once. The first call downloads it (about 6 MB). */
export function ocr(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      return createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${BASE}/tesseract/worker.min.js`,
        corePath: `${BASE}/tesseract`,
        langPath: `${BASE}/tesseract/lang`,
      });
    })();
    worker.catch(() => { worker = null; });
  }
  return worker;
}

/** A strip of the card, enlarged to `width` and made grey with the contrast stretched. */
function strip(source: CanvasImageSource, card: Region, band: typeof TITLE, width: number): HTMLCanvasElement {
  const sx = card.x + band.x0 * card.w;
  const sy = card.y + band.y0 * card.h;
  const sw = (band.x1 - band.x0) * card.w;
  const sh = (band.y1 - band.y0) * card.h;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(8, Math.round((sh * width) / sw));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  // Grey, then stretch the darkest to black and the lightest to white: the
  // name bar's colour and a dim room both flatten the text otherwise.
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - lo) * 255) / span;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface Reading {
  title: string;
  bottom: BottomLine;
  /** What Tesseract returned, for showing when nothing matched. */
  raw: { title: string; bottom: string };
  strips?: { title: string; bottom: string };
}

/** Read a card's name and small print. */
export async function readCard(source: CanvasImageSource, card: Region): Promise<Reading> {
  const w = await ocr();
  const { PSM } = await import('tesseract.js');
  const titleStrip = strip(source, card, TITLE, 900);
  const bottomStrip = strip(source, card, BOTTOM, 1000);
  // A test harness collecting readings (window.__scanLog) also gets the strips.
  const debug = (globalThis as { __scanLog?: unknown[] }).__scanLog
    ? { title: titleStrip.toDataURL(), bottom: bottomStrip.toDataURL() } : undefined;
  // As a block, not a single line: the strip holds frame art and an edge
  // besides the name, and single-line mode reads nothing at all then. If the
  // block finds no name, sparse text often does (tested on 16 frames).
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  let title = await w.recognize(titleStrip);
  let name = bestNameLine(title.data.text);
  if (!name) {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    title = await w.recognize(titleStrip);
    name = bestNameLine(title.data.text);
  }
  if (!name) {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    title = await w.recognize(strip(source, card, TITLE_LOW, 900));
    name = bestNameLine(title.data.text);
  }
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  const bottom = await w.recognize(bottomStrip);
  return {
    ...(debug ? { strips: debug } : {}),
    title: name,
    bottom: readBottomLine(bottom.data.text),
    raw: { title: title.data.text.trim(), bottom: bottom.data.text.trim() },
  };
}

/**
 * Where the card might be in a photo: the whole of it (cropped to the card),
 * then card-shaped regions in the middle at a few sizes - people photograph
 * a card in the middle with some table around it. Reading the whole picture
 * instead was tried and dropped: its copyright line and artist name matched
 * other cards ("Wizards of the Coast" is an Un-card's name).
 */
export function photoRegions(width: number, height: number): Region[] {
  const regions: Region[] = [{ x: 0, y: 0, w: width, h: height }];
  const ratio = 63 / 88;
  for (const share of [0.9, 0.78, 0.66]) {
    let h = height * share;
    let w = h * ratio;
    if (w > width * 0.98) { w = width * 0.98; h = w / ratio; }
    regions.push({ x: (width - w) / 2, y: (height - h) / 2, w, h });
  }
  return regions;
}
