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
}

/** Himmels-Paletten ("Backgrounds A..E") wie im DOS-Original: weich verlaufende Farbbänder. */
const SKIES: Array<Array<[number, number, number]>> = [
  [[0, 0, 40], [0, 0, 90], [20, 30, 150], [60, 90, 200], [140, 170, 230]],
  [[10, 0, 40], [60, 0, 90], [150, 30, 100], [230, 100, 60], [255, 190, 90]],
  [[0, 20, 20], [0, 60, 70], [0, 120, 110], [60, 180, 150], [170, 230, 190]],
  [[30, 0, 0], [90, 10, 10], [170, 40, 20], [230, 110, 30], [255, 200, 80]],
  [[20, 0, 50], [50, 0, 110], [90, 20, 170], [150, 80, 210], [210, 150, 240]],
];

/**
 * VGA-Modus im Stil von "Tank Wars" (Kenny Morse, 1990): 320 Pixel breit, 256-Farben-Look,
 * Farbverlauf-Himmel, mehrfarbig geschichtetes Erdreich, Schusspur, Infoleiste oben.
 * Die Kamera ist identisch zur 3D-Ansicht, damit alle Positionen gleich bleiben.
 */
export class RetroRenderer {
  private ctx: CanvasRenderingContext2D;
  private blasts: RetroBlast[] = [];
  private beams: Array<BeamEvent & { life: number }> = [];
  private trails = new Map<string, Array<[number, number]>>();
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
  }

  public spawnBeam(b: BeamEvent): void {
    this.beams.push({ ...b, life: 0.35 });
  }

  public spawnExplosion(ev: ExplosionEvent): void {
    this.blasts.push({ x: ev.x, y: ev.y, radius: ev.radius, life: 0.55, isDirt: ev.isDirt });
  }

  private text(s: string, x: number, y: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = '#000';
    c.fillText(s, x + 1, y + 1);
    c.fillStyle = color;
    c.fillText(s, x, y);
  }

  public render(sim: GameSimulation, dt: number, map: ScreenMap, hud: RetroHud): void {
    const ctx = this.ctx;
    this.t += dt;
    const k = this.W / map.viewW;
    const X = (x: number) => (map.ax * x + map.bx) * k;
    const Y = (y: number) => (map.ay * y + map.by) * k;

    // Himmel: Farbverlauf in groben Stufen, Palette "rotiert" langsam (Palette Speed)
    const pal = SKIES[(sim.terrain.theme.bg | 0) % SKIES.length];
    const steps = 24;
    const shift = (Math.sin(this.t * 0.4) + 1) * 0.04;
    for (let i = 0; i < steps; i++) {
      const f = Math.min(1, (i / (steps - 1)) + shift) * (pal.length - 1);
      const a = Math.floor(f), b = Math.min(pal.length - 1, a + 1), m = f - a;
      const col = [0, 1, 2].map((j) => Math.round(pal[a][j] * (1 - m) + pal[b][j] * m));
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.fillRect(0, Math.floor((this.H / steps) * i), this.W, Math.ceil(this.H / steps) + 1);
    }

    // Gelände mit Schichten
    const grass = ['#58f058', '#30c030', '#209020'];
    const earth = ['#a86830', '#905820', '#784810', '#603808', '#482800'];
    for (let px = 0; px < this.W; px++) {
      const wx = (px / k - map.bx) / map.ax;
      if (wx < 0 || wx >= sim.terrain.width) continue;
      const top = Math.floor(Y(sim.terrain.getHeight(wx)));
      if (top >= this.H) continue;
      for (let y = Math.max(0, top); y < this.H; y++) {
        const d = y - top;
        ctx.fillStyle = d < 3 ? grass[d] : earth[Math.min(earth.length - 1, Math.floor((d - 3) / 7))];
        ctx.fillRect(px, y, 1, 1);
      }
    }

    // Wände bei Rebound
    if (sim.terrain.theme.rebound) {
      ctx.fillStyle = '#b050ff';
      ctx.fillRect(Math.round(X(0)), 0, 1, this.H);
      ctx.fillRect(Math.round(X(sim.terrain.width)) - 1, 0, 1, this.H);
    }

    // Panzer im DOS-Stil
    for (const tank of sim.tanks) {
      if (!tank.alive) continue;
      const tx = Math.round(X(tank.x));
      const ty = Math.round(Y(tank.y));
      const w = Math.max(9, Math.round(map.ax * k * 70));
      const h = Math.max(4, Math.round(w * 0.3));
      const side = tank.angle <= 90 ? 1 : -1;
      ctx.fillStyle = '#202020';
      ctx.fillRect(tx - w / 2, ty - 2, w, 2);
      ctx.fillStyle = tank.color;
      ctx.fillRect(tx - w / 2 + 1, ty - h, w - 2, h - 2);
      ctx.fillRect(tx - w / 4, ty - h - Math.max(2, h * 0.6), w / 2, Math.max(2, h * 0.6));
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(tx - w / 2 + 1, ty - h, w - 2, 1);

      const rad = (tank.angle * Math.PI) / 180;
      const px0 = tank.x + side * 34, py0 = tank.y + 30;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(px0), Y(py0));
      ctx.lineTo(X(px0 + Math.cos(rad) * 38), Y(py0 + Math.sin(rad) * 38));
      ctx.stroke();
      if (tank.shield > 0) {
        ctx.strokeStyle = '#55ffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx - w / 2 - 2, ty - h - 4, w + 4, h + 5);
      }
    }

    // Geschosse mit Schusspur
    const live = new Set<string>();
    for (const p of sim.projectiles) {
      live.add(p.id);
      let tr = this.trails.get(p.id);
      if (!tr) this.trails.set(p.id, (tr = []));
      tr.push([p.x, p.y]);
    }
    ctx.fillStyle = '#ffffff';
    for (const tr of this.trails.values()) {
      for (let i = 0; i < tr.length; i += 3) ctx.fillRect(Math.round(X(tr[i][0])), Math.round(Y(tr[i][1])), 1, 1);
    }
    ctx.fillStyle = '#ffff55';
    for (const p of sim.projectiles) ctx.fillRect(Math.round(X(p.x)) - 1, Math.round(Y(p.y)) - 1, 2, 2);
    if (sim.phase === 'PLANNING') this.trails.clear();

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

    // Explosionen: Farbpalette Weiß -> Gelb -> Rot
    for (const b of this.blasts) {
      b.life -= dt;
      if (b.life <= 0) continue;
      const age = 1 - b.life / 0.55;
      const r = Math.max(2, Math.round(b.radius * map.ax * k * (0.5 + age)));
      const cols = b.isDirt ? ['#c88848', '#a86830'] : ['#ffffff', '#ffff55', '#ff9900', '#ff2200'];
      const ci = Math.min(cols.length - 1, Math.floor(age * cols.length));
      ctx.fillStyle = cols[ci];
      ctx.beginPath();
      ctx.arc(Math.round(X(b.x)), Math.round(Y(b.y)), r, 0, Math.PI * 2);
      ctx.fill();
    }
    this.blasts = this.blasts.filter((b) => b.life > 0);

    // Infoleiste wie im Original: POWER / ANGLE / DIRECTION / MEN / WIND
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.W, 11);
    ctx.fillStyle = '#4040a0';
    ctx.fillRect(0, 11, this.W, 1);
    ctx.font = 'bold 8px monospace';
    ctx.textBaseline = 'top';
    const wind = Math.round(sim.wind);
    const dir = hud.angle <= 90 ? '>' : '<';
    this.text(`${hud.name.slice(0, 10).toUpperCase()}`, 2, 2, hud.mine ? '#ffff55' : '#aaaaaa');
    this.text(`POWER ${String(hud.power).padStart(3, '0')}`, 62, 2, '#55ff55');
    this.text(`ANGLE ${String(hud.angle).padStart(3, '0')}`, 118, 2, '#ffff55');
    this.text(`DIR ${dir}`, 174, 2, '#ffffff');
    this.text(`MEN ${hud.men}`, 204, 2, '#55ffff');
    this.text(`WIND ${wind < 0 ? '<' : '>'}${Math.abs(wind)}`, 244, 2, '#ff9955');
    if (sim.terrain.theme.rebound) this.text('R', 312, 2, '#c060ff');
  }
}
