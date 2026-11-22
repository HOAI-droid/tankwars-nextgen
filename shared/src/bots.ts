import { ShotCommand, Tank } from './types.js';
import { MAX_POWER, MIN_POWER, POWER_TO_SPEED, WIND_ACCEL } from './physics.js';

const GRAVITY = 280;

export function computeBotShot(
  bot: Tank,
  allTanks: Tank[],
  wind: number,
  rebound = false
): ShotCommand {
  const targets = allTanks.filter((t) => t.alive && t.id !== bot.id);
  const target = targets[Math.floor(Math.random() * targets.length)];
  if (!target) {
    return { tankId: bot.id, angle: 90, power: 200, weaponId: 'BABY_MISSILE' };
  }

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const shootRight = dx >= 0;

  let angle = shootRight ? 45 : 135;
  let power = 200;

  switch (bot.botType) {
    case 'MR_STUPID':
      angle = 20 + Math.random() * 140;
      power = 250 + Math.random() * 700;
      break;

    case 'LOBBER':
      angle = shootRight ? 68 + Math.random() * 10 : 102 + Math.random() * 10;
      power = estimatePower(Math.abs(dx), dy, angle, 0) + (Math.random() - 0.5) * 140;
      break;

    case 'RIFLEMAN':
      angle = shootRight ? 30 + Math.random() * 12 : 138 + Math.random() * 12;
      power = estimatePower(Math.abs(dx), dy, angle, 0) + (Math.random() - 0.5) * 80;
      break;

    case 'WINDLESS_WIT': // Physik ohne Windkorrektur
      angle = shootRight ? 52 : 128;
      power = estimatePower(Math.abs(dx), dy, angle, 0) + (Math.random() - 0.5) * 30;
      break;

    case 'LOB_SHOOT':
      if (!rebound) {
        angle = shootRight ? 68 + Math.random() * 10 : 102 + Math.random() * 10;
        power = estimatePower(Math.abs(dx), dy, angle, 0) + (Math.random() - 0.5) * 140;
      } else {
        angle = shootRight ? 30 + Math.random() * 12 : 138 + Math.random() * 12;
        power = 950;
      }
      break;

    case 'TWANGER':
      if (rebound) {
        angle = 70 + Math.random() * 40;
        power = 800 + Math.random() * 200;
      } else {
        angle = shootRight ? 30 + Math.random() * 12 : 138 + Math.random() * 12;
        power = estimatePower(Math.abs(dx), dy, angle, 0) + (Math.random() - 0.5) * 80;
      }
      break;

    case 'WINDMASTER':
    default:
      angle = shootRight ? 52 : 128;
      power = estimatePower(Math.abs(dx), dy, angle, shootRight ? wind : -wind) + (Math.random() - 0.5) * 30;
      break;
  }

  return {
    tankId: bot.id,
    angle: Math.max(5, Math.min(175, Math.round(angle))),
    power: Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(power))),
    weaponId: pickWeapon(bot),
  };
}

function estimatePower(dist: number, dy: number, angleDeg: number, effectiveWind: number): number {
  const rad = (angleDeg > 90 ? 180 - angleDeg : angleDeg) * (Math.PI / 180);
  let bestPower = 50;
  let bestErr = Infinity;

  for (let p = MIN_POWER; p <= MAX_POWER; p += 5) {
    const speed = p * POWER_TO_SPEED;
    let vx = Math.cos(rad) * speed;
    let vy = Math.sin(rad) * speed;
    let x = 0;
    let y = 0;
    const dt = 0.05;

    for (let t = 0; t < 12; t += dt) {
      vx += effectiveWind * WIND_ACCEL * dt;
      vy -= GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      if (y <= dy && vy < 0) {
        const err = Math.abs(x - dist);
        if (err < bestErr) {
          bestErr = err;
          bestPower = p;
        }
        break;
      }
    }
  }
  return bestPower;
}


const BOT_WEAPONS = ['MISSILE', 'MARK_II', 'NUKE', 'NUKE_5M', 'MIRV', 'CRI_S', 'CRI_D', 'CRI_ND', 'GUIDED_H', 'GUIDED_V'] as const;

function pickWeapon(bot: Tank) {
  const owned = BOT_WEAPONS.filter((w) => (bot.inventory[w] ?? 0) > 0);
  if (owned.length && Math.random() < 0.55) return owned[Math.floor(Math.random() * owned.length)];
  return 'BABY_MISSILE' as const;
}
