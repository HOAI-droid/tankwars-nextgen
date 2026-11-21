import './style.css';
import {
  computeBotShot,
  ExplosionEvent,
  GameSimulation,
  ShopItemId,
  Tank,
  WEAPONS,
  WeaponId,
} from '@tankwars/shared';
import { SoundEngine } from './audio.js';
import { StartMenu } from './menu.js';
import { NetworkClient } from './network.js';
import { DioramaRenderer } from './renderers/DioramaRenderer.js';
import { RetroRenderer } from './renderers/RetroRenderer.js';
import { ShopOverlay } from './shop.js';

const dioramaCanvas = document.getElementById('diorama-canvas') as HTMLCanvasElement;
const retroCanvas = document.getElementById('retro-canvas') as HTMLCanvasElement;
const crtOverlay = document.getElementById('crt-overlay') as HTMLDivElement;

const turnInfo = document.getElementById('turn-info')!;
const windInfo = document.getElementById('wind-info')!;
const btnMode = document.getElementById('btn-mode') as HTMLButtonElement;
const btnRetro = document.getElementById('btn-retro') as HTMLButtonElement;

const inputAngle = document.getElementById('input-angle') as HTMLInputElement;
const inputPower = document.getElementById('input-power') as HTMLInputElement;
const valAngle = document.getElementById('val-angle')!;
const valPower = document.getElementById('val-power')!;
const selectWeapon = document.getElementById('select-weapon') as HTMLSelectElement;
const btnFire = document.getElementById('btn-fire') as HTMLButtonElement;

const sim = new GameSimulation('SIMULTANEOUS');
const diorama = new DioramaRenderer(dioramaCanvas);
const retro = new RetroRenderer(retroCanvas);
const audio = new SoundEngine();

let isRetro = false;
let isOnline = false;
let net: NetworkClient | null = null;
let myTankId = 'p1';
let botCooldown = 0;
let shopOpenedForRound = 0;

const shop = new ShopOverlay(
  (itemId: ShopItemId) => {
    if (isOnline && net) {
      net.buyItem(itemId);
    } else if (sim.buyItem(myTankId, itemId)) {
      const me = sim.tanks.find((t) => t.id === myTankId);
      if (me) {
        shop.show(me, true);
        syncWeaponDropdown();
      }
    }
  },
  () => {
    if (isOnline && net) {
      net.nextRound();
    } else {
      sim.startNextRound();
      syncWeaponDropdown();
    }
  }
);

new StartMenu({
  onStartSolo: (playerName, mode) => {
    isOnline = false;
    myTankId = 'p1';
    sim.mode = mode;
    btnMode.textContent = mode === 'SIMULTANEOUS' ? 'Modus: Simultan' : 'Modus: Klassisch';
    btnMode.disabled = false;
    startSoloMatch(playerName);
  },
  onOnlineReady: (networkClient, socketId) => {
    isOnline = true;
    net = networkClient;
    myTankId = socketId;
    btnMode.disabled = true;

    net.socket.on('game:state', (snap) => {
      sim.mode = snap.mode;
      sim.phase = snap.phase;
      sim.round = snap.round;
      sim.wind = snap.wind;
      sim.activeTankIndex = snap.activeTankIndex;
      sim.tanks = snap.tanks;
      sim.projectiles = snap.projectiles;

      if (snap.terrain) {
        sim.terrain.heights.set(snap.terrain);
        sim.terrain.markAllDirty();
      }

      if (snap.explosions?.length) {
        triggerExplosions(snap.explosions);
      }

      btnMode.textContent = sim.mode === 'SIMULTANEOUS' ? 'Online: Simultan' : 'Online: Klassisch';
      syncWeaponDropdown();

      if (sim.phase === 'GAME_OVER') {
        maybeOpenShop();
      } else {
        shop.hide();
      }
    });
  },
});

function startSoloMatch(playerName = 'Du'): void {
  shopOpenedForRound = 0;
  sim.setupMatch([
    { id: 'p1', name: playerName, color: '#3b82f6', isBot: false },
    { id: 'b1', name: 'Mr. Stupid', color: '#ef4444', isBot: true, botType: 'MR_STUPID' },
    { id: 'b2', name: 'Lobber', color: '#eab308', isBot: true, botType: 'LOBBER' },
    { id: 'b3', name: 'Rifleman', color: '#a855f7', isBot: true, botType: 'RIFLEMAN' },
    { id: 'b4', name: 'Windmaster', color: '#10b981', isBot: true, botType: 'WINDMASTER' },
  ]);
  syncWeaponDropdown();
}

function getMyTank(): Tank | undefined {
  return sim.tanks.find((t) => t.id === myTankId);
}

