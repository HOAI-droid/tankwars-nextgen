export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 600;
export const CHUNK_SIZE = 50;

export interface WorldTheme {
  bg: number;
  rain: boolean;
  water: boolean;
  rebound: boolean;
  biome: number;
  seed: number;
}

function mulberry(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Terrain {
  public readonly width = WORLD_WIDTH;
  public readonly height = WORLD_HEIGHT;
  public readonly heights: Float32Array;
  public readonly dirtyChunks = new Set<number>();

  /** Welt-Thema (wird mit dem Gelände erzeugt und an Mitspieler übertragen). */
  public theme: WorldTheme = { bg: 0, rain: true, water: false, rebound: false, biome: 0, seed: 0 };

  constructor(seed = Math.random() * 1000) {
    this.heights = new Float32Array(this.width);
    this.generate(seed);
  }

  public generate(seed: number): void {
    const rnd = mulberry(Math.floor(seed * 1000) + 7);
    const biome = Math.floor(rnd() * 6);
    const bg = Math.floor(rnd() * 5);
    // Himmel/Kulisse bestimmen, ob es regnet (bg: 0 Gewitter, 1 sonnig, 2 Ruinen, 3 Sturmküste, 4 Alien)
    const rainChance = [0.8, 0.12, 0.6, 0.85, 0.6][bg];
    this.theme = { bg, rain: rnd() < rainChance, water: rnd() < 0.45, rebound: rnd() < 0.3, biome, seed };

    const p1 = rnd() * 100, p2 = rnd() * 100, p3 = rnd() * 100;
    const f1 = 0.0028 + rnd() * 0.0055;
    const f2 = 0.008 + rnd() * 0.008;
    const f3 = 0.02 + rnd() * 0.02;
    const base = 170 + rnd() * 110;
    // Gauß-Berge für Gipfel-Biome
    const peaks = [rnd() * 1000, rnd() * 1000, rnd() * 1000].map((x) => ({ x, w: 70 + rnd() * 110, h: 90 + rnd() * 150 }));

    for (let x = 0; x < this.width; x++) {
      let h: number;
      switch (biome) {
        case 1: // schroffe Grate
          h = base + Math.abs(Math.sin(x * f1 * 1.6 + p1)) * 150 - 70 + Math.sin(x * f2 + p2) * 32 + Math.sin(x * f3 + p3) * 12;
          break;
        case 2: { // Plateaus und Schluchten
          const t = Math.sin(x * f1 * 1.3 + p1) + Math.sin(x * f2 * 0.7 + p2) * 0.5;
          h = base + Math.round(t * 1.6) * 52 + Math.sin(x * f3 + p3) * 9;
          break;
        }
        case 3: // einzelne Gipfel
          h = base - 20 + peaks.reduce((acc, pk) => acc + pk.h * Math.exp(-Math.pow((x - pk.x) / pk.w, 2)), 0) + Math.sin(x * f3 + p3) * 10;
          break;
        case 4: // sanfte Dünen
          h = base - 20 + Math.sin(x * f1 * 1.8 + p1) * 48 + Math.sin(x * f2 + p2) * 24 + Math.sin(x * f3 + p3) * 8;
          break;
        default: // wellige Hügel
          h = base + Math.sin(x * f1 + p1) * 95 + Math.sin(x * f2 + p2) * 45 + Math.cos(x * f3 + p3) * 18;
      }
      this.heights[x] = Math.max(50, Math.min(this.height - 140, h));
    }
    // leichtes Glätten, damit keine Nadeln entstehen
    for (let pass = 0; pass < (biome === 2 ? 14 : 3); pass++) {
      for (let x = 1; x < this.width - 1; x++) {
        this.heights[x] = (this.heights[x - 1] + this.heights[x] * 2 + this.heights[x + 1]) / 4;
      }
    }
    this.markAllDirty();
  }

  public flattenPlatform(centerX: number, halfWidth = 14): void {
    const cx = Math.floor(centerX);
    const targetH = this.getHeight(cx);
    for (let x = Math.max(0, cx - halfWidth); x <= Math.min(this.width - 1, cx + halfWidth); x++) {
      this.heights[x] = targetH;
      this.dirtyChunks.add(Math.floor(x / CHUNK_SIZE));
    }
  }

  public getHeight(x: number): number {
    const ix = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
    return this.heights[ix];
  }

  public carveCrater(cx: number, cy: number, radius: number): void {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));

    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = Math.sqrt(Math.max(0, radius * radius - dx * dx));
      const craterBottom = cy - dy;
      const craterTop = cy + dy;
      const currentH = this.heights[x];

      if (currentH > craterBottom) {
        if (currentH <= craterTop) {
          this.heights[x] = Math.max(12, craterBottom);
        } else {
          this.heights[x] = Math.max(12, currentH - dy * 2);
        }
        this.dirtyChunks.add(Math.floor(x / CHUNK_SIZE));
      }
    }
  }

  public addDirt(cx: number, cy: number, radius: number): void {
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));

    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = Math.sqrt(Math.max(0, radius * radius - dx * dx));
      const newH = Math.min(this.height - 40, Math.max(this.heights[x], cy + dy));
      if (newH > this.heights[x]) {
        this.heights[x] = newH;
        this.dirtyChunks.add(Math.floor(x / CHUNK_SIZE));
      }
    }
  }

  /** Lose Erde rutscht nach (Crumbling Hills). Gibt true zurück, solange sich noch etwas bewegt. */
  public crumble(maxSlope = 2.4, passes = 3): boolean {
    let moved = false;
    for (let p = 0; p < passes; p++) {
      for (let x = 0; x < this.width - 1; x++) {
        const d = this.heights[x] - this.heights[x + 1];
        if (Math.abs(d) > maxSlope) {
          const m = (Math.abs(d) - maxSlope) * 0.45;
          const hi = d > 0 ? x : x + 1;
          const lo = d > 0 ? x + 1 : x;
          this.heights[hi] -= m;
          this.heights[lo] += m;
          this.dirtyChunks.add(Math.floor(x / CHUNK_SIZE));
          this.dirtyChunks.add(Math.floor((x + 1) / CHUNK_SIZE));
          moved = true;
        }
      }
    }
    return moved;
  }

  public markAllDirty(): void {
    const count = Math.ceil(this.width / CHUNK_SIZE);
    for (let i = 0; i < count; i++) this.dirtyChunks.add(i);
  }
}
