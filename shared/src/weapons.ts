import { WeaponDef, WeaponId } from './types.js';

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  BABY_MISSILE: {
    id: 'BABY_MISSILE',
    name: 'Standard-Schuss',
    price: 0,
    bundleSize: 99,
    explosionRadius: 24,
    maxDamage: 35,
    color: '#ffcc33',
  },
  MISSILE: {
    id: 'MISSILE',
    name: 'Schwere Rakete',
    price: 1500,
    bundleSize: 5,
    explosionRadius: 42,
    maxDamage: 55,
    color: '#ff6622',
  },
  MIRV: {
    id: 'MIRV',
    name: 'Streubombe (MIRV)',
    price: 4000,
    bundleSize: 2,
    explosionRadius: 26,
    maxDamage: 40,
    splitCount: 5,
    color: '#ff33aa',
  },
  NUKE: {
    id: 'NUKE',
    name: 'Atomrakete',
    price: 8500,
    bundleSize: 1,
    explosionRadius: 85,
    maxDamage: 95,
    color: '#66ff33',
  },
  DIRT_BALL: {
    id: 'DIRT_BALL',
    name: 'Erdbombe',
    price: 2000,
    bundleSize: 3,
    explosionRadius: 45,
    maxDamage: 0,
    isDirt: true,
    color: '#a87c4f',
  },
};

export const INITIAL_INVENTORY: Record<WeaponId, number> = {
  BABY_MISSILE: Infinity,
  MISSILE: 3,
  MIRV: 1,
  NUKE: 0,
  DIRT_BALL: 2,
};

export const DEFENSE_ITEMS = {
  SHIELD: { name: 'Energieschild (+50)', price: 2500, amount: 50 },
  PARACHUTE: { name: 'Fallschirm (+2)', price: 1000, amount: 2 },
} as const;

export type ShopItemId = WeaponId | keyof typeof DEFENSE_ITEMS;
