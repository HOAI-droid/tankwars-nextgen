import { GameMode } from '@tankwars/shared';
import { ClientSession, HostSession, LobbyPlayer } from './network.js';

export interface StartMenuCallbacks {
  onSolo: (playerName: string, mode: GameMode) => void;
  onCreate: (playerName: string, mode: GameMode) => Promise<HostSession>;
  onJoin: (code: string, playerName: string) => Promise<ClientSession>;
  onHostStart: (totalPlayers: number) => void;
  onLeave: () => void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class StartMenu {
  private el: HTMLDivElement;
  private listEl: HTMLElement | null = null;
  public visible = true;

  constructor(private cb: StartMenuCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'screen';
    document.body.appendChild(this.el);
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

  public setPlayers(players: LobbyPlayer[]): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = players
      .map(
        (p, i) =>
          `<div class="pitem"><i style="background:${p.color}"></i><span>${esc(p.name)}</span><small>${i === 0 ? 'HOST' : 'BEREIT'}</small></div>`
      )
      .join('');
  }

  private logo(): string {
    return `
      <div class="logo">
        <div class="pre">ARTILLERIE · KRIEG · CHAOS</div>
        <h1>TANK<em>WARS</em></h1>
        <p>Berechne Winkel, Kraft und Wind. Zerstöre das Gelände, kaufe Waffen, überlebe. Bis zu 10 Kommandanten – online per Raum-Code, ohne Server-Setup.</p>
      </div>`;
  }

  private renderMain(): void {
    this.listEl = null;
    const savedName = localStorage.getItem('tw_name') || '';
    const savedMode = localStorage.getItem('tw_mode') || 'SIMULTANEOUS';

    this.el.innerHTML = `
      <div class="menu-wrap">
        ${this.logo()}
        <div class="card">
          <h2>KOMMANDANT</h2>
          <div class="row">
            <div class="field" style="flex:1.3"><label>NAME</label><input id="m-name" class="input" maxlength="14" value="${esc(savedName)}" placeholder="Kommandant" autocomplete="off" /></div>
            <div class="field"><label>MODUS</label>
              <select id="m-mode">
                <option value="SIMULTANEOUS" ${savedMode === 'SIMULTANEOUS' ? 'selected' : ''}>Simultan</option>
                <option value="CLASSIC" ${savedMode === 'CLASSIC' ? 'selected' : ''}>Reihum</option>
              </select>
            </div>
          </div>
          <button id="m-solo" class="btn primary">Solo · gegen Bots</button>
          <div class="divider">ONLINE</div>
          <button id="m-create" class="btn blue">Raum erstellen</button>
          <div class="row">
            <input id="m-code" class="input code-input" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" style="flex:1.4" />
            <button id="m-join" class="btn green">Beitreten</button>
          </div>
          <div id="m-error" class="err"></div>
        </div>
      </div>`;

    const q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s)!;
    const nameEl = q<HTMLInputElement>('#m-name');
    const modeEl = q<HTMLSelectElement>('#m-mode');
    const codeEl = q<HTMLInputElement>('#m-code');
    const errEl = q<HTMLDivElement>('#m-error');
    const btns = [q<HTMLButtonElement>('#m-solo'), q<HTMLButtonElement>('#m-create'), q<HTMLButtonElement>('#m-join')];

    const prefs = () => {
      const name = nameEl.value.trim() || 'Kommandant';
      localStorage.setItem('tw_name', nameEl.value.trim());
      localStorage.setItem('tw_mode', modeEl.value);
      return name;
    };
    const busy = (b: boolean, msg = '') => {
      btns.forEach((x) => (x.disabled = b));
      errEl.style.color = b ? 'var(--accent2)' : '';
      errEl.textContent = msg;
    };

    codeEl.addEventListener('input', () => (codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));

    btns[0].addEventListener('click', () => {
      const name = prefs();
      this.hide();
      this.cb.onSolo(name, modeEl.value as GameMode);
    });

    btns[1].addEventListener('click', async () => {
      const name = prefs();
      busy(true, 'Raum wird erstellt…');
      try {
        const host = await this.cb.onCreate(name, modeEl.value as GameMode);
        this.renderLobby(host.code, true, host.players);
      } catch (e) {
        busy(false);
        errEl.textContent = (e as Error).message || String(e);
      }
    });

    btns[2].addEventListener('click', async () => {
      const name = prefs();
      const code = codeEl.value.trim();
      if (code.length < 4) {
        errEl.textContent = 'Bitte den 4-stelligen Raum-Code eingeben.';
        return;
      }
      busy(true, 'Verbinde…');
      try {
        const client = await this.cb.onJoin(code, name);
        this.renderLobby(client.code, false, client.players);
      } catch (e) {
        busy(false);
        errEl.textContent = (e as Error).message || String(e);
      }
    });
  }

  private renderLobby(code: string, isHost: boolean, players: LobbyPlayer[]): void {
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
