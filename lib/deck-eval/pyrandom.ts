/**
 * Python's `random.Random(seed)` (MT19937), enough of it to reproduce the
 * evaluation's bootstrap intervals exactly: seeding from a non-negative
 * integer, getrandbits(k <= 32), randrange(n) and choice(seq). The scorers
 * were first written in Python; seeded intervals in FINDINGS.md came from
 * this generator, so the TypeScript port draws the same numbers. Pure.
 */

const N = 624;
const M = 397;

export class PyRandom {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed: number) {
    // Python: abs(seed) as little-endian 32-bit words; 0 is [0].
    let n = Math.abs(Math.trunc(seed));
    const key: number[] = [];
    do { key.push(n % 0x100000000); n = Math.floor(n / 0x100000000); } while (n > 0);
    this.initByArray(key);
  }

  private initGenrand(s: number) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      // 1812433253 * prev + i, in 32 bits, without losing precision.
      mt[i] = ((((prev & 0xffff0000) >>> 16) * 1812433253) << 16) + (prev & 0x0000ffff) * 1812433253 + i;
    }
    this.mti = N;
  }

  private initByArray(key: number[]) {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1; let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (mt[i] ^ (((((prev & 0xffff0000) >>> 16) * 1664525) << 16) + (prev & 0x0000ffff) * 1664525)) + key[j] + j;
      i++; j++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (mt[i] ^ (((((prev & 0xffff0000) >>> 16) * 1566083941) << 16) + (prev & 0x0000ffff) * 1566083941)) - i;
      i++;
      if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
  }

  /** The next 32-bit output. */
  uint32(): number {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      const mag = (y: number) => (y & 1 ? 0x9908b0df : 0);
      for (; kk < N - M; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ mag(y);
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ mag(y);
      }
      const y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ mag(y);
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Python's getrandbits(k) for 1 <= k <= 32. */
  getrandbits(k: number): number {
    return this.uint32() >>> (32 - k);
  }

  /** Python's randrange(n) (and _randbelow): rejection sampling on n's bit length. */
  randrange(n: number): number {
    if (n <= 0) throw new Error('empty range');
    const k = Math.floor(Math.log2(n)) + 1;
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  choice<T>(xs: T[]): T {
    return xs[this.randrange(xs.length)];
  }
}
