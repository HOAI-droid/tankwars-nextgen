import { io, Socket } from 'socket.io-client';
import { GameMode, ShopItemId, ShotCommand } from '@tankwars/shared';

export class NetworkClient {
  public socket: Socket;
  public roomCode: string | null = null;
  public isHost = false;

  constructor(serverUrl: string) {
    this.socket = io(serverUrl, { autoConnect: true });
  }

  public createRoom(name: string, mode: GameMode): Promise<string> {
    return new Promise((resolve, reject) => {
      this.socket.emit('room:create', { name, mode }, (res: { ok: boolean; code?: string; error?: string }) => {
        if (res.ok && res.code) {
          this.roomCode = res.code;
          this.isHost = true;
          resolve(res.code);
        } else {
          reject(res.error);
        }
      });
    });
  }

  public joinRoom(code: string, name: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.socket.emit('room:join', { code, name }, (res: { ok: boolean; code?: string; error?: string }) => {
        if (res.ok && res.code) {
          this.roomCode = res.code;
          this.isHost = false;
          resolve(res.code);
        } else {
          reject(res.error);
        }
      });
    });
  }

  public startMatch(fillWithBots = 6): void {
    this.socket.emit('match:start', { fillWithBots });
  }

  public sendShot(cmd: Omit<ShotCommand, 'tankId'>): void {
    this.socket.emit('game:shoot', cmd);
  }

  public buyItem(itemId: ShopItemId): void {
    this.socket.emit('shop:buy', { itemId });
  }

  public nextRound(): void {
    this.socket.emit('shop:nextRound');
  }
}
