import { ExplosionEvent, GameSimulation } from '@tankwars/shared';

interface RetroBlast {
  x: number;
  y: number;
  radius: number;
  life: number;
  isDirt: boolean;
}

/** Affine Abbildung Weltkoordinaten -> Bildschirm-Pixel (aus der 3D-Kamera abgeleitet). */
export interface ScreenMap {
  ax: number;
  bx: number;
  ay: number;
  by: number;
  viewW: number;
  viewH: number;
}

/**
 * VGA-Modus: grobe 320-Pixel-Grafik, aber mit exakt derselben Kameraeinstellung wie die 3D-Ansicht,
 * damit Panzer und Gelände an denselben Stellen bleiben.
 */
export class RetroRenderer {
  private ctx: CanvasRenderingContext2D;
  private blasts: RetroBlast[] = [];
  private W = 320;
  private H = 200;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D Context nicht verfügbar');
    this.ctx = ctx;
    this.resize();
  }

  public resize(): void {
    this.W = 320;
    this.H = Math.max(120, Math.round((320 * window.innerHeight) / window.innerWidth));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
  }

  public spawnExplosion(ev: ExplosionEvent): void {
    this.blasts.push({ x: ev.x, y: ev.y, radius: ev.radius, life: 0.45, isDirt: ev.isDirt });
  }

  public render(sim: GameSimulation, dt: number, map: ScreenMap): void {
    const ctx = this.ctx;
    const k = this.W / map.viewW; // CSS-Pixel -> Retro-Pixel
    const X = (x: number) => (map.ax * x + map.bx) * k;
    const Y = (y: number) => (map.ay * y + map.by) * k;

    // Himmel in groben Bändern
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      ctx.fillStyle = `rgb(${Math.round(0 + t * 40)},${Math.round(0 + t * 20)},${Math.round(40 + t * 90)})`;
      ctx.fillRect(0, Math.floor((this.H / bands) * i), this.W, Math.ceil(this.H / bands) + 1);
    }

    // Gelände: pro Pixelspalte die passende Welt-x-Position
    for (let px = 0; px < this.W; px++) {
      const wx = (px / k - map.bx) / map.ax;
      if (wx < 0 || wx >= sim.terrain.width) continue;
      const top = Math.floor(Y(sim.terrain.getHeight(wx)));
      if (top >= this.H) continue;
      for (let y = Math.max(0, top); y < this.H; y++) {
        ctx.fillStyle = y - top < 2 ? '#55ff55' : y % 2 === 0 ? '#00aa00' : '#008800';
        ctx.fillRect(px, y, 1, 1);
      }
    }

    // Panzer (gleiche Größe wie in 3D, nur grob gepixelt)
    for (const tank of sim.tanks) {
      if (!tank.alive) continue;
      const tx = Math.round(X(tank.x));
      const ty = Math.round(Y(tank.y));
      const w = Math.max(8, Math.round(map.ax * k * 76));
      const h = Math.max(4, Math.round(w * 0.32));
      ctx.fillStyle = tank.color;
      ctx.fillRect(tx - w / 2, ty - h, w, h);
      ctx.fillRect(tx - w / 4, ty - h - Math.max(2, h / 2), w / 2, Math.max(2, h / 2));
      ctx.fillStyle = '#222';
      ctx.fillRect(tx - w / 2, ty - 1, w, 1);

      // Rohr: weiß, deutlich sichtbar, Länge wie das 3D-Rohr
      const rad = (tank.angle * Math.PI) / 180;
      const side = tank.angle <= 90 ? 1 : -1;
      const px0 = tank.x + side * 34;
      const py0 = tank.y + 30;
      const x0 = X(px0), y0 = Y(py0);
      const x1 = X(px0 + Math.cos(rad) * 38), y1 = Y(py0 + Math.sin(rad) * 38);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffff55';
    for (const p of sim.projectiles) {
      ctx.fillRect(Math.round(X(p.x)) - 1, Math.round(Y(p.y)) - 1, 2, 2);
    }

    for (const b of this.blasts) {
      b.life -= dt;
      if (b.life <= 0) continue;
      const r = Math.max(2, Math.round(b.radius * map.ax * k * (1.2 - b.life)));
      ctx.fillStyle = b.isDirt ? '#aa5500' : Math.random() > 0.5 ? '#ff5555' : '#ffff55';
      ctx.beginPath();
      ctx.arc(Math.round(X(b.x)), Math.round(Y(b.y)), r, 0, Math.PI * 2);
      ctx.fill();
    }
    this.blasts = this.blasts.filter((b) => b.life > 0);
  }
}
