import { BeamEvent, ExplosionEvent, GameSimulation } from '@tankwars/shared';

interface RetroBlast {
  x: number;
  y: number;
  radius: number;
  life: number;
  isDirt: boolean;
}

export interface ScreenMap {
  ax: number;
  bx: number;
  ay: number;
  by: number;
  viewW: number;
  viewH: number;
}

export interface RetroHud {
  name: string;
  power: number;
  angle: number;
  men: number;
  mine: boolean;
  hp: number;
  money: number;
  round: number;
  inv: boolean[];
  sel: number;
}

const BG = ['#1c1418', '#14141c', '#181410', '#101818', '#1c101c'];
const MAGENTA = '#d048d0';
const TRAIL_COLORS: Record<string, string> = {};

/**
 * VGA-Modus im Stil des DOS-Originals "Tank Wars" (Kenny Morse, 1990):
 * dunkler Himmel mit Sternen, leuchtend grünes Gelände, magentafarbener Rahmen,
 * Kopfzeile mit Angle / Power / Direction / Wind / Men, Waffenleiste, dauerhafte bunte Flugbahnen.
 * Die Kamera ist identisch zur 3D-Ansicht, damit alle Positionen gleich bleiben.
 */
export class RetroRenderer {
  private ctx: CanvasRenderingContext2D;
  private blasts: RetroBlast[] = [];
  private beams: Array<BeamEvent & { life: number }> = [];
  private trails = new Map<string, { pts: Array<[number, number]>; color: string }>();
  private stars: Array<[number, number, string]> = [];
  private lastTerrain: unknown = null;
  private lastRound = -1;
  private W = 320;
  private H = 200;
  private t = 0;

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
    this.stars = [];
  }

  public spawnBeam(b: BeamEvent): void {
    this.beams.push({ ...b, life: 0.35 });
  }

  public spawnExplosion(ev: ExplosionEvent): void {
    this.blasts.push({ x: ev.x, y: ev.y, radius: ev.radius, life: 0.7, isDirt: ev.isDirt });
  }

  private label(s: string, x: number, y: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillText(s, x, y);
  }

  public render(sim: GameSimulation, dt: number, map: ScreenMap, hud: RetroHud): void {
    const ctx = this.ctx;
    this.t += dt;
    const k = this.W / map.viewW;
    const X = (x: number) => (map.ax * x + map.bx) * k;
    const Y = (y: number) => (map.ay * y + map.by) * k;

    if (this.lastTerrain !== sim.terrain || this.lastRound !== sim.round) {
      this.lastTerrain = sim.terrain;
      this.lastRound = sim.round;
      this.trails.clear();
      this.stars = [];
    }
    if (this.stars.length === 0) {
      let s = Math.floor(sim.terrain.theme.seed * 100) + 11;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const cols = ['#ffffff', '#ffff55', '#ff5555', '#55ffff', '#aaaaaa', '#ff55ff'];
      for (let i = 0; i < 110; i++) this.stars.push([Math.floor(rnd() * this.W), Math.floor(rnd() * this.H), cols[Math.floor(rnd() * cols.length)]]);
    }

    // Hintergrund
    ctx.fillStyle = BG[(sim.terrain.theme.bg | 0) % BG.length];
    ctx.fillRect(0, 0, this.W, this.H);
    for (const [sx, sy, c] of this.stars) {
      ctx.fillStyle = c;
      ctx.fillRect(sx, sy, 1, 1);
    }

    // Gelände: leuchtend grün, einfarbig
    ctx.fillStyle = '#10e810';
    for (let px = 0; px < this.W; px++) {
      const wx = (px / k - map.bx) / map.ax;
      const top = Math.floor(Y(sim.terrain.getHeight(Math.max(0, Math.min(sim.terrain.width - 1, wx)))));
      if (top >= this.H) continue;
      ctx.fillRect(px, Math.max(0, top), 1, this.H - Math.max(0, top));
    }

    // Flugbahnen: bleiben bis zum Rundenende sichtbar, in der Farbe des Schützen
    for (const p of sim.projectiles) {
      let tr = this.trails.get(p.id);
      if (!tr) {
        const owner = sim.tanks.find((t) => t.id === p.ownerId);
        const key = owner?.color ?? '#ffffff';
        TRAIL_COLORS[key] = key;
        this.trails.set(p.id, (tr = { pts: [], color: key }));
      }
      tr.pts.push([p.x, p.y]);
    }
    for (const tr of sim.options.trailVisible ? this.trails.values() : []) {
      ctx.fillStyle = tr.color;
      let lx = -1, ly = -1;
      for (const [wx, wy] of tr.pts) {
        const px = Math.round(X(wx)), py = Math.round(Y(wy));
        if (px === lx && py === ly) continue;
        ctx.fillRect(px, py, 1, 1);
        lx = px;
        ly = py;
      }
    }

    // Panzer im DOS-Stil
    for (const tank of sim.tanks) {
      if (!tank.alive) continue;
      const tx = Math.round(X(tank.x));
      const ty = Math.round(Y(tank.y));
      const w = Math.max(9, Math.round(map.ax * k * 62));
      const h = Math.max(3, Math.round(w * 0.28));
      ctx.fillStyle = tank.color;
      ctx.fillRect(tx - w / 2, ty - h, w, h);
      ctx.fillRect(tx - w / 4, ty - h - Math.max(2, h * 0.7), w / 2, Math.max(2, h * 0.7));
      ctx.fillStyle = '#ffffff';
      const side = tank.angle <= 90 ? 1 : -1;
      const rad = (tank.angle * Math.PI) / 180;
      const px0 = tank.x + side * 34, py0 = tank.y + 30;
      ctx.strokeStyle = tank.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(px0), Y(py0));
      ctx.lineTo(X(px0 + Math.cos(rad) * 40), Y(py0 + Math.sin(rad) * 40));
      ctx.stroke();
      if (tank.shield > 0) {
        ctx.strokeStyle = '#55ffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx - w / 2 - 2, ty - h - 5, w + 4, h + 6);
      }
    }

    ctx.fillStyle = '#ffffff';
    for (const p of sim.options.ballVisible ? sim.projectiles : []) ctx.fillRect(Math.round(X(p.x)) - 1, Math.round(Y(p.y)) - 1, 2, 2);

    for (const b of this.beams) {
      b.life -= dt;
      ctx.strokeStyle = Math.random() < 0.5 ? '#ff4040' : '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(b.x0), Y(b.y0));
      ctx.lineTo(X(b.x1), Y(b.y1));
      ctx.stroke();
    }
    this.beams = this.beams.filter((b) => b.life > 0);

    // Explosionen: buntes Pixel-Konfetti wie im Original
    const conf = ['#ffffff', '#ffff55', '#ff5555', '#55ff55', '#5555ff', '#ff55ff', '#55ffff', '#ff9900'];
    for (const b of this.blasts) {
      b.life -= dt;
      if (b.life <= 0) continue;
      const age = 1 - b.life / 0.7;
      const r = Math.max(3, b.radius * map.ax * k * (0.7 + age * 0.6));
      const n = Math.floor(r * r * 0.9);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
        ctx.fillStyle = b.isDirt ? (Math.random() < 0.5 ? '#a86830' : '#10e810') : conf[Math.floor(Math.random() * conf.length)];
        ctx.fillRect(Math.round(X(b.x) + Math.cos(a) * d), Math.round(Y(b.y) + Math.sin(a) * d), 1, 1);
      }
    }
    this.blasts = this.blasts.filter((b) => b.life > 0);

    // Rahmen
    ctx.strokeStyle = MAGENTA;
    ctx.lineWidth = 1;
    ctx.strokeRect(2.5, 29.5, this.W - 5, this.H - 32);
    ctx.strokeRect(4.5, 31.5, this.W - 9, this.H - 36);
    if (sim.terrain.theme.rebound) {
      ctx.font = 'bold 8px monospace';
      ctx.textBaseline = 'top';
      this.label('R', 6, 33, '#ff9500');
    }

    // Kopfzeile wie im Original
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.W, 28);
    ctx.font = 'bold 8px monospace';
    ctx.textBaseline = 'top';
    const wind = Math.round(sim.wind);
    const dir = hud.angle <= 90 ? '→' : '←';
    this.label('Angle:', 2, 2, MAGENTA);
    this.label(String(hud.angle), 38, 2, '#ffff55');
    this.label(hud.name.slice(0, 12).toUpperCase(), this.W / 2 - hud.name.slice(0, 12).length * 2.4, 2, hud.mine ? '#ffffff' : '#9a9a9a');
    this.label('Direction(', this.W - 82, 2, MAGENTA);
    this.label(dir, this.W - 24, 2, '#ffff55');
    this.label(')', this.W - 14, 2, MAGENTA);
    this.label('Power:', 2, 11, MAGENTA);
    this.label(String(hud.power), 38, 11, '#ffff55');
    this.label('Wind:', this.W / 2 - 24, 11, '#5555ff');
    this.label(`${Math.abs(wind)} ${wind < 0 ? '←' : '→'}`, this.W / 2 + 10, 11, '#8888ff');
    this.label('Men:', this.W - 70, 11, MAGENTA);
    this.label(String(hud.men), this.W - 40, 11, '#ffff55');

    // Waffenleiste: sichtbare Kästchen, aktive Waffe rot
    const n = hud.inv.length;
    const bw = Math.floor((this.W - 8) / Math.max(n, 20));
    for (let i = 0; i < n; i++) {
      const bx = 4 + i * bw;
      ctx.fillStyle = i === hud.sel ? '#ff2020' : hud.inv[i] ? '#e0e0e0' : '#303030';
      ctx.fillRect(bx, 20, bw - 2, 7);
      ctx.fillStyle = '#000';
      ctx.fillRect(bx + 2, 22, Math.max(1, bw - 6), 3);
    }
  }
}
