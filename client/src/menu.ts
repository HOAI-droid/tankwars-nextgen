import { BotDifficulty, DEFAULT_OPTIONS, GameMode, GameOptions } from '@tankwars/shared';
import { ClientSession, HostSession, LobbyPlayer, PLAYER_COLORS } from './network.js';

export type BotChoice = BotDifficulty | 'RANDOM';

export interface SlotSetup {
  human: boolean;
  name: string;
  bot: BotChoice;
}

export interface LocalSetup {
  slots: SlotSetup[];
  rounds: number;
  mode: GameMode;
  options: GameOptions;
}

export interface StartMenuCallbacks {
  onStart: (setup: LocalSetup) => void;
  onCreate: (playerName: string, mode: GameMode, rounds: number, options: GameOptions) => Promise<HostSession>;
  onJoin: (code: string, playerName: string) => Promise<ClientSession>;
  onHostStart: (totalPlayers: number) => void;
  onLeave: () => void;
  onSound: (effects: boolean) => void;
  onGfx: (retro: boolean) => void;
  isRetro: () => boolean;
}

export const BOT_LABELS: Array<[BotChoice, string]> = [
  ['RANDOM', 'Zufall'],
  ['MR_STUPID', 'Mr. Stupid'],
  ['LOBBER', 'Lobber'],
  ['RIFLEMAN', 'Rifleman'],
  ['LOB_SHOOT', 'Lob & Shoot'],
  ['WINDLESS_WIT', 'Windless Wit'],
  ['TWANGER', 'Twanger'],
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const GAMES = [1, 2, 3, 5, 10, 20, 30];
const BG_NAMES = ['Zufall', 'A', 'B', 'C', 'D', 'E'];
const WIND_NAMES = ['Keiner', 'Schwach', 'Normal', 'Stark'];
const REBOUND = ['Nein', 'Ja', 'Zufall'];

interface Stored {
  players: number;
  rounds: number;
  mode: GameMode;
  options: GameOptions;
  slots: SlotSetup[];
  effects: boolean;
  fly: boolean;
}

function loadStored(): Stored {
  const name = localStorage.getItem('tw_name') || 'Kommandant';
  const def: Stored = {
    players: 4,
    rounds: 5,
    mode: 'CLASSIC',
    options: { ...DEFAULT_OPTIONS },
    slots: Array.from({ length: 10 }, (_, i) => ({ human: i === 0, name: i === 0 ? name : `Spieler ${i + 1}`, bot: 'RANDOM' as BotChoice })),
    effects: true,
    fly: false,
  };
  try {
    const raw = localStorage.getItem('tw_setup3');
    if (raw) {
      const o = JSON.parse(raw) as Partial<Stored>;
      return { ...def, ...o, options: { ...def.options, ...(o.options ?? {}) }, slots: o.slots && o.slots.length >= 10 ? o.slots : def.slots };
    }
  } catch {
    /* ignorieren */
  }
  return def;
}

export class StartMenu {
  private el: HTMLDivElement;
  private listEl: HTMLElement | null = null;
  private st: Stored = loadStored();
  private screen: 'main' | 'sound' | 'options' | 'players' | 'lobby' = 'main';
  public visible = true;

  constructor(private cb: StartMenuCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'screen';
    document.body.appendChild(this.el);
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.cb.onSound(this.st.effects);
    this.renderMain();
  }

  public showMain(): void {
    this.visible = true;
    this.el.classList.remove('hidden', 'out');
    this.renderMain();
  }

  public hide(): void {
    this.visible = false;
    this.el.classList.add('out');
    setTimeout(() => {
      if (!this.visible) this.el.classList.add('hidden');
    }, 360);
  }

  /** Grafikmodus gewechselt: aktuellen Bildschirm neu zeichnen. */
  public refresh(): void {
    if (!this.visible) return;
    if (this.screen === 'main') this.renderMain();
    else if (this.screen === 'sound') this.renderSound();
    else if (this.screen === 'options') this.renderOptions();
    else if (this.screen === 'players') this.renderPlayers();
  }

  public setPlayers(players: LobbyPlayer[]): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = players
      .map((p, i) => `<div class="pitem"><i style="background:${p.color}"></i><span>${esc(p.name)}</span><small>${i === 0 ? 'HOST' : 'BEREIT'}</small></div>`)
      .join('');
  }

  private save(): void {
    localStorage.setItem('tw_setup3', JSON.stringify(this.st));
    localStorage.setItem('tw_name', this.st.slots[0].name);
  }

  private logo(): string {
    return `
      <div class="logo">
        <div class="pre">ARTILLERIE · KRIEG · CHAOS</div>
        <h1>TANK<em>WARS</em></h1>
        <p>Berechne Winkel, Kraft und Wind. Zerstöre das Gelände, kaufe Waffen, überlebe. Bis zu 10 Kommandanten – am selben Gerät oder online per Raum-Code.</p>
      </div>`;
  }

  /* ---------------- Tastatur: Pfeile wählen, Enter bestätigt ---------------- */
  private onKey(e: KeyboardEvent): void {
    if (!this.visible || this.screen === 'lobby') return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
    const rows = Array.from(this.el.querySelectorAll<HTMLElement>('[data-row]'));
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.classList.contains('focus'));
    if (e.key === 'ArrowDown') i = (i + 1) % rows.length;
    else if (e.key === 'ArrowUp') i = (i - 1 + rows.length) % rows.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      (i >= 0 ? rows[i] : null)?.querySelector<HTMLElement>(e.key === 'ArrowLeft' ? '[data-dir="-1"]' : '[data-dir="1"]')?.click();
      e.preventDefault();
      return;
    } else if (e.key === 'Enter') {
      if (i >= 0) {
        const r = rows[i];
        (r.matches('button') ? r : r.querySelector<HTMLElement>('[data-dir="1"]') ?? r).click();
      }
      e.preventDefault();
      return;
    } else if (e.key === 'Escape') {
      this.el.querySelector<HTMLElement>('[data-back]')?.click();
      return;
    } else return;
    rows.forEach((r) => r.classList.remove('focus'));
    rows[i].classList.add('focus');
    e.preventDefault();
  }

  /** Zeile mit ◀ Wert ▶ */
  private spin(id: string, label: string, value: string): string {
    return `<div class="mrow" data-row="${id}"><span class="ml">${label}</span><button class="arr" data-dir="-1" data-id="${id}">◀</button><span class="mv">${esc(value)}</span><button class="arr" data-dir="1" data-id="${id}">▶</button></div>`;
  }

  private bindSpin(handler: (id: string, dir: number) => void, rerender: () => void): void {
    this.el.querySelectorAll<HTMLButtonElement>('button.arr').forEach((b) =>
      b.addEventListener('click', () => {
        handler(b.dataset.id!, Number(b.dataset.dir));
        this.save();
        rerender();
      })
    );
    this.el.querySelectorAll<HTMLElement>('.mrow').forEach((r) =>
      r.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).classList.contains('arr')) return;
        r.querySelector<HTMLElement>('[data-dir="1"]')?.click();
      })
    );
  }

  /* ---------------- Hauptmenü ---------------- */
  private renderMain(): void {
    this.screen = 'main';
    this.listEl = null;
    const s = this.st;
    const retro = this.cb.isRetro();
    this.el.innerHTML = `
      <div class="menu-wrap">
        ${this.logo()}
        <div class="card">
          <h2>HAUPTMENÜ</h2>
          <button class="btn" data-row="sound" id="b-sound">Sound-Optionen</button>
          <button class="btn" data-row="options" id="b-options">Spiel-Optionen</button>
          ${this.spin('players', 'Spieler', String(s.players))}
          ${this.spin('games', 'Runden', String(s.rounds))}
          ${this.spin('gfx', 'Grafik', retro ? 'DOS (VGA)' : '3D')}
          <button class="btn primary" data-row="start" id="b-start">START</button>
          <div class="divider">ONLINE</div>
          <div class="row">
            <button class="btn blue" data-row="create" id="b-create">Raum erstellen</button>
            <input id="m-code" class="input code-input" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" />
            <button class="btn green" data-row="join" id="b-join">Beitreten</button>
          </div>
          <div id="m-error" class="err"></div>
          <div class="hint buildid">Build ${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'}</div>
        </div>
      </div>`;
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    this.bindSpin(
      (id, dir) => {
        if (id === 'players') s.players = Math.max(2, Math.min(10, s.players + dir));
        else if (id === 'games') {
          const i = GAMES.indexOf(s.rounds);
          s.rounds = GAMES[Math.max(0, Math.min(GAMES.length - 1, (i < 0 ? 3 : i) + dir))];
        } else if (id === 'gfx') this.cb.onGfx(!this.cb.isRetro());
      },
      () => this.renderMain()
    );
    q('#b-sound').addEventListener('click', () => this.renderSound());
    q('#b-options').addEventListener('click', () => this.renderOptions());
    q('#b-start').addEventListener('click', () => this.renderPlayers());

    const codeEl = q<HTMLInputElement>('#m-code');
    const errEl = q<HTMLDivElement>('#m-error');
    codeEl.addEventListener('input', () => (codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    const busy = (b: boolean, msg = '') => {
      ['#b-create', '#b-join', '#b-start'].forEach((id) => (q<HTMLButtonElement>(id).disabled = b));
      errEl.textContent = msg;
    };
    q('#b-create').addEventListener('click', async () => {
      busy(true, 'Raum wird erstellt…');
      try {
        const host = await this.cb.onCreate(s.slots[0].name || 'Kommandant', s.mode, s.rounds, s.options);
        this.renderLobby(host.code, true, host.players);
      } catch (e) {
        busy(false);
        errEl.textContent = (e as Error).message || String(e);
      }
    });
    q('#b-join').addEventListener('click', async () => {
      const code = codeEl.value.trim();
      if (code.length < 4) {
        errEl.textContent = 'Bitte den 4-stelligen Raum-Code eingeben.';
        return;
      }
      busy(true, 'Verbinde…');
      try {
        const client = await this.cb.onJoin(code, s.slots[0].name || 'Kommandant');
        this.renderLobby(client.code, false, client.players);
      } catch (e) {
        busy(false);
        errEl.textContent = (e as Error).message || String(e);
      }
    });
  }

  /* ---------------- Sound-Optionen ---------------- */
  private renderSound(): void {
    this.screen = 'sound';
    const s = this.st;
    this.el.innerHTML = `
      <div class="menu-wrap single"><div class="card">
        <h2>SOUND-OPTIONEN</h2>
        ${this.spin('effects', 'Soundeffekte', s.effects ? 'Ja' : 'Nein')}
        ${this.spin('fly', 'Fluggeräusch', s.fly ? 'Ja' : 'Nein')}
        <button class="btn ghost" data-row="back" data-back="1" id="b-back">Zurück</button>
      </div></div>`;
    this.bindSpin(
      (id) => {
        if (id === 'effects') {
          s.effects = !s.effects;
          this.cb.onSound(s.effects);
        } else s.fly = !s.fly;
      },
      () => this.renderSound()
    );
    this.el.querySelector('#b-back')!.addEventListener('click', () => this.renderMain());
  }

  /* ---------------- Spiel-Optionen ---------------- */
  private renderOptions(): void {
    this.screen = 'options';
    const o = this.st.options;
    const yn = (b: boolean) => (b ? 'Ja' : 'Nein');
    this.el.innerHTML = `
      <div class="menu-wrap single"><div class="card wide">
        <h2>SPIEL-OPTIONEN</h2>
        <div class="grid2">
          ${this.spin('crumble', 'Erdrutsch', `${o.crumblePct}%`)}
          ${this.spin('rebound', 'Abprallende Wände', REBOUND[o.rebound])}
          ${this.spin('trail', 'Flugspur sichtbar', yn(o.trailVisible))}
          ${this.spin('ball', 'Geschoss sichtbar', yn(o.ballVisible))}
          ${this.spin('fall', 'Panzer fallen', yn(o.tanksFall))}
          ${this.spin('kill', 'Trümmer töten', yn(o.explosionsKill))}
          ${this.spin('buy', 'Computer kaufen', yn(o.computerBuy))}
          ${this.spin('bg', 'Hintergrund', BG_NAMES[o.background + 1])}
          ${this.spin('wind', 'Windstärke', WIND_NAMES[o.windForce])}
          ${this.spin('mode', 'Spielmodus', this.st.mode === 'CLASSIC' ? 'Reihum' : 'Simultan')}
        </div>
        <button class="btn ghost" data-row="back" data-back="1" id="b-back">Zurück</button>
      </div></div>`;
    this.bindSpin(
      (id, dir) => {
        const wrap = (v: number, n: number) => (v + dir + n) % n;
        if (id === 'crumble') o.crumblePct = Math.max(0, Math.min(100, o.crumblePct + dir * 10));
        else if (id === 'rebound') o.rebound = wrap(o.rebound, 3) as 0 | 1 | 2;
        else if (id === 'trail') o.trailVisible = !o.trailVisible;
        else if (id === 'ball') o.ballVisible = !o.ballVisible;
        else if (id === 'fall') o.tanksFall = !o.tanksFall;
        else if (id === 'kill') o.explosionsKill = !o.explosionsKill;
        else if (id === 'buy') o.computerBuy = !o.computerBuy;
        else if (id === 'bg') o.background = wrap(o.background + 1, 6) - 1;
        else if (id === 'wind') o.windForce = wrap(o.windForce, 4) as 0 | 1 | 2 | 3;
        else if (id === 'mode') this.st.mode = this.st.mode === 'CLASSIC' ? 'SIMULTANEOUS' : 'CLASSIC';
      },
      () => this.renderOptions()
    );
    this.el.querySelector('#b-back')!.addEventListener('click', () => this.renderMain());
  }

  /* ---------------- Spielerauswahl ---------------- */
  private renderPlayers(): void {
    this.screen = 'players';
    const s = this.st;
    const n = s.players;
    const slotHtml = s.slots
      .slice(0, n)
      .map(
        (sl, i) => `
        <div class="slot" style="--c:${PLAYER_COLORS[i % PLAYER_COLORS.length]}">
          <div class="slot-h"><i></i><b>Spieler ${i + 1}</b></div>
          <div class="seg">
            <button data-i="${i}" data-h="1" class="${sl.human ? 'on' : ''}">Mensch</button>
            <button data-i="${i}" data-h="0" class="${sl.human ? '' : 'on'}">Computer</button>
          </div>
          ${
            sl.human
              ? `<input class="input" data-name="${i}" maxlength="14" value="${esc(sl.name)}" placeholder="Name" />`
              : `<select data-bot="${i}">${BOT_LABELS.map(([v, l]) => `<option value="${v}" ${v === sl.bot ? 'selected' : ''}>${l}</option>`).join('')}</select>`
          }
        </div>`
      )
      .join('');
    this.el.innerHTML = `
      <div class="menu-wrap single"><div class="card wide">
        <h2>SPIELERAUSWAHL</h2>
        <div class="slots">${slotHtml}</div>
        <div class="row">
          <button class="btn ghost" data-row="back" data-back="1" id="b-back">Zurück</button>
          <button class="btn primary" data-row="go" id="b-go">START</button>
        </div>
      </div></div>`;
    this.el.querySelectorAll<HTMLButtonElement>('button[data-h]').forEach((b) =>
      b.addEventListener('click', () => {
        s.slots[Number(b.dataset.i)].human = b.dataset.h === '1';
        this.save();
        this.renderPlayers();
      })
    );
    this.el.querySelectorAll<HTMLInputElement>('input[data-name]').forEach((inp) =>
      inp.addEventListener('input', () => {
        s.slots[Number(inp.dataset.name)].name = inp.value.slice(0, 14);
        this.save();
      })
    );
    this.el.querySelectorAll<HTMLSelectElement>('select[data-bot]').forEach((sel) =>
      sel.addEventListener('change', () => {
        s.slots[Number(sel.dataset.bot)].bot = sel.value as BotChoice;
        this.save();
      })
    );
    this.el.querySelector('#b-back')!.addEventListener('click', () => this.renderMain());
    this.el.querySelector('#b-go')!.addEventListener('click', () => {
      this.save();
      this.hide();
      this.cb.onStart({ slots: s.slots.slice(0, n).map((x) => ({ ...x })), rounds: s.rounds, mode: s.mode, options: { ...s.options } });
    });
  }

  /* ---------------- Online-Lobby ---------------- */
  private renderLobby(code: string, isHost: boolean, players: LobbyPlayer[]): void {
    this.screen = 'lobby';
    this.el.innerHTML = `
      <div class="menu-wrap">
        ${this.logo()}
        <div class="card">
          <h2>${isHost ? 'DEIN RAUM' : 'RAUM BEIGETRETEN'}</h2>
          <div class="hint" style="text-align:center">Raum-Code – diesen Code deinen Mitspielern geben</div>
          <div class="code-big">${esc(code)}</div>
          <div id="m-list" class="plist"></div>
          ${
            isHost
              ? `<div class="field"><label>GESAMTZAHL KOMMANDANTEN (REST WIRD MIT BOTS AUFGEFÜLLT)</label>
                   <select id="m-total">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
                 <button id="m-start" class="btn primary">Match starten</button>`
              : `<div class="hint" style="text-align:center">Warte auf den Host…</div>`
          }
          <button id="m-back" class="btn ghost">Raum verlassen</button>
        </div>
      </div>`;
    this.listEl = this.el.querySelector('#m-list');
    this.setPlayers(players);
    this.el.querySelector('#m-start')?.addEventListener('click', () => {
      const total = Number(this.el.querySelector<HTMLSelectElement>('#m-total')!.value);
      this.hide();
      this.cb.onHostStart(total);
    });
    this.el.querySelector('#m-back')!.addEventListener('click', () => {
      this.cb.onLeave();
      this.renderMain();
    });
  }
}
