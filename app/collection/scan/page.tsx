'use client';

/**
 * Scanning cards into the collection with the camera.
 *
 * Hold a card in the guide: the page reads its name and the small print in
 * the bottom-left corner every moment or so (lib/scanner), looks it up, and
 * stops on what it found for you to confirm - the printing, foil or not, how
 * many, which box - and add. A printing read from its set code and number is
 * shown at once; a card known only by name is waited on until it reads the
 * same twice, so a blurry frame does not propose the wrong card.
 *
 * Without a camera (or permission), a photo from the library works the same
 * way, with the card filling the picture.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import AddToCollection from '@/components/AddToCollection';
import * as api from '@/lib/api';
import type { Location } from '@/lib/collection';
import { imageOf, type Finish, type ScryfallCard } from '@/lib/scryfall';
import { ocr, photoRegions, readCard, type Region } from '@/lib/scanner';
import { steady } from '@/lib/steady-tap';

const BOX_KEY = 'mtg-scan-box';
const TICK_MS = 700;
// The guide: a card's shape, 63 by 88 mm, this share of the view's height.
const CARD_RATIO = 63 / 88;
const GUIDE_HEIGHT = 0.82;

type Found = { card: ScryfallCard; match: 'printing' | 'name' };
type Added = { card: ScryfallCard; quantity: number; finish: Finish; location: string; count: number };

export default function ScanPage() {
  const video = useRef<HTMLVideoElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied' | 'none'>('off');
  const [auto, setAuto] = useState(true);
  const [status, setStatus] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [box, setBox] = useState(() => { try { return localStorage.getItem(BOX_KEY) ?? ''; } catch { return ''; } });
  const [added, setAdded] = useState<Added[]>([]);
  const [manual, setManual] = useState(false);
  // What the reader last saw, shown when it found nothing.
  const [raw, setRaw] = useState<{ title: string; bottom: string } | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const busy = useRef(false);
  const lastName = useRef<{ id: string; times: number } | null>(null);
  // The last reading that found nothing: the same again is not looked up again.
  const lastMiss = useRef('');

  useEffect(() => { api.collection().then((c) => setLocations(c.locations)).catch(() => {}); }, []);
  const chooseBox = (name: string) => {
    setBox(name);
    try { localStorage.setItem(BOX_KEY, name); } catch { /* remembered for this visit only */ }
  };

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setCamera('none'); return; }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
      }
      setCamera('on');
      setStatus('Loading the reader…');
      await ocr();
      setStatus('Hold a card in the frame');
    } catch (e) {
      setCamera(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'none');
    }
  }, []);

  // The camera stops when the page goes.
  useEffect(() => () => {
    const stream = video.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
  }, []);

  /** Look up what was read; propose a card if the reading is good enough. */
  /** Look up what was read. Answers whether a card was found (or is being confirmed). */
  const identify = useCallback(async (reading: Awaited<ReturnType<typeof readCard>>, fromPhoto: boolean): Promise<boolean> => {
    const { title, bottom } = reading;
    setRaw(reading.raw);
    // A test harness can collect every reading (window.__scanLog = []).
    (window as unknown as { __scanLog?: unknown[] }).__scanLog?.push(reading);
    if (title.replace(/[^A-Za-z]/g, '').length < 3 && !(bottom.set && bottom.number)) {
      setStatus(fromPhoto ? 'Could not read a name - try a sharper photo, closer to the card' : 'Hold a card in the frame');
      return false;
    }
    const asked = JSON.stringify([title, bottom.set, bottom.number]);
    if (!fromPhoto && asked === lastMiss.current) return false;
    const r = await api.identifyScan({ title, set: bottom.set, number: bottom.number });
    if (!r.card) {
      lastMiss.current = asked;
      setStatus(`Read “${title || '…'}” - no card by that name yet`);
      return false;
    }
    lastMiss.current = '';
    // By name alone, wait for the same card twice, unless it was a photo.
    if (r.match !== 'printing' && !fromPhoto) {
      const seen = lastName.current;
      const id = r.card.oracle_id ?? r.card.id;
      lastName.current = seen && seen.id === id ? { id, times: seen.times + 1 } : { id, times: 1 };
      if (lastName.current.times < 2) {
        setStatus(`Looks like ${r.card.name}…`);
        return true;
      }
    }
    lastName.current = null;
    setFound({ card: r.card, match: r.match ?? 'name' });
    setStatus('');
    return true;
  }, []);

  // Read the frame in the guide now and then, while nothing is waiting to be added.
  useEffect(() => {
    if (camera !== 'on' || !auto || found || manual) return;
    const timer = setInterval(async () => {
      const v = video.current;
      const box = view.current;
      if (busy.current || !v || !box || !v.videoWidth) return;
      busy.current = true;
      try {
        await identify(await readCard(v, guideInVideo(v, box)), false);
      } catch {
        setStatus('Could not read that - hold it steady');
      } finally {
        busy.current = false;
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [camera, auto, found, manual, identify]);

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    // One reading at a time: wait for the camera's, or a photo still being read.
    while (busy.current) await new Promise((r) => setTimeout(r, 100));
    busy.current = true;
    setReadingPhoto(true);
    setStatus('Reading the photo…');
    setFound(null);
    const url = URL.createObjectURL(file);
    try {
      const img = new window.Image();
      img.src = url;
      await img.decode();
      // The photo as the card, then the middle of it at a few sizes.
      for (const region of photoRegions(img.naturalWidth, img.naturalHeight)) {
        if (await identify(await readCard(img, region), true)) break;
      }
    } catch (e) {
      console.error('[scan] photo', e);
      setStatus('Could not read that photo');
    } finally {
      URL.revokeObjectURL(url);
      busy.current = false;
      setReadingPhoto(false);
    }
  };

  const onAdded = (a: Added) => {
    setAdded((prev) => [a, ...prev].slice(0, 30));
    setFound(null);
    setManual(false);
    setStatus('Added - next card');
  };
  const undo = async (a: Added, i: number) => {
    await api.setCollectionCount(a.card.id, a.finish, a.location, a.count - a.quantity);
    setAdded((prev) => prev.filter((_, j) => j !== i));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/collection" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">← Collection</Link>
          <h1 className="text-xl font-semibold">Scan cards</h1>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">Into</span>
          <select value={box} onChange={(e) => chooseBox(e.target.value)} aria-label="Box to scan into" className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-2">
            {(locations.length ? locations : [{ name: '', kind: 'box', count: 0 } as Location]).map((l) => (
              <option key={l.name} value={l.name}>{l.name || 'Unsorted'}</option>
            ))}
          </select>
        </label>
      </div>

      <div ref={view} className="relative aspect-[3/4] w-full max-w-md self-center overflow-hidden rounded-2xl bg-black sm:aspect-[4/3] sm:max-w-2xl">
        <video ref={video} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {camera === 'on' && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-[4%] border-2 border-[var(--accent)] shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" style={{ height: `${GUIDE_HEIGHT * 100}%`, aspectRatio: `${CARD_RATIO}` }}>
              <div className="h-[12%] border-b border-dashed border-[var(--accent)]/60" />
            </div>
          </div>
        )}
        {camera !== 'on' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--muted)]">
            {camera === 'off' && <button onClick={start} className="min-h-11 rounded-xl bg-[var(--accent)] px-5 font-medium text-[#221c08]">Start the camera</button>}
            {camera === 'starting' && <p>Starting the camera…</p>}
            {camera === 'denied' && <p>The camera is blocked for this site. Allow it in Settings → Safari → Camera, or use a photo below.</p>}
            {camera === 'none' && <p>No camera available here - use a photo below.</p>}
          </div>
        )}
        {status && camera === 'on' && !found && (
          <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-white" role="status">{status}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        {camera === 'on' && (
          <button onClick={() => setAuto((a) => !a)} className="min-h-10 rounded-lg border border-[var(--border)] px-3">
            {auto ? 'Pause' : 'Resume'} scanning
          </button>
        )}
        <label aria-busy={readingPhoto} className={`min-h-10 cursor-pointer rounded-lg border border-[var(--border)] px-3 leading-10 ${readingPhoto ? 'opacity-60' : ''}`}>
          {readingPhoto ? 'Reading…' : 'Use a photo'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { fromPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <button onClick={() => { setManual(true); setFound(null); }} className="min-h-10 rounded-lg border border-[var(--border)] px-3">Type a name</button>
      </div>
      {status && (camera !== 'on' || found) && !found && <p className="text-center text-sm text-[var(--muted)]" role="status">{status}</p>}
      {raw && !found && (
        <details className="text-center text-xs text-[var(--muted)]">
          <summary>What it read</summary>
          <p data-raw-title>{raw.title || '(nothing)'}</p>
          <p data-raw-bottom>{raw.bottom || '(nothing)'}</p>
        </details>
      )}

      {(found || manual) && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Found">
          {found && (
            <div className="mb-3 flex items-start gap-3">
              {imageOf(found.card, 'small') && <Image src={imageOf(found.card, 'small')!} alt="" width={64} height={89} className="rounded" unoptimized />}
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-base font-medium">{found.card.name}</p>
                <p className="text-[var(--muted)]">
                  {found.match === 'printing'
                    ? <>✓ {found.card.set_name} #{found.card.collector_number} - read from the card</>
                    : <>⚠ Matched by name - check the printing below</>}
                </p>
              </div>
              <button onClick={() => setFound(null)} className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm">Skip</button>
            </div>
          )}
          <AddToCollection
            key={found?.card.id ?? 'manual'}
            card={found?.card ?? null}
            compact={!!found}
            locations={locations}
            location={box}
            onLocation={(name) => { chooseBox(name); api.collection().then((c) => setLocations(c.locations)).catch(() => {}); }}
            onAdded={onAdded}
          />
          {found && (
            <button onClick={() => { setFound(null); setManual(true); }} className="mt-2 text-sm text-[var(--muted)] underline">Wrong card? Type the name</button>
          )}
        </section>
      )}

      {added.length > 0 && (
        <section>
          <h2 className="text-sm font-medium">Added this time ({added.reduce((n, a) => n + a.quantity, 0)})</h2>
          <ul className="mt-2 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
            {added.map((a, i) => (
              <li key={`${a.card.id}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {a.quantity}× {a.card.name} <span className="text-[var(--muted)]">· {(a.card.set ?? '').toUpperCase()} #{a.card.collector_number}{a.finish !== 'nonfoil' ? ` · ${a.finish}` : ''} · {a.location || 'Unsorted'}</span>
                </span>
                <button {...steady(() => undo(a, i))} className="min-h-9 rounded-lg px-2 text-[var(--muted)] hover:text-[var(--foreground)]">Undo</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The guide box in the video's own pixels: the video fills the view, cropped (object-cover). */
function guideInVideo(v: HTMLVideoElement, box: HTMLElement): Region {
  const cw = box.clientWidth;
  const ch = box.clientHeight;
  const scale = Math.max(cw / v.videoWidth, ch / v.videoHeight);
  const offX = (v.videoWidth * scale - cw) / 2;
  const offY = (v.videoHeight * scale - ch) / 2;
  const gh = ch * GUIDE_HEIGHT;
  const gw = gh * CARD_RATIO;
  const gx = (cw - gw) / 2;
  const gy = (ch - gh) / 2;
  return { x: (gx + offX) / scale, y: (gy + offY) / scale, w: gw / scale, h: gh / scale };
}
