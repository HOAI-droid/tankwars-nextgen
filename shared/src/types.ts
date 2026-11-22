export type GameMode = 'CLASSIC' | 'SIMULTANEOUS';
export type TurnPhase = 'PLANNING' | 'RESOLVING' | 'SHOP' | 'GAME_OVER';

export type BotDifficulty = 'MR_STUPID' | 'LOBBER' | 'RIFLEMAN' | 'WINDMASTER' | 'WINDLESS_WIT' | 'LOB_SHOOT' | 'TWANGER';

export type WeaponId =
  | 'BABY_MISSILE'
  | 'MISSILE'
  | 'MIRV'
  | 'NUKE'
  | 'DIRT_BALL'
  | 'HAND_GRENADE';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  price: number;
  bundleSize: number;
  explosionRadius: number;
  maxDamage: number;
  isDirt?: boolean;
  splitCount?: number;
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
