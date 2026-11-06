/**
 * How the life counter's panels sit round the table.
 *
 * Each layout is drawn for a phone lying one way - tall (portrait) or wide
 * (landscape) - and the counter turns the whole board when the phone lies
 * the other way, so no layout is locked to one orientation. Seats go
 * clockwise round the table, starting top left; each panel is turned to
 * face the player sitting at its edge. Shared by the counter and the setup
 * page's little pictures of each layout.
 */

export type Rot = 0 | 90 | 180 | -90;
export interface Spot { row: string; col: string; rot: Rot }
export interface Layout {
  id: string;
  name: string;
  /** Who sits where, in a few words. */
  hint: string;
  canvas: 'portrait' | 'landscape';
  cols: string;
  rows: string;
  spots: Spot[];
}

const L = (id: string, name: string, hint: string, canvas: Layout['canvas'], cols: string, rows: string, spots: Spot[]): Layout => ({ id, name, hint, canvas, cols, rows, spots });

export const LAYOUTS: Record<number, Layout[]> = {
  2: [
    L('face', 'Face to face', 'One at each end', 'portrait', '1fr', '1fr 1fr', [
      { row: '1', col: '1', rot: 180 }, { row: '2', col: '1', rot: 0 }]),
    L('long', 'Across the middle', 'One each side of a tall phone', 'portrait', '1fr 1fr', '1fr', [
      { row: '1', col: '1', rot: 90 }, { row: '1', col: '2', rot: -90 }]),
    L('sides', 'Side by side', 'Both on the same side', 'landscape', '1fr 1fr', '1fr', [
      { row: '1', col: '1', rot: 0 }, { row: '1', col: '2', rot: 0 }]),
  ],
  3: [
    L('t', 'One at the end', 'One at the far end, one down each side', 'portrait', '1fr 1fr', '1fr 1.5fr', [
      { row: '1', col: '1 / -1', rot: 180 }, { row: '2', col: '2', rot: -90 }, { row: '2', col: '1', rot: 90 }]),
    L('across', 'Across', 'One across, two this side', 'landscape', '1fr 1fr', '1fr 1fr', [
      { row: '1', col: '1 / -1', rot: 180 }, { row: '2', col: '2', rot: 0 }, { row: '2', col: '1', rot: 0 }]),
    L('end', 'Two and an end', 'One across, one this side, one at the end', 'landscape', '1fr 0.75fr', '1fr 1fr', [
      { row: '1', col: '1', rot: 180 }, { row: '1 / -1', col: '2', rot: -90 }, { row: '2', col: '1', rot: 0 }]),
  ],
  4: [
    L('across', 'Across', 'Two each side of a wide phone', 'landscape', '1fr 1fr', '1fr 1fr', [
      { row: '1', col: '1', rot: 180 }, { row: '1', col: '2', rot: 180 }, { row: '2', col: '2', rot: 0 }, { row: '2', col: '1', rot: 0 }]),
    L('sides', 'Down the sides', 'Two each side of a tall phone', 'portrait', '1fr 1fr', '1fr 1fr', [
      { row: '1', col: '1', rot: 90 }, { row: '1', col: '2', rot: -90 }, { row: '2', col: '2', rot: -90 }, { row: '2', col: '1', rot: 90 }]),
    L('ends', 'Round the table', 'One on each edge', 'portrait', '1fr 1fr', '0.8fr 1.4fr 0.8fr', [
      { row: '1', col: '1 / -1', rot: 180 }, { row: '2', col: '2', rot: -90 }, { row: '3', col: '1 / -1', rot: 0 }, { row: '2', col: '1', rot: 90 }]),
  ],
  5: [
    L('across', 'Across', 'Two across, three this side', 'landscape', 'repeat(6, 1fr)', '1fr 1fr', [
      { row: '1', col: '1 / 4', rot: 180 }, { row: '1', col: '4 / 7', rot: 180 },
      { row: '2', col: '5 / 7', rot: 0 }, { row: '2', col: '3 / 5', rot: 0 }, { row: '2', col: '1 / 3', rot: 0 }]),
    L('end', 'Across and an end', 'Two each side, one at the end', 'landscape', '1fr 1fr 0.75fr', '1fr 1fr', [
      { row: '1', col: '1', rot: 180 }, { row: '1', col: '2', rot: 180 }, { row: '1 / -1', col: '3', rot: -90 },
      { row: '2', col: '2', rot: 0 }, { row: '2', col: '1', rot: 0 }]),
    L('sides', 'Sides and an end', 'One at the far end, two down each side', 'portrait', '1fr 1fr', '0.8fr 1fr 1fr', [
      { row: '1', col: '1 / -1', rot: 180 }, { row: '2', col: '2', rot: -90 }, { row: '3', col: '2', rot: -90 }, { row: '3', col: '1', rot: 90 }, { row: '2', col: '1', rot: 90 }]),
  ],
  6: [
    L('across', 'Across', 'Three each side of a wide phone', 'landscape', '1fr 1fr 1fr', '1fr 1fr', [
      { row: '1', col: '1', rot: 180 }, { row: '1', col: '2', rot: 180 }, { row: '1', col: '3', rot: 180 },
      { row: '2', col: '3', rot: 0 }, { row: '2', col: '2', rot: 0 }, { row: '2', col: '1', rot: 0 }]),
    L('ends', 'Both ends', 'Two each side, one at each end', 'landscape', '0.75fr 1fr 1fr 0.75fr', '1fr 1fr', [
      { row: '1 / -1', col: '1', rot: 90 }, { row: '1', col: '2', rot: 180 }, { row: '1', col: '3', rot: 180 },
      { row: '1 / -1', col: '4', rot: -90 }, { row: '2', col: '3', rot: 0 }, { row: '2', col: '2', rot: 0 }]),
    L('sides', 'Down the sides', 'Three each side of a tall phone', 'portrait', '1fr 1fr', '1fr 1fr 1fr', [
      { row: '1', col: '1', rot: 90 }, { row: '1', col: '2', rot: -90 }, { row: '2', col: '2', rot: -90 }, { row: '3', col: '2', rot: -90 }, { row: '3', col: '1', rot: 90 }, { row: '2', col: '1', rot: 90 }]),
  ],
};

/** The layout by id for this many players, or the first (the usual one). */
export function layoutFor(players: number, id: string | null | undefined): Layout {
  const all = LAYOUTS[players] ?? LAYOUTS[4];
  return all.find((l) => l.id === id) ?? all[0];
}

export const isLayout = (players: number, id: unknown) => typeof id === 'string' && (LAYOUTS[players] ?? []).some((l) => l.id === id);
