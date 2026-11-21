import { GameMode } from '@tankwars/shared';
import { NetworkClient } from './network.js';

export interface StartMenuCallbacks {
  onStartSolo: (playerName: string, mode: GameMode) => void;
  onOnlineReady: (net: NetworkClient, myId: string) => void;
}

export class StartMenu {
  private el: HTMLDivElement;
  private net: NetworkClient | null = null;

  constructor(private cb: StartMenuCallbacks) {
    this.el = document.createElement('div');
    this.el.id = 'start-menu';
    this.el.style.cssText = `
      position:fixed; inset:0; z-index:40; background:rgba(12,16,26,0.88);
      backdrop-filter:blur(10px); display:flex; align-items:center; justify-content:center; padding:16px;
    `;
    document.body.appendChild(this.el);
    this.renderMain();
  }

  public show(): void {
    this.el.classList.remove('hidden');
  }

  public hide(): void {
    this.el.classList.add('hidden');
  }

  private renderMain(): void {
    const savedName = localStorage.getItem('tw_name') || 'Kommandant';
    const defaultServer = localStorage.getItem('tw_server') || `http://${window.location.hostname}:3090`;

    this.el.innerHTML = `
      <div style="background:#1a2232; border:1px solid rgba(255,255,255,0.16); border-radius:18px; padding:22px; width:100%; max-width:420px; display:flex; flex-direction:column; gap:14px;">
        <div style="text-align:center;">
          <h1 style="margin:0; font-size:26px; letter-spacing:1px;">💥 TANKWARS <span style="color:#ff6b2b;">NEXTGEN</span></h1>
          <p style="margin:4px 0 0; font-size:13px; opacity:0.7;">2.5D Diorama & 90s VGA Artillery</p>
        </div>

        <div style="display:flex; gap:8px;">
          <input id="m-name" value="${savedName}" placeholder="Dein Name" style="flex:1; background:#232d42; color:#fff; border:1px solid rgba(255,255,255,0.18); border-radius:8px; padding:10px; font-size:14px;" />
          <select id="m-mode" style="background:#232d42; color:#fff; border:1px solid rgba(255,255,255,0.18); border-radius:8px; padding:10px; font-size:14px;">
            <option value="SIMULTANEOUS">Simultan-Chaos</option>
            <option value="CLASSIC">Klassisch (Reihum)</option>
          </select>
        </div>

        <button id="m-solo" class="btn-fire" style="width:100%;">🎮 Solo gegen Bots spielen</button>

        <hr style="border:none; border-top:1px solid rgba(255,255,255,0.12); margin:2px 0;" />

        <div style="display:flex; flex-direction:column; gap:8px;">
          <label style="font-size:12px; opacity:0.75;">🌐 Online-Multiplayer (bis 10 Spieler)</label>
          <input id="m-server" value="${defaultServer}" placeholder="Server-URL (z. B. https://tankwars.deine-domain.de)" style="background:#232d42; color:#fff; border:1px solid rgba(255,255,255,0.18); border-radius:8px; padding:8px 10px; font-size:13px;" />

          <button id="m-create" style="background:#3b82f6; color:#fff; border:none; border-radius:8px; padding:10px; font-weight:700; cursor:pointer;">
            + Neuen Raum erstellen
          </button>

          <div style="display:flex; gap:8px;">
            <input id="m-code" maxlength="4" placeholder="RAUM-CODE" style="flex:1; text-transform:uppercase; background:#232d42; color:#fff; border:1px solid rgba(255,255,255,0.18); border-radius:8px; padding:10px; font-size:14px; letter-spacing:2px;" />
            <button id="m-join" style="background:#10b981; color:#fff; border:none; border-radius:8px; padding:10px 16px; font-weight:700; cursor:pointer;">
              Beitreten
            </button>
          </div>
          <div id="m-error" style="color:#f87171; font-size:13px; min-height:16px;"></div>
        </div>
      </div>
    `;

    const nameEl = this.el.querySelector<HTMLInputElement>('#m-name')!;
    const modeEl = this.el.querySelector<HTMLSelectElement>('#m-mode')!;
    const serverEl = this.el.querySelector<HTMLInputElement>('#m-server')!;
    const codeEl = this.el.querySelector<HTMLInputElement>('#m-code')!;
    const errEl = this.el.querySelector<HTMLDivElement>('#m-error')!;

    const savePrefs = () => {
      localStorage.setItem('tw_name', nameEl.value.trim() || 'Kommandant');
      localStorage.setItem('tw_server', serverEl.value.trim());
    };

    this.el.querySelector('#m-solo')!.addEventListener('click', () => {
      savePrefs();
      this.hide();
      this.cb.onStartSolo(nameEl.value.trim() || 'Kommandant', modeEl.value as GameMode);
    });

    this.el.querySelector('#m-create')!.addEventListener('click', async () => {
      savePrefs();
      errEl.textContent = 'Verbinde mit Server…';
      try {
        this.net = new NetworkClient(serverEl.value.trim());
        const code = await this.net.createRoom(nameEl.value.trim(), modeEl.value as GameMode);
        this.renderLobby(code, true, [{ name: nameEl.value.trim(), color: '#3b82f6' }]);
      } catch (e) {
        errEl.textContent = `Fehler: ${String(e)}`;
      }
    });

    this.el.querySelector('#m-join')!.addEventListener('click', async () => {
      savePrefs();
      const code = codeEl.value.trim().toUpperCase();
      if (code.length < 4) {
        errEl.textContent = 'Bitte 4-stelligen Raum-Code eingeben.';
        return;
      }
      errEl.textContent = 'Trete Raum bei…';
      try {
        this.net = new NetworkClient(serverEl.value.trim());
        const joinedCode = await this.net.joinRoom(code, nameEl.value.trim());
        this.renderLobby(joinedCode, false, []);
      } catch (e) {
        errEl.textContent = `Fehler: ${String(e)}`;
      }
    });
  }

