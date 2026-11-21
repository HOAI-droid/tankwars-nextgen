import Peer, { DataConnection, PeerOptions } from 'peerjs';
import { GameMode, ShopItemId, ShotCommand } from '@tankwars/shared';

/**
 * Serverloses Multiplayer: Der Host-Browser führt die komplette Simulation aus,
 * alle anderen Spieler verbinden sich per WebRTC (PeerJS) über einen 4-stelligen
 * Raum-Code. Es muss kein eigener Server betrieben werden.
 */

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
}

export const PLAYER_COLORS = [
  '#3b9dff', '#ff4d4d', '#ffd23f', '#38d996', '#b66dff',
  '#ff8c2b', '#27d3e6', '#ff5fb0', '#9be02f', '#e8e8f0',
];

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_PREFIX = 'twng-';
const MAX_PLAYERS = 10;

type NetMsg =
  | { t: 'hello'; name: string }
  | { t: 'welcome'; id: string; players: LobbyPlayer[]; mode: GameMode }
  | { t: 'reject'; reason: string }
  | { t: 'players'; players: LobbyPlayer[] }
  | { t: 'state'; snap: unknown }
  | { t: 'shoot'; cmd: Omit<ShotCommand, 'tankId'> }
  | { t: 'buy'; itemId: ShopItemId }
  | { t: 'closed' };

function peerOptions(): PeerOptions {
  // Für lokale Tests: ?peerhost=localhost&peerport=9000
  const q = new URLSearchParams(window.location.search);
  const host = q.get('peerhost');
  if (host) {
    return {
      host,
      port: Number(q.get('peerport') || 9000),
      path: '/',
      secure: false,
      debug: 0,
    };
  }
  return { debug: 0 };
}

function genCode(): string {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}

export interface HostEvents {
  onPlayers: (players: LobbyPlayer[]) => void;
  onShoot: (playerId: string, cmd: Omit<ShotCommand, 'tankId'>) => void;
  onBuy: (playerId: string, itemId: ShopItemId) => void;
  onLeave: (playerId: string) => void;
}

/** Läuft im Browser des Host-Spielers. */
export class HostSession {
  public readonly isHost = true;
  public code = '';
  public myId = 'host';
  public players: LobbyPlayer[] = [];
  public started = false;

  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();

  constructor(private name: string, public mode: GameMode, private ev: HostEvents) {
    this.players = [{ id: this.myId, name, color: PLAYER_COLORS[0] }];
  }

  public open(): Promise<string> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryOpen = () => {
        attempts++;
        const code = genCode();
        const peer = new Peer(ID_PREFIX + code, peerOptions());
        peer.on('open', () => {
          this.peer = peer;
          this.code = code;
          peer.on('connection', (c) => this.accept(c));
          peer.on('error', () => undefined);
          resolve(code);
        });
        peer.on('error', (err: { type?: string }) => {
          peer.destroy();
          if (err.type === 'unavailable-id' && attempts < 6) tryOpen();
          else reject(new Error('Verbindung zum Vermittlungsdienst fehlgeschlagen'));
        });
      };
      tryOpen();
    });
  }

  private accept(conn: DataConnection): void {
    conn.on('data', (raw) => {
      const msg = raw as NetMsg;
      if (msg.t === 'hello') {
        if (this.started) return this.reject(conn, 'Das Match läuft bereits');
        if (this.players.length >= MAX_PLAYERS) return this.reject(conn, 'Raum voll (max. 10)');
        const color = PLAYER_COLORS[this.players.length % PLAYER_COLORS.length];
        this.players.push({ id: conn.peer, name: (msg.name || `Spieler ${this.players.length + 1}`).slice(0, 14), color });
        this.conns.set(conn.peer, conn);
        this.send(conn, { t: 'welcome', id: conn.peer, players: this.players, mode: this.mode });
        this.broadcastPlayers();
      } else if (msg.t === 'shoot') {
        this.ev.onShoot(conn.peer, msg.cmd);
      } else if (msg.t === 'buy') {
        this.ev.onBuy(conn.peer, msg.itemId);
      }
    });
    const drop = () => {
      if (!this.conns.delete(conn.peer)) return;
      if (!this.started) this.players = this.players.filter((p) => p.id !== conn.peer);
      this.ev.onLeave(conn.peer);
      this.broadcastPlayers();
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private reject(conn: DataConnection, reason: string): void {
    this.send(conn, { t: 'reject', reason });
    setTimeout(() => conn.close(), 300);
  }

  private send(conn: DataConnection, msg: NetMsg): void {
    if (conn.open) conn.send(msg);
  }

  private broadcastPlayers(): void {
    this.ev.onPlayers(this.players);
    for (const c of this.conns.values()) this.send(c, { t: 'players', players: this.players });
  }

  public broadcastState(snap: unknown): void {
    for (const c of this.conns.values()) this.send(c, { t: 'state', snap });
  }

  public get peerCount(): number {
    return this.conns.size;
  }

  public close(): void {
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

export interface ClientEvents {
  onPlayers: (players: LobbyPlayer[]) => void;
  onState: (snap: any) => void;
  onClosed: () => void;
}

/** Läuft im Browser eines Mitspielers. */
export class ClientSession {
  public readonly isHost = false;
  public code = '';
  public myId = '';
  public mode: GameMode = 'SIMULTANEOUS';
  public players: LobbyPlayer[] = [];

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;

  constructor(private ev: ClientEvents) {}

  public join(code: string, name: string): Promise<void> {
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (m: string) => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new Error(m));
      };
      const timer = setTimeout(() => fail('Zeitüberschreitung – Raum nicht erreichbar'), 12000);

      const peer = new Peer(peerOptions());
      this.peer = peer;
      peer.on('error', (err: { type?: string }) => {
        clearTimeout(timer);
        fail(err.type === 'peer-unavailable' ? `Raum „${code}“ nicht gefunden` : 'Verbindungsfehler');
      });
      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code, { reliable: true });
        this.conn = conn;
        conn.on('open', () => conn.send({ t: 'hello', name } satisfies NetMsg));
        conn.on('data', (raw) => {
          const msg = raw as NetMsg;
          switch (msg.t) {
            case 'welcome':
              clearTimeout(timer);
              this.code = code;
              this.myId = msg.id;
              this.mode = msg.mode;
              this.players = msg.players;
              if (!settled) {
                settled = true;
                resolve();
              }
              this.ev.onPlayers(msg.players);
              break;
            case 'reject':
              clearTimeout(timer);
              fail(msg.reason);
              break;
            case 'players':
              this.players = msg.players;
              this.ev.onPlayers(msg.players);
              break;
            case 'state':
              this.ev.onState(msg.snap);
              break;
          }
        });
        conn.on('close', () => {
          if (settled) this.ev.onClosed();
        });
      });
    });
  }

  public sendShot(cmd: Omit<ShotCommand, 'tankId'>): void {
    this.conn?.send({ t: 'shoot', cmd } satisfies NetMsg);
  }

  public buyItem(itemId: ShopItemId): void {
    this.conn?.send({ t: 'buy', itemId } satisfies NetMsg);
  }

  public close(): void {
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  }
}

export type Session = HostSession | ClientSession;