function syncWeaponDropdown(): void {
  const me = getMyTank();
  if (!me) return;
  const prev = selectWeapon.value;
  selectWeapon.innerHTML = '';
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const count = me.inventory[id];
    if (count <= 0) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${WEAPONS[id].name} (${count === Infinity ? '∞' : count})`;
    selectWeapon.appendChild(opt);
  }
  if (prev && Array.from(selectWeapon.options).some((o) => o.value === prev)) {
    selectWeapon.value = prev;
  }
}

function triggerExplosions(events: ExplosionEvent[]): void {
  for (const ev of events) {
    diorama.spawnExplosion(ev);
    retro.spawnExplosion(ev);
    audio.playExplosion(ev.radius);
  }
}

function maybeOpenShop(): void {
  if (shopOpenedForRound === sim.round) {
    const me = getMyTank();
    if (me) shop.show(me, !isOnline || !!net?.isHost);
    return;
  }
  shopOpenedForRound = sim.round;
  setTimeout(() => {
    const me = getMyTank();
    if (me && sim.phase === 'GAME_OVER') {
      shop.show(me, !isOnline || !!net?.isHost);
    }
  }, 1800);
}

btnRetro.addEventListener('click', () => {
  isRetro = !isRetro;
  audio.retroMode = isRetro;
  dioramaCanvas.classList.toggle('hidden', isRetro);
  retroCanvas.classList.toggle('hidden', !isRetro);
  crtOverlay.classList.toggle('hidden', !isRetro);
  btnRetro.classList.toggle('active', isRetro);
  btnRetro.textContent = isRetro ? '✨ Next-Gen 3D' : '📺 90s Modus';
});

btnMode.addEventListener('click', () => {
  if (isOnline) return;
  sim.mode = sim.mode === 'SIMULTANEOUS' ? 'CLASSIC' : 'SIMULTANEOUS';
  btnMode.textContent = sim.mode === 'SIMULTANEOUS' ? 'Modus: Simultan' : 'Modus: Klassisch';
  startSoloMatch(getMyTank()?.name || 'Du');
});

inputAngle.addEventListener('input', () => {
  const me = getMyTank();
  if (me) me.angle = Number(inputAngle.value);
  valAngle.textContent = `${inputAngle.value}°`;
});

inputPower.addEventListener('input', () => {
  const me = getMyTank();
  if (me) me.power = Number(inputPower.value);
  valPower.textContent = `${inputPower.value}%`;
});

btnFire.addEventListener('click', () => {
  const me = getMyTank();
  if (!me || !me.alive || sim.phase !== 'PLANNING') return;

  const cmd = {
    angle: Number(inputAngle.value),
    power: Number(inputPower.value),
    weaponId: selectWeapon.value as WeaponId,
  };

  if (isOnline && net) {
    net.sendShot(cmd);
    audio.playShoot();
  } else if (sim.submitShot({ ...cmd, tankId: me.id })) {
    audio.playShoot();
    syncWeaponDropdown();
  }
});

window.addEventListener('resize', () => diorama.resize());

sim.setupMatch([
  { id: 'demo1', name: 'Demo 1', color: '#3b82f6', isBot: true },
  { id: 'demo2', name: 'Demo 2', color: '#ef4444', isBot: true },
]);

let lastTime = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (!isOnline) {
    if (sim.mode === 'CLASSIC' && sim.phase === 'PLANNING') {
      const active = sim.tanks[sim.activeTankIndex];
      if (active?.isBot) {
        botCooldown += dt;
        if (botCooldown > 0.7) {
          botCooldown = 0;
          sim.submitShot(computeBotShot(active, sim.tanks, sim.wind));
          audio.playShoot();
        }
      }
    }

    sim.step(dt);
    if (sim.recentExplosions.length > 0) {
      triggerExplosions(sim.recentExplosions);
    }
    if (sim.phase === 'GAME_OVER') {
      maybeOpenShop();
    }
  }

  const windArrow = sim.wind > 2 ? '→' : sim.wind < -2 ? '←' : '•';
  windInfo.textContent = `Wind: ${windArrow} ${Math.abs(sim.wind)}`;

  const me = getMyTank();
  if (sim.phase === 'GAME_OVER') {
    const winner = sim.tanks.find((t) => t.alive);
    turnInfo.textContent = winner ? `🏆 Runde ${sim.round}: ${winner.name}` : `Runde ${sim.round}: Unentschieden!`;
    btnFire.disabled = true;
  } else {
    const active = sim.tanks[sim.activeTankIndex];
    turnInfo.textContent =
      sim.mode === 'SIMULTANEOUS'
        ? sim.phase === 'PLANNING'
          ? me?.ready
            ? '✅ Bereit – warte auf andere…'
            : `Runde ${sim.round} · Ziel setzen!`
          : '🚀 Raketen in der Luft!'
        : `Runde ${sim.round} · Am Zug: ${active?.name ?? ''}`;

    btnFire.disabled =
      !me?.alive ||
      sim.phase !== 'PLANNING' ||
      (sim.mode === 'SIMULTANEOUS' && !!me?.ready) ||
      (sim.mode === 'CLASSIC' && active?.id !== myTankId);
  }

  if (isRetro) {
    retro.render(sim, dt);
  } else {
    diorama.render(sim, dt);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
