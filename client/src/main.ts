import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/black-ops-one/400.css';
import './style.css';
import {
  BotDifficulty,
  computeBotShot,
  ExplosionEvent,
  GameMode,
  GameSimulation,
  ShopItemId,
  Tank,
  WEAPONS,
  WeaponId,
} from '@tankwars/shared';
import { SoundEngine } from './audio.js';
import { StartMenu } from './menu.js';
import { ClientSession, HostSession, LobbyPlayer, PLAYER_COLORS, Session } from './network.js';
import { DioramaRenderer } from './renderers/DioramaRenderer.js';
import { RetroRenderer } from './renderers/RetroRenderer.js';
import { ShopOverlay } from './shop.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dioramaCanvas = $<HTMLCanvasElement>('diorama-canvas');
const retroCanvas = $<HTMLCanvasElement>('retro-canvas');
const crtOverlay = $('crt-overlay');
const deck = $('deck');
const hudTop = $('hud-top');
const rosterEl = $('roster');
const plateLayer = $('nameplates');
const floaterLayer = $('floaters');
const bannerEl = $('banner');
const roundLabel = $('round-label');
const windVal = $('wind-val');
const windL = $('wind-left');
const windR = $('wind-right');
const turnInfo = $('turn-info');
const btnMode = $<HTMLButtonElement>('btn-mode');
const btnRetro = $<HTMLButtonElement>('btn-retro');
const btnSound = $<HTMLButtonElement>('btn-sound');
const btnFull = $<HTMLButtonElement>('btn-full');
const btnMenu = $<HTMLButtonElement>('btn-menu');
const inputAngle = $<HTMLInputElement>('input-angle');
const inputPower = $<HTMLInputElement>('input-power');
const valAngle = $('val-angle');
const valPower = $('val-power');
const needle = $('dial-needle');
const meterFill = $('meter-fill');
const weaponsEl = $('weapons');
const btnFire = $<HTMLButtonElement>('btn-fire');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const sim = new GameSimulation('SIMULTANEOUS');
const diorama = new DioramaRenderer(dioramaCanvas);
const retro = new RetroRenderer(retroCanvas);
const audio = new SoundEngine();

type Role = 'demo' | 'solo' | 'host' | 'client';
let role: Role = 'demo';
let session: Session | null = null;
let myTankId = 'p1';
let isRetro = false;
let chosenWeapon: WeaponId = 'BABY_MISSILE';
let botCooldown = 0;
let demoRestart = 0;

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function getMyTank(): Tank | undefined {
  return sim.tanks.find((t) => t.id === myTankId);
}

