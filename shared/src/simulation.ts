import { computeBotShot } from './bots.js';
import { Terrain, WORLD_WIDTH } from './terrain.js';
import {
  BotDifficulty,
  ExplosionEvent,
  GameMode,
  Projectile,
  ShotCommand,
  Tank,
  TurnPhase,
} from './types.js';
import { DEFENSE_ITEMS, INITIAL_INVENTORY, ShopItemId, WEAPONS } from './weapons.js';

export const GRAVITY = 280;
export const POWER_TO_SPEED = 6.2;

export class GameSimulation {
  public terrain: Terrain;
  public tanks: Tank[] = [];
  public projectiles: Projectile[] = [];
  public recentExplosions: ExplosionEvent[] = [];

  public mode: GameMode = 'SIMULTANEOUS';
  public phase: TurnPhase = 'PLANNING';
  public activeTankIndex = 0;
  public wind = 0;
  public round = 1;

  private pendingShots = new Map<string, ShotCommand>();
  private projCounter = 0;
  private autoTimer = 0;

  constructor(mode: GameMode = 'SIMULTANEOUS') {
    this.mode = mode;
    this.terrain = new Terrain();
  }

  public setupMatch(
    players: Array<{ id: string; name: string; color: string; isBot: boolean; botType?: BotDifficulty }>
  ): void {
    this.round = 1;
    this.terrain = new Terrain(Math.random() * 9999);
    this.wind = Math.round((Math.random() - 0.5) * 110);
    this.projectiles = [];
    this.pendingShots.clear();

    const margin = 80;
    const step = (WORLD_WIDTH - margin * 2) / Math.max(1, players.length - 1);

    this.tanks = players.map((p, i) => {
      const x = Math.round(margin + i * step + (Math.random() - 0.5) * 20);
      this.terrain.flattenPlatform(x, 14);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        botType: p.botType,
        x,
        y: this.terrain.getHeight(x),
        angle: x < WORLD_WIDTH / 2 ? 45 : 135,
        power: 55,
        hp: 100,
        maxHp: 100,
        shield: 0,
        parachutes: 1,
        money: 2000,
        score: 0,
        alive: true,
        selectedWeapon: 'BABY_MISSILE',
        inventory: { ...INITIAL_INVENTORY },
        ready: false,
      };
    });

