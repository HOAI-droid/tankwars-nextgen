import { ShotCommand, Tank } from './types.js';

const GRAVITY = 280;

export function computeBotShot(
  bot: Tank,
  allTanks: Tank[],
  wind: number
): ShotCommand {
  const targets = allTanks.filter((t) => t.alive && t.id !== bot.id);
  const target = targets[Math.floor(Math.random() * targets.length)];
  if (!target) {
    return { tankId: bot.id, angle: 90, power: 50, weaponId: 'BABY_MISSILE' };
  }

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const shootRight = dx >= 0;

  let angle = shootRight ? 45 : 135;
  let power = 55;

  switch (bot.botType) {
    case 'MR_STUPID':
      angle = 20 + Math.random() * 140;
      power = 25 + Math.random() * 70;
      break;

    case 'LOBBER':
      angle = shootRight ? 68 + Math.random() * 10 : 102 + Math.random() * 10;
      power = estimatePower(Math.abs(dx), dy, angle, 0) + (Math.random() - 0.5) * 14;
      break;

    case 'RIFLEMAN':
      angle = shootRight ? 30 + Math.random() * 12 : 138 + Math.random() * 12;
      power = estimatePower(Math.abs(dx), dy, angle, 0) + (Math.random() - 0.5) * 8;
      break;

    case 'WINDMASTER':
    default:
      angle = shootRight ? 52 : 128;
      power = estimatePower(Math.abs(dx), dy, angle, shootRight ? wind : -wind) + (Math.random() - 0.5) * 3;
      break;
  }

  return {
    tankId: bot.id,
    angle: Math.max(5, Math.min(175, Math.round(angle))),
    power: Math.max(15, Math.min(100, Math.round(power))),
    weaponId: bot.inventory.MISSILE > 0 && Math.random() < 0.35 ? 'MISSILE' : 'BABY_MISSILE',
  };
}

function estimatePower(dist: number, dy: number, angleDeg: number, effectiveWind: number): number {
  const rad = (angleDeg > 90 ? 180 - angleDeg : angleDeg) * (Math.PI / 180);
  let bestPower = 50;
  let bestErr = Infinity;

  for (let p = 15; p <= 100; p += 2) {
    const speed = p * 6.2;
    let vx = Math.cos(rad) * speed;
    let vy = Math.sin(rad) * speed;
    let x = 0;
    let y = 0;
    const dt = 0.05;

    for (let t = 0; t < 12; t += dt) {
      vx += effectiveWind * dt;
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