function toast(msg: string): void {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function showBanner(text: string, sub = ''): void {
  bannerEl.innerHTML = `<div>${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');
}

function setInMenu(inMenu: boolean): void {
  deck.classList.toggle('away', inMenu);
  hudTop.style.opacity = inMenu ? '0' : '1';
  hudTop.style.pointerEvents = 'none';
  plateLayer.style.display = inMenu ? 'none' : '';
  floaterLayer.style.display = inMenu ? 'none' : '';
}

function startDemo(): void {
  role = 'demo';
  sim.mode = 'SIMULTANEOUS';
  sim.setupMatch([
    { id: 'd1', name: 'Alpha', color: PLAYER_COLORS[0], isBot: true, botType: 'RIFLEMAN' },
    { id: 'd2', name: 'Bravo', color: PLAYER_COLORS[1], isBot: true, botType: 'WINDMASTER' },
    { id: 'd3', name: 'Charlie', color: PLAYER_COLORS[2], isBot: true, botType: 'LOBBER' },
    { id: 'd4', name: 'Delta', color: PLAYER_COLORS[3], isBot: true, botType: 'MR_STUPID' },
  ]);
  demoRestart = 0;
  setInMenu(true);
}

const BOT_NAMES: Array<[string, BotDifficulty]> = [
  ['Mr. Stupid', 'MR_STUPID'],
  ['Lobber', 'LOBBER'],
  ['Rifleman', 'RIFLEMAN'],
  ['Windmaster', 'WINDMASTER'],
  ['Windless Wit', 'WINDLESS_WIT'],
  ['Lob & Shoot', 'LOB_SHOOT'],
  ['Twanger', 'TWANGER'],
];

function fillWithBots(
  humans: LobbyPlayer[],
  total: number
): Array<{ id: string; name: string; color: string; isBot: boolean; botType?: BotDifficulty }> {
  const list: Array<{ id: string; name: string; color: string; isBot: boolean; botType?: BotDifficulty }> =
    humans.map((p) => ({ id: p.id, name: p.name, color: p.color, isBot: false }));
  let i = 0;
  while (list.length < Math.max(total, 2)) {
    const [name, botType] = BOT_NAMES[i % BOT_NAMES.length];
    list.push({
      id: `bot_${i}`,
      name: i >= BOT_NAMES.length ? `${name} ${Math.floor(i / BOT_NAMES.length) + 1}` : name,
      color: PLAYER_COLORS[list.length % PLAYER_COLORS.length],
      isBot: true,
      botType,
    });
    i++;
  }
  return list;
}

function resetAimFromTank(): void {
  const me = getMyTank();
  if (!me) return;
  inputAngle.value = String(Math.round(me.angle));
  inputPower.value = String(Math.round(me.power));
  chosenWeapon = me.inventory[me.selectedWeapon] > 0 ? me.selectedWeapon : 'BABY_MISSILE';
  syncAimUi();
}

/* ------------------------------------------------------------------ */
/* Menü & Spielstart                                                   */
/* ------------------------------------------------------------------ */

const shop = new ShopOverlay(
  (itemId: ShopItemId) => {
    if (role === 'client') {
      (session as ClientSession).buyItem(itemId);
    } else if (sim.buyItem(myTankId, itemId)) {
      netDirty = true;
      const me = getMyTank();
      if (me) shop.refresh(me);
    }
  },
  () => {
    if (role === 'client') return;
    shop.hide();
    sim.startNextRound();
    netDirty = true;
    netTerrain = true;
    afterNewRound();
  }
);

function leaveToMenu(): void {
  session?.close();
  session = null;
  shop.hide();
  btnMode.classList.add('hidden');
  startDemo();
}

const menu = new StartMenu({
  onSolo: (name, mode) => {
    role = 'solo';
    myTankId = 'p1';
    sim.mode = mode;
    sim.setupMatch(
      fillWithBots([{ id: 'p1', name, color: PLAYER_COLORS[0] }], 5).map((p) => p)
    );
    btnMode.classList.remove('hidden');
    updateModeButton();
    setInMenu(false);
    afterNewRound(true);
  },

  onCreate: async (name, mode) => {
    const host = new HostSession(name, mode, {
      onPlayers: (p) => menu.setPlayers(p),
      onShoot: (pid, cmd) => {
        if (sim.submitShot({ ...cmd, tankId: pid })) netDirty = true;
      },
      onBuy: (pid, itemId) => {
        if (sim.buyItem(pid, itemId)) netDirty = true;
      },
      onLeave: (pid) => {
        const t = sim.tanks.find((x) => x.id === pid);
        if (t && host.started) {
          t.isBot = true;
          t.botType = 'RIFLEMAN';
          t.name += ' (Bot)';
          netDirty = true;
        }
      },
    });
    await host.open();
    session = host;
    return host;
  },

  onJoin: async (code, name) => {
    let first = true;
    const client = new ClientSession({
      onPlayers: (p) => menu.setPlayers(p),
      onState: (snap) => {
        applySnapshot(snap);
        if (first) {
          first = false;
          role = 'client';
          myTankId = client.myId;
          menu.hide();
          setInMenu(false);
          btnMode.classList.add('hidden');
          resetAimFromTank();
          afterNewRound(true);
        }
      },
      onClosed: () => {
        if (role === 'client' || !first) {
          toast('Verbindung zum Host verloren');
          menu.showMain();
          leaveToMenu();
        }
      },
    });
    await client.join(code, name);
    session = client;
    return client;
  },

  onHostStart: (total) => {
    const host = session as HostSession;
    host.started = true;
    role = 'host';
    myTankId = host.myId;
    sim.mode = host.mode;
    sim.setupMatch(fillWithBots(host.players, total));
    btnMode.classList.add('hidden');
    setInMenu(false);
    netDirty = true;
    netTerrain = true;
    afterNewRound(true);
  },

  onLeave: () => leaveToMenu(),
});

btnMenu.addEventListener('click', () => {
  if (menu.visible) return;
  leaveToMenu();
  menu.showMain();
});

/* ------------------------------------------------------------------ */
/* Netzwerk (Host sendet Snapshots, Client wendet sie an)              */
/* ------------------------------------------------------------------ */

let netDirty = false;
let netTerrain = false;
let netAcc = 0;
let pendingExplosions: ExplosionEvent[] = [];

function hostBroadcast(dt: number): void {
  const host = session as HostSession;
  if (!host || host.peerCount === 0) {
    pendingExplosions = [];
    netDirty = false;
    netTerrain = false;
    return;
  }
  netAcc += dt;
  const interval = sim.phase === 'RESOLVING' ? 0.05 : 0.5;
  if (!netDirty && netAcc < interval && pendingExplosions.length === 0) return;
  netAcc = 0;
  const withTerrain = netTerrain || pendingExplosions.length > 0 || sim.phase === 'RESOLVING';
  const snap = sim.getSnapshot(withTerrain);
  snap.explosions = pendingExplosions;
  // Infinity/undefined sind nicht übertragbar -> bereinigte Kopie senden
  const wire = JSON.parse(
    JSON.stringify(snap, (_k, v) => (v === Infinity ? 9999 : v))
  );
  host.broadcastState(wire);
  pendingExplosions = [];
  netDirty = false;
  netTerrain = false;
}

let lastSnapRound = -1;
function applySnapshot(snap: ReturnType<GameSimulation['getSnapshot']>): void {
  const mine = getMyTank();
  const keep = mine ? { angle: mine.angle, power: mine.power, w: mine.selectedWeapon } : null;

  sim.mode = snap.mode;
  sim.phase = snap.phase;
  sim.round = snap.round;
  sim.wind = snap.wind;
  sim.activeTankIndex = snap.activeTankIndex;
  sim.tanks = snap.tanks;
  sim.projectiles = snap.projectiles;
  for (const t of sim.tanks) t.inventory.BABY_MISSILE = Infinity; // JSON kennt kein Infinity

  if (snap.theme) sim.terrain.theme = snap.theme;
  if (snap.terrain) {
    const H = sim.terrain.heights;
    const full = snap.round !== lastSnapRound;
    for (let i = 0; i < snap.terrain.length; i++) {
      if (full || Math.abs(H[i] - snap.terrain[i]) > 0.01) {
        H[i] = snap.terrain[i];
        sim.terrain.dirtyChunks.add(Math.floor(i / 50));
      }
    }
  }
  if (snap.explosions?.length) triggerExplosions(snap.explosions);

  const me = getMyTank();
  if (me) {
    if (snap.round !== lastSnapRound) {
      lastSnapRound = snap.round;
      resetAimFromTank();
    } else if (keep && !me.ready && sim.phase === 'PLANNING') {
      me.angle = keep.angle;
      me.power = keep.power;
      me.selectedWeapon = keep.w;
    }
    if (shop.isOpen) shop.refresh(me);
  }
}

/* ------------------------------------------------------------------ */
/* Eingabe / Steuerpult                                                */
/* ------------------------------------------------------------------ */

function syncAimUi(): void {
  const a = Number(inputAngle.value);
  const p = Number(inputPower.value);
  valAngle.textContent = `${a}°`;
  valPower.textContent = String(p);
  $('tv-angle').textContent = `${a}°`;
  $('tv-power').textContent = String(p);
  needle.style.transform = `rotate(${-a}deg)`;
  meterFill.style.height = `${p}%`;
  const me = getMyTank();
  if (me && me.alive && !me.ready) {
    me.angle = a;
    me.power = p;
    me.selectedWeapon = chosenWeapon;
  }
}

function adjust(target: 'angle' | 'power', delta: number): void {
  const el = target === 'angle' ? inputAngle : inputPower;
  el.value = String(Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + delta)));
  syncAimUi();
}

inputAngle.addEventListener('input', syncAimUi);
inputPower.addEventListener('input', syncAimUi);

document.querySelectorAll<HTMLButtonElement>('.step').forEach((b) => {
  let timer: number | undefined;
  const t = b.dataset.t as 'angle' | 'power';
  const d = Number(b.dataset.d);
  const stop = () => {
    window.clearInterval(timer);
    timer = undefined;
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    adjust(t, d);
    stop();
    timer = window.setInterval(() => adjust(t, d), 90);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
});

let weaponSig = '';
function renderWeapons(): void {
  const me = getMyTank();
  if (!me) return;
  const ids = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => me.inventory[id] > 0);
  if (!ids.includes(chosenWeapon)) chosenWeapon = 'BABY_MISSILE';
  const sig = ids.map((id) => `${id}:${me.inventory[id]}`).join('|') + chosenWeapon;
  if (sig === weaponSig) return;
  weaponSig = sig;
  weaponsEl.innerHTML = ids
    .map((id) => {
      const n = me.inventory[id];
      return `<button class="wcard ${id === chosenWeapon ? 'sel' : ''}" data-w="${id}">
        <i style="background:${WEAPONS[id].color};color:${WEAPONS[id].color}"></i>
        <b>${esc(WEAPONS[id].name.replace(/ \(.*\)/, ''))}</b><em>${n === Infinity ? '∞' : '×' + n}</em></button>`;
    })
    .join('');
  weaponsEl.querySelectorAll<HTMLButtonElement>('.wcard').forEach((c) =>
    c.addEventListener('click', () => {
      if (window.matchMedia('(pointer: coarse)').matches && c.classList.contains('sel')) {
        cycleWeapon(1);
        return;
      }
      chosenWeapon = c.dataset.w as WeaponId;
      weaponSig = '';
      syncAimUi();
    })
  );
}

function cycleWeapon(dir: number): void {
  const me = getMyTank();
  if (!me) return;
  const ids = (Object.keys(WEAPONS) as WeaponId[]).filter((id) => me.inventory[id] > 0);
  const i = ids.indexOf(chosenWeapon);
  chosenWeapon = ids[(i + dir + ids.length) % ids.length];
  weaponSig = '';
  syncAimUi();
}

function fire(): void {
  const me = getMyTank();
  if (!me || !me.alive || sim.phase !== 'PLANNING' || btnFire.disabled) return;
  const cmd = { angle: Number(inputAngle.value), power: Number(inputPower.value), weaponId: chosenWeapon };

  if (role === 'client') {
    (session as ClientSession).sendShot(cmd);
    audio.playShoot();
    diorama.kick(me.id);
  } else if (sim.submitShot({ ...cmd, tankId: me.id })) {
    netDirty = true;
    audio.playShoot();
    diorama.kick(me.id);
  }
}

btnFire.addEventListener('click', fire);

/* Direkt zielen: auf dem Spielfeld ziehen wie bei einer Steinschleuder
   (vom Panzer weg ziehen = Richtung + Kraft). Ideal fürs Handy. */
const viewportEl = $('viewport');
const dragLine = document.createElement('div');
dragLine.id = 'drag-line';
dragLine.innerHTML = '<i></i>';
document.body.appendChild(dragLine);
let dragging = false;

function canAim(): boolean {
  const me = getMyTank();
  if (!me || !me.alive || sim.phase !== 'PLANNING' || role === 'demo' || menu.visible || shop.isOpen) return false;
  if (sim.mode === 'SIMULTANEOUS') return !me.ready;
  return sim.tanks[sim.activeTankIndex]?.id === myTankId;
}

function applyDrag(e: PointerEvent): void {
  const me = getMyTank();
  if (!me) return;
  const sp = diorama.project(me.x, me.y + 30);
  const dx = sp.x - e.clientX;
  const dy = e.clientY - sp.y;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg < 0) deg = dx >= 0 ? 0 : 180;
  const d = Math.hypot(dx, dy);
  const ref = Math.min(window.innerWidth, window.innerHeight) * 0.42;
  const power = Math.max(10, Math.min(100, 10 + (d / ref) * 90));
  inputAngle.value = String(Math.round(Math.max(0, Math.min(180, deg))));
  inputPower.value = String(Math.round(power));
  syncAimUi();
  const len = Math.hypot(e.clientX - sp.x, e.clientY - sp.y);
  const ang = Math.atan2(e.clientY - sp.y, e.clientX - sp.x);
  dragLine.style.cssText = `display:block;left:${sp.x}px;top:${sp.y}px;width:${len}px;transform:rotate(${ang}rad)`;
}

viewportEl.addEventListener('pointerdown', (e) => {
  if (!canAim()) return;
  dragging = true;
  viewportEl.setPointerCapture(e.pointerId);
  applyDrag(e);
});
viewportEl.addEventListener('pointermove', (e) => {
  if (dragging) applyDrag(e);
});
const endDrag = () => {
  dragging = false;
  dragLine.style.display = 'none';
};
viewportEl.addEventListener('pointerup', endDrag);
viewportEl.addEventListener('pointercancel', endDrag);

window.addEventListener('keydown', (e) => {
  if (menu.visible || shop.isOpen) return;
  const el = e.target as HTMLElement;
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text') return;
  const big = e.shiftKey ? 5 : 1;
  switch (e.key) {
    case 'ArrowLeft': adjust('angle', big); break;
    case 'ArrowRight': adjust('angle', -big); break;
    case 'ArrowUp': adjust('power', big); break;
    case 'ArrowDown': adjust('power', -big); break;
    case 'q': case 'Q': cycleWeapon(-1); break;
    case 'e': case 'E': cycleWeapon(1); break;
    case ' ': case 'Enter': fire(); break;
    default: return;
  }
  e.preventDefault();
});

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => {
  diorama.resize();
  retro.resize();
});

function updateModeButton(): void {
  btnMode.textContent = sim.mode === 'SIMULTANEOUS' ? 'SIMULTAN' : 'REIHUM';
}
btnMode.addEventListener('click', () => {
  if (role !== 'solo') return;
  sim.mode = sim.mode === 'SIMULTANEOUS' ? 'CLASSIC' : 'SIMULTANEOUS';
  const me = getMyTank();
  sim.setupMatch(fillWithBots([{ id: 'p1', name: me?.name || 'Du', color: PLAYER_COLORS[0] }], 5));
  updateModeButton();
  afterNewRound(true);
});

btnRetro.addEventListener('click', () => {
  isRetro = !isRetro;
  audio.retroMode = isRetro;
  dioramaCanvas.classList.toggle('hidden', isRetro);
  retroCanvas.classList.toggle('hidden', !isRetro);
  crtOverlay.classList.toggle('hidden', !isRetro);
  btnRetro.classList.toggle('active', isRetro);
  document.body.classList.toggle('vga', isRetro);
  plateLayer.style.visibility = isRetro ? 'hidden' : '';
});
btnSound.addEventListener('click', () => {
  audio.muted = !audio.muted;
  btnSound.classList.toggle('off', audio.muted);
});
if (!document.documentElement.requestFullscreen) btnFull.classList.add('hidden');
btnFull.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
});

/* ------------------------------------------------------------------ */
/* Effekte & UI-Updates                                                */
/* ------------------------------------------------------------------ */

function triggerExplosions(events: ExplosionEvent[]): void {
  for (const ev of events) {
    diorama.spawnExplosion(ev);
    retro.spawnExplosion(ev);
    audio.playExplosion(ev.radius);
  }
}

function afterNewRound(newMatch = false): void {
  prevHp.clear();
  weaponSig = '';
  lastPhase = sim.phase;
  shopTimer = undefined;
  if (role !== 'client') resetAimFromTank();
  showBanner(`RUNDE ${sim.round}`, newMatch && role !== 'demo' ? 'GEFECHT BEGINNT' : 'FEUER FREI');
}

const prevHp = new Map<string, number>();
const plates = new Map<string, HTMLDivElement>();
let rosterSig = '';
let lastPhase = sim.phase;
let shopTimer: number | undefined;

function spawnFloater(text: string, x: number, y: number, heal = false): void {
  const el = document.createElement('div');
  el.className = 'floater' + (heal ? ' heal' : '');
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  floaterLayer.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function updateWorldUi(): void {
  // Schaden-Zahlen
  for (const t of sim.tanks) {
    const prev = prevHp.get(t.id);
    if (prev !== undefined && t.hp < prev - 0.5 && !isRetro) {
      const p = diorama.project(t.x, t.y + 108);
      spawnFloater(`-${Math.round(prev - t.hp)}`, p.x, p.y);
    }
    prevHp.set(t.id, t.hp);
  }

  // Namensschilder
  const seen = new Set<string>();
  for (const t of sim.tanks) {
    seen.add(t.id);
    let el = plates.get(t.id);
    if (!el) {
      el = document.createElement('div');
      el.innerHTML = `<span class="pn"></span><span class="pb"><i></i></span>`;
      plateLayer.appendChild(el);
      plates.set(t.id, el);
    }
    el.className = `plate${t.id === myTankId ? ' me' : ''}${t.ready ? ' ready' : ''}`;
    el.style.display = t.alive ? '' : 'none';
    if (!t.alive || isRetro) continue;
    const p = diorama.project(t.x, t.y + 90);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    const nm = el.firstElementChild as HTMLElement;
    if (nm.textContent !== t.name) nm.textContent = t.name;
    const bar = el.querySelector('i') as HTMLElement;
    const frac = Math.max(0, Math.min(1, t.hp / t.maxHp));
    bar.style.width = `${frac * 100}%`;
    bar.style.background = frac > 0.5 ? '#38d996' : frac > 0.25 ? '#ffc457' : '#ff4d5e';
  }
  for (const [id, el] of plates) {
    if (!seen.has(id)) {
      el.remove();
      plates.delete(id);
    }
  }

  // Rangliste
  const active = sim.tanks[sim.activeTankIndex];
  const sig = sim.tanks
    .map((t) => `${t.id}:${Math.round(t.hp)}:${t.alive ? 1 : 0}:${t.score}:${sim.mode === 'CLASSIC' && active?.id === t.id ? 1 : 0}`)
    .join('|') + myTankId;
  if (sig !== rosterSig) {
    rosterSig = sig;
    rosterEl.innerHTML = sim.tanks
      .map((t) => {
        const frac = Math.max(0, Math.min(1, t.hp / t.maxHp)) * 100;
        const isActive = sim.mode === 'CLASSIC' && active?.id === t.id && t.alive;
        return `<div class="r-row${t.alive ? '' : ' dead'}${t.id === myTankId ? ' me' : ''}${isActive ? ' active' : ''}">
          <span class="bar" style="background:${t.color}"></span>
          <div><div class="nm">${esc(t.name)}</div><div class="hpbar"><i style="width:${frac}%;background:${t.color}"></i></div></div>
          <span class="sc">${t.score}</span></div>`;
      })
      .join('');
  }
}

function updateHud(): void {
  const me = getMyTank();
  const active = sim.tanks[sim.activeTankIndex];

  roundLabel.textContent = `RUNDE ${sim.round}`;
  const w = Math.round(sim.wind);
  windVal.textContent = `WIND ${Math.abs(w)}`;
  windL.classList.toggle('on', w < -2);
  windR.classList.toggle('on', w > 2);
  $('rebound-badge').classList.toggle('hidden', !sim.terrain.theme.rebound);

  let info = '';
  let disabled = true;
  if (sim.phase === 'GAME_OVER') {
    const winner = sim.tanks.find((t) => t.alive);
    info = winner ? `SIEGER: ${winner.name.toUpperCase()}` : 'UNENTSCHIEDEN';
  } else if (sim.mode === 'SIMULTANEOUS') {
    if (sim.phase === 'RESOLVING') info = 'GESCHOSSE UNTERWEGS';
    else if (!me?.alive) info = 'AUSGESCHIEDEN – ZUSCHAUEN';
    else if (me.ready) info = 'BEREIT – WARTE AUF ANDERE';
    else info = 'ZIEHEN ZUM ZIELEN';
    disabled = !me?.alive || sim.phase !== 'PLANNING' || !!me?.ready;
  } else {
    info = sim.phase === 'RESOLVING' ? 'GESCHOSS UNTERWEGS' : `AM ZUG: ${(active?.name ?? '').toUpperCase()}`;
    disabled = !me?.alive || sim.phase !== 'PLANNING' || active?.id !== myTankId;
  }
  if (role === 'demo') info = '';
  turnInfo.textContent = info;
  btnFire.disabled = disabled;
  deck.classList.toggle('locked', disabled);

  if (me) renderWeapons();
}

function uiTick(): void {
  if (role === 'demo') return;

  // Phasenwechsel erkennen (läuft für Solo, Host und Client gleich)
  if (sim.phase !== lastPhase) {
    if (sim.phase === 'GAME_OVER') {
      const winner = sim.tanks.find((t) => t.alive);
      showBanner(winner ? winner.name : 'UNENTSCHIEDEN', winner ? 'RUNDENSIEGER' : 'KEIN SIEGER');
      const round = sim.round;
      shopTimer = window.setTimeout(() => {
        const me = getMyTank();
        if (me && sim.phase === 'GAME_OVER' && sim.round === round) {
          shop.show(me, { round, canAdvance: role !== 'client', standings: sim.tanks });
        }
      }, 2300);
    } else if (lastPhase === 'GAME_OVER') {
      shop.hide();
      if (shopTimer) clearTimeout(shopTimer);
      if (role === 'client') {
        weaponSig = '';
        showBanner(`RUNDE ${sim.round}`, 'FEUER FREI');
      }
    }
    lastPhase = sim.phase;
  }
}

/* ------------------------------------------------------------------ */
/* Hauptschleife                                                       */
/* ------------------------------------------------------------------ */

const FIXED = 1 / 60;
let acc = 0;
let lastTime = performance.now();

function loop(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (role !== 'client') {
    // Bots im klassischen Modus (Solo, Host und Demo)
    if (sim.mode === 'CLASSIC' && sim.phase === 'PLANNING') {
      const active = sim.tanks[sim.activeTankIndex];
      if (active?.isBot && active.alive) {
        botCooldown += dt;
        if (botCooldown > 0.8) {
          botCooldown = 0;
          sim.submitShot(computeBotShot(active, sim.tanks, sim.wind, sim.terrain.theme.rebound));
          audio.playShoot();
          diorama.kick(active.id);
          netDirty = true;
        }
      }
    }

    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard++ < 6) {
      acc -= FIXED;
      const before = sim.phase;
      sim.step(FIXED);
      if (before === 'PLANNING' && sim.phase === 'RESOLVING') {
        audio.playShoot();
        for (const p of sim.projectiles) diorama.kick(p.ownerId);
        netDirty = true;
      }
      if (sim.recentExplosions.length > 0) {
        triggerExplosions(sim.recentExplosions);
        if (role === 'host') pendingExplosions.push(...sim.recentExplosions);
      }
      if (before !== sim.phase) {
        netDirty = true;
        netTerrain = true;
      }
    }

    if (role === 'host') hostBroadcast(dt);

    if (role === 'demo' && sim.phase === 'GAME_OVER') {
      demoRestart += dt;
      if (demoRestart > 2.5) {
        demoRestart = 0;
        sim.startNextRound();
      }
    }
  } else {
    // Client: Geschosse zwischen den Snapshots weiterbewegen (Extrapolation)
    for (const p of sim.projectiles) {
      p.vx += sim.wind * dt;
      p.vy -= 280 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  uiTick();
  updateHud();

  const me = getMyTank();
  const aim =
    role !== 'demo' && me && me.alive && sim.phase === 'PLANNING' && !me.ready
      ? { angle: Number(inputAngle.value), power: Number(inputPower.value) }
      : null;

  if (isRetro) {
    const hudT = sim.mode === 'CLASSIC' ? sim.tanks[sim.activeTankIndex] : me;
    retro.render(sim, dt, diorama.screenMap(), {
      name: hudT?.name ?? '',
      power: Number(inputPower.value),
      angle: Number(inputAngle.value),
      men: hudT ? Math.max(1, Math.round(hudT.hp / 100)) : 1,
      mine: !!hudT && hudT.id === myTankId,
      hp: hudT?.hp ?? 0,
      money: hudT?.money ?? 0,
      round: sim.round,
    });
  } else {
    diorama.render(sim, dt, { myId: myTankId, aim, cinematic: role === 'demo' });
  }
  if (role !== 'demo') updateWorldUi();

  requestAnimationFrame(loop);
}

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__tw = { sim, diorama, get role() { return role; }, get session() { return session; } };

startDemo();
syncAimUi();
requestAnimationFrame(loop);

/* Automatische Aktualisierung: veraltete Zwischenspeicher (z. B. Home-Bildschirm-App) neu laden */
async function checkForUpdate(): Promise<void> {
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { id } = (await r.json()) as { id: string };
    if (id && id !== __BUILD_ID__) location.reload();
  } catch {
    /* offline oder Dev-Server */
  }
}
if (!import.meta.env.DEV) {
  void checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void checkForUpdate();
  });
}
