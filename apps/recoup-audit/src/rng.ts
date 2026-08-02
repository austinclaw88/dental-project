/**
 * Deterministic RNG. The demo dataset must be byte-identical on every machine and
 * every run — a reconciliation number that moves between runs is not evidence.
 * No Date.now(), no Math.random(), anywhere in the generator.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }

  /** Fisher–Yates on a copy. */
  shuffle<T>(xs: readonly T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = a[i]!;
      a[i] = a[j]!;
      a[j] = tmp;
    }
    return a;
  }
}

/**
 * An exact-proportion sequence: weights are realised as counts, shuffled once,
 * then cycled. Unlike sampling, this makes per-payer and per-code volumes
 * deterministic AND stable, so the seeded-vs-found reconciliation is not at the
 * mercy of a lucky draw.
 */
export class WeightedCycle<T> {
  private items: T[];
  private i = 0;

  constructor(entries: Array<[T, number]>, rng: Rng) {
    const bag: T[] = [];
    for (const [value, weight] of entries) {
      for (let n = 0; n < weight; n++) bag.push(value);
    }
    this.items = rng.shuffle(bag);
  }

  next(): T {
    const v = this.items[this.i % this.items.length]!;
    this.i++;
    return v;
  }
}
