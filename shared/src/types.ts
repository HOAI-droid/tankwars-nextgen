export type GameMode = 'CLASSIC' | 'SIMULTANEOUS';
export type TurnPhase = 'PLANNING' | 'RESOLVING' | 'SHOP' | 'GAME_OVER';

export type BotDifficulty = 'MR_STUPID' | 'LOBBER' | 'RIFLEMAN' | 'WINDMASTER' | 'WINDLESS_WIT' | 'LOB_SHOOT' | 'TWANGER';

export type WeaponId =
  | 'BABY_MISSILE'
  | 'MISSILE'
  | 'MIRV'
  | 'NUKE'
  | 'DIRT_BALL'
  | 'HAND_GRENADE'
  | 'LEAD_BALL'
  | 'MARK_II'
  | 'NUKE_5M'
  | 'CRI_S'
  | 'CRI_D'
  | 'CRI_ND'
  | 'SONIC'
  | 'EXPLOSIVE_DIRT'
  | 'LASER'
  | 'GUIDED_H'
  | 'GUIDED_V'
  | 'BOMBLET'
  | 'DRILL';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  price: number;
  bundleSize: number;
  explosionRadius: number;
  maxDamage: number;
  isDirt?: boolean;
  splitCount?: number;
  kind?: 'laser' | 'cri' | 'sonic' | 'xdirt' | 'lead' | 'drill';
  damageRadius?: number;
  knockback?: { radius: number; min: number; max: number };
  cri?: { n: number; fluent: boolean; r: number };
  guide?: 'H' | 'V';
  color: string;
}

export interface Tank {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  botType?: BotDifficulty;
  x: number;
  y: number;
  angle: number;
  power: number;
  hp: number;
  maxHp: number;
  shield: number;
  parachutes: number;
  money: number;
  score: number;
  alive: boolean;
  selectedWeapon: WeaponId;
  inventory: Record<WeaponId, number>;
  ready: boolean;
  dropping?: boolean;
  wins?: number;
}

export interface ShotCommand {
  tankId: string;
  angle: number;
  power: number;
  weaponId: WeaponId;
}

export interface Projectile {
  id: string;
  ownerId: string;
  weaponId: WeaponId;
  targetId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hasSplit: boolean;
  alive: boolean;
}

export interface ExplosionEvent {
  x: number;
  y: number;
  radius: number;
  isDirt: boolean;
  weaponId: WeaponId;
}

export interface BeamEvent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  power: number;
}
