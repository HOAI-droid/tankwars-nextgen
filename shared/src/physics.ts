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