    this.activeTankIndex = 0;
    this.phase = 'PLANNING';
  }

  public submitShot(cmd: ShotCommand): boolean {
    if (this.phase !== 'PLANNING') return false;
    const tank = this.tanks.find((t) => t.id === cmd.tankId && t.alive);
    if (!tank) return false;

    if (this.mode === 'CLASSIC') {
      const active = this.tanks[this.activeTankIndex];
      if (!active || active.id !== tank.id) return false;
      this.spawnProjectile(tank, cmd);
      this.phase = 'RESOLVING';
      return true;
    }

    tank.angle = cmd.angle;
    tank.power = cmd.power;
    tank.selectedWeapon = cmd.weaponId;
    tank.ready = true;
    this.pendingShots.set(tank.id, cmd);

    const aliveHumans = this.tanks.filter((t) => t.alive && !t.isBot);
    if (aliveHumans.every((h) => h.ready)) {
      this.triggerSimultaneousLaunch();
    }
    return true;
  }

  public triggerSimultaneousLaunch(): void {
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      const cmd =
        this.pendingShots.get(tank.id) ??
        (tank.isBot
          ? computeBotShot(tank, this.tanks, this.wind)
          : { tankId: tank.id, angle: tank.angle, power: tank.power, weaponId: tank.selectedWeapon });
      this.spawnProjectile(tank, cmd);
      tank.ready = false;
    }
    this.pendingShots.clear();
    this.phase = 'RESOLVING';
  }

  private spawnProjectile(tank: Tank, cmd: ShotCommand): void {
    const weaponId = tank.inventory[cmd.weaponId] > 0 ? cmd.weaponId : 'BABY_MISSILE';
    if (weaponId !== 'BABY_MISSILE') tank.inventory[weaponId]--;

    const rad = (cmd.angle * Math.PI) / 180;
    const speed = cmd.power * POWER_TO_SPEED;

    this.projectiles.push({
      id: `p_${++this.projCounter}`,
      ownerId: tank.id,
      weaponId,
      x: tank.x + (cmd.angle <= 90 ? 34 : -34) + Math.cos(rad) * 38,
      y: tank.y + 30 + Math.sin(rad) * 38,
      vx: Math.cos(rad) * speed,
      vy: Math.sin(rad) * speed,
      hasSplit: false,
      alive: true,
    });
  }

  public step(dt: number): void {
    this.recentExplosions = [];

    // Sind keine Menschen mehr am Leben (nur noch Bots), würde das Match ewig
    // in PLANNING hängen bleiben -> Bots automatisch feuern lassen.
    if (this.phase === 'PLANNING' && this.mode === 'SIMULTANEOUS') {
      const alive = this.tanks.filter((t) => t.alive);
      if (alive.length > 1 && alive.every((t) => t.isBot)) {
        this.autoTimer += dt;
        if (this.autoTimer > 0.8) {
          this.autoTimer = 0;
          this.triggerSimultaneousLaunch();
        }
      }
    }

    for (const p of this.projectiles) {
      if (!p.alive) continue;

      const prevVy = p.vy;
      p.vx += this.wind * dt;
      p.vy -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const def = WEAPONS[p.weaponId];
      if (def.splitCount && !p.hasSplit && prevVy > 0 && p.vy <= 0) {
        p.hasSplit = true;
        p.alive = false;
        const spread = 45;
        for (let i = 0; i < def.splitCount; i++) {
          const offset = (i - (def.splitCount - 1) / 2) * spread;
          this.projectiles.push({
            id: `p_${++this.projCounter}`,
            ownerId: p.ownerId,
            weaponId: 'BABY_MISSILE',
            x: p.x,
            y: p.y,
            vx: p.vx + offset,
            vy: p.vy,
            hasSplit: true,
            alive: true,
          });
        }
        continue;
      }

      if (p.x < 0 || p.x >= WORLD_WIDTH) {
        p.alive = false;
        continue;
      }

      const groundY = this.terrain.getHeight(p.x);
      const hitTank = this.tanks.find(
        (t) => t.alive && Math.hypot(t.x - p.x, t.y + 22 - p.y) < 36
      );

      if (p.y <= groundY || hitTank) {
        p.alive = false;
        this.detonate(p);
      }
    }

    this.projectiles = this.projectiles.filter((p) => p.alive);

    let anyFalling = false;
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      const groundY = this.terrain.getHeight(tank.x);
      if (tank.y > groundY + 0.5) {
        anyFalling = true;
        const fallSpeed = tank.parachutes > 0 ? 45 : 160;
        const drop = Math.min(tank.y - groundY, fallSpeed * dt);
        tank.y -= drop;
        if (tank.parachutes === 0 && drop > 0) {
          tank.hp -= drop * 0.25;
          if (tank.hp <= 0) this.killTank(tank);
        }
      } else {
        tank.y = groundY;
      }
    }

    if (this.phase === 'RESOLVING' && this.projectiles.length === 0 && !anyFalling) {
      this.endTurn();
    }
  }

  private detonate(p: Projectile): void {
    const def = WEAPONS[p.weaponId];
    if (def.isDirt) {
      this.terrain.addDirt(p.x, p.y, def.explosionRadius);
    } else {
      this.terrain.carveCrater(p.x, p.y, def.explosionRadius);
      for (const tank of this.tanks) {
        if (!tank.alive) continue;
        const dist = Math.hypot(tank.x - p.x, tank.y + 6 - p.y);
        if (dist < def.explosionRadius + 14) {
          const factor = 1 - dist / (def.explosionRadius + 14);
          let dmg = Math.round(def.maxDamage * factor);
          if (tank.shield > 0) {
            const absorbed = Math.min(tank.shield, dmg);
            tank.shield -= absorbed;
            dmg -= absorbed;
          }
          tank.hp -= dmg;
          if (tank.hp <= 0) {
            this.killTank(tank, p.ownerId);
          }
        }
      }
    }

    this.recentExplosions.push({
      x: p.x,
      y: p.y,
      radius: def.explosionRadius,
      isDirt: !!def.isDirt,
      weaponId: p.weaponId,
    });
  }

  private killTank(victim: Tank, killerId?: string): void {
    victim.hp = 0;
    victim.alive = false;
    if (killerId && killerId !== victim.id) {
      const killer = this.tanks.find((t) => t.id === killerId);
      if (killer) {
        killer.score += 1;
        killer.money += 2500;
      }
    }
  }

  private endTurn(): void {
    const alive = this.tanks.filter((t) => t.alive);
    if (alive.length <= 1) {
      for (const t of this.tanks) t.money += 500;
      if (alive[0]) alive[0].money += 1500;
      this.phase = 'GAME_OVER';
      return;
    }

    this.wind = Math.max(-60, Math.min(60, this.wind + Math.round((Math.random() - 0.5) * 20)));

    if (this.mode === 'CLASSIC') {
      do {
        this.activeTankIndex = (this.activeTankIndex + 1) % this.tanks.length;
      } while (!this.tanks[this.activeTankIndex].alive);
    }
    this.phase = 'PLANNING';
  }

  public buyItem(tankId: string, itemId: ShopItemId): boolean {
    const tank = this.tanks.find((t) => t.id === tankId);
    if (!tank) return false;

    if (itemId === 'SHIELD') {
      if (tank.money < DEFENSE_ITEMS.SHIELD.price) return false;
      tank.money -= DEFENSE_ITEMS.SHIELD.price;
      tank.shield = Math.min(100, tank.shield + DEFENSE_ITEMS.SHIELD.amount);
      return true;
    }

    if (itemId === 'PARACHUTE') {
      if (tank.money < DEFENSE_ITEMS.PARACHUTE.price) return false;
      tank.money -= DEFENSE_ITEMS.PARACHUTE.price;
      tank.parachutes += DEFENSE_ITEMS.PARACHUTE.amount;
      return true;
    }

    const def = WEAPONS[itemId];
    if (!def || def.price === 0 || tank.money < def.price) return false;
    tank.money -= def.price;
    tank.inventory[itemId] = (tank.inventory[itemId] || 0) + def.bundleSize;
    return true;
  }

  public startNextRound(): void {
    this.round += 1;
    this.terrain = new Terrain(Math.random() * 9999);
    this.wind = Math.round((Math.random() - 0.5) * 110);
    this.projectiles = [];
    this.pendingShots.clear();

    const margin = 80;
    const step = (WORLD_WIDTH - margin * 2) / Math.max(1, this.tanks.length - 1);

    const shuffled = [...this.tanks].sort(() => Math.random() - 0.5);
    shuffled.forEach((tank, i) => {
      const x = Math.round(margin + i * step + (Math.random() - 0.5) * 20);
      this.terrain.flattenPlatform(x, 14);
      tank.x = x;
      tank.y = this.terrain.getHeight(x);
      tank.hp = tank.maxHp;
      tank.alive = true;
      tank.ready = false;
      tank.power = 55;
      tank.angle = x < WORLD_WIDTH / 2 ? 45 : 135;
    });

    this.activeTankIndex = 0;
    this.phase = 'PLANNING';
  }

  public getSnapshot(includeTerrain = false) {
    return {
      v: 1,
      mode: this.mode,
      phase: this.phase,
      round: this.round,
      wind: this.wind,
      activeTankIndex: this.activeTankIndex,
      tanks: this.tanks,
      projectiles: this.projectiles,
      explosions: this.recentExplosions,
      terrain: includeTerrain ? Array.from(this.terrain.heights) : undefined,
      theme: this.terrain.theme,
    };
  }
}
