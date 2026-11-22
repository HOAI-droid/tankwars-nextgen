// Gemessen am Original (Tank Wars 2.5): Reichweite bei 45° = 0,004 * Kraft² Pixel (320 px = 1000 Welteinheiten)
export const POWER_TO_SPEED = 1.871;
// Wind-Beschleunigung = 0,0020 * Windstärke * g
export const WIND_ACCEL = 0.56;
export const DEFAULT_POWER = 200;
export const MAX_POWER = 1000;
export const MIN_POWER = 20;

export function rollWind(): number {
  const dir = Math.random() < 0.5 ? -1 : 1;
  // meist 0-100, selten Böen bis 800
  if (Math.random() < 0.07) return dir * Math.round(100 + Math.random() * 700);
  return dir * Math.round(Math.random() * 100);
}

/** Spieloptionen wie im Original-Menü ("Game Options"). */
export interface GameOptions {
  crumblePct: number; // 0-100: wie oft loses Erdreich nachrutscht
  rebound: 0 | 1 | 2; // 0 = Nein, 1 = Ja, 2 = Zufall (RND)
  trailVisible: boolean;
  ballVisible: boolean;
  tanksFall: boolean;
  explosionsKill: boolean;
  computerBuy: boolean;
  background: number; // -1 = Zufall, sonst 0-4
  windForce: 0 | 1 | 2 | 3; // None / Low / Norm / High
}

export const DEFAULT_OPTIONS: GameOptions = {
  crumblePct: 50,
  rebound: 2,
  trailVisible: true,
  ballVisible: true,
  tanksFall: true,
  explosionsKill: true,
  computerBuy: true,
  background: -1,
  windForce: 2,
};

export const WIND_SCALE = [0, 0.5, 1, 2];