  private renderLobby(code: string, isHost: boolean, initialPlayers: Array<{ name: string; color: string }>): void {
    const net = this.net!;
    this.el.innerHTML = `
      <div style="background:#1a2232; border:1px solid rgba(255,255,255,0.16); border-radius:18px; padding:22px; width:100%; max-width:420px; display:flex; flex-direction:column; gap:14px;">
        <div style="text-align:center;">
          <div style="font-size:12px; opacity:0.7;">RAUM-CODE TEILEN</div>
          <div style="font-size:34px; font-weight:900; letter-spacing:6px; color:#ff6b2b;">${code}</div>
        </div>

        <div id="lobby-list" style="display:flex; flex-direction:column; gap:6px; max-height:200px; overflow-y:auto;"></div>

        ${
          isHost
            ? `<button id="lobby-start" class="btn-fire" style="width:100%;">🚀 Match starten (auf 6 mit Bots auffüllen)</button>`
            : `<p style="text-align:center; opacity:0.75; margin:4px 0;">Warte darauf, dass der Host startet…</p>`
        }
      </div>
    `;

    const listEl = this.el.querySelector<HTMLDivElement>('#lobby-list')!;
    const drawPlayers = (players: Array<{ name: string; color: string }>) => {
      listEl.innerHTML = players
        .map(
          (p) => `
          <div style="display:flex; align-items:center; gap:10px; background:#232d42; padding:8px 12px; border-radius:8px;">
            <span style="width:12px; height:12px; border-radius:50%; background:${p.color}; display:inline-block;"></span>
            <span style="font-weight:600;">${p.name}</span>
          </div>`
        )
        .join('');
    };

    drawPlayers(initialPlayers);
    net.socket.on('room:players', drawPlayers);

    net.socket.once('game:state', () => {
      this.hide();
      this.cb.onOnlineReady(net, net.socket.id!);
    });

    this.el.querySelector('#lobby-start')?.addEventListener('click', () => {
      net.startMatch(6);
    });
  }
}
