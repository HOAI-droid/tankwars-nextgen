import { ExplosionEvent, GameSimulation, WORLD_HEIGHT, WORLD_WIDTH } from '@tankwars/shared';

interface RetroBlast {
  x: number;
  y: number;
  radius: number;
  life: number;
  isDirt: boolean;
}

export class RetroRenderer {
  private ctx: CanvasRenderingContext2D;
  private blasts: RetroBlast[] = [];

  private readonly W = 320;
  private readonly H = 200;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = this.W;
    canvas.height = this.H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D Context nicht verfügbar');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  public spawnExplosion(ev: ExplosionEvent): void {
    this.blasts.push({ x: ev.x, y: ev.y, radius: ev.radius, life: 0.45, isDirt: ev.isDirt });
  }

  public render(sim: GameSimulation, dt: number): void {
    const ctx = this.ctx;
    const sx = this.W / WORLD_WIDTH;
    const sy = this.H / WORLD_HEIGHT;

    ctx.fillStyle = '#00002a';
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.fillStyle = '#00aa00';
    for (let px = 0; px < this.W; px++) {
      const worldX = Math.floor(px / sx);
      const h = Math.floor(sim.terrain.getHeight(worldX) * sy);
      ctx.fillRect(px, this.H - h, 1, h);
    }

    for (const tank of sim.tanks) {
      if (!tank.alive) continue;
      const tx = Math.round(tank.x * sx);
      const ty = Math.round(this.H - tank.y * sy);

      ctx.fillStyle = tank.color;
      ctx.fillRect(tx - 4, ty - 3, 8, 3);
      ctx.fillRect(tx - 2, ty - 5, 4, 2);

      const rad = (tank.angle * Math.PI) / 180;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty - 4);
      ctx.lineTo(tx + Math.cos(rad) * 7, ty - 4 - Math.sin(rad) * 7);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffff55';
    for (const p of sim.projectiles) {
      ctx.fillRect(Math.round(p.x * sx) - 1, Math.round(this.H - p.y * sy) - 1, 2, 2);
    }

    for (const b of this.blasts) {
      b.life -= dt;
      if (b.life <= 0) continue;
      const bx = Math.round(b.x * sx);
      const by = Math.round(this.H - b.y * sy);
      const r = Math.max(2, Math.round(b.radius * sx * (1.2 - b.life)));

      ctx.fillStyle = b.isDirt ? '#aa5500' : Math.random() > 0.5 ? '#ff5555' : '#ffff55';
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }
    this.blasts = this.blasts.filter((b) => b.life > 0);
  }
}
