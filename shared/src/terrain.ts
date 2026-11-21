export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 600;
export const CHUNK_SIZE = 50;

export class Terrain {
  public readonly width = WORLD_WIDTH;
  public readonly height = WORLD_HEIGHT;
  public readonly heights: Float32Array;
  public readonly dirtyChunks = new Set<number>();

  constructor(seed = Math.random() * 1000) {
    this.heights = new Float32Array(this.width);
    this.generate(seed);
  }

  public generate(seed: number): void {
    const f1 = 0.004 + (seed % 3) * 0.001;
    const f2 = 0.011;
    const f3 = 0.025;

    for (let x = 0; x < this.width; x++) {
      const h =
        210 +
        Math.sin(x * f1 + seed) * 95 +
        Math.sin(x * f2 + seed * 1.7) * 45 +
        Math.cos(x * f3 + seed * 0.5) * 18;
      this.heights[x] = Math.max(60, Math.min(this.height - 140, h));
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

  public markAllDirty(): void {
    const count = Math.ceil(this.width / CHUNK_SIZE);
    for (let i = 0; i < count; i++) this.dirtyChunks.add(i);
  }
}
