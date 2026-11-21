import { createServer } from 'http';
import { Server } from 'socket.io';
import {
  BotDifficulty,
  computeBotShot,
  GameMode,
  GameSimulation,
  ShopItemId,
  ShotCommand,
} from '@tankwars/shared';

interface PlayerSlot {
  socketId: string;
  name: string;
  color: string;
}

interface Room {
  code: string;
  hostId: string;
  players: PlayerSlot[];
  sim: GameSimulation;
  started: boolean;
  simTimer?: NodeJS.Timeout;
}

const COLORS = [
  '#3b82f6', '#ef4444', '#eab308', '#10b981', '#a855f7',
  '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e',
];
const BOT_TYPES: BotDifficulty[] = ['MR_STUPID', 'LOBBER', 'RIFLEMAN', 'WINDMASTER'];
const MAX_PLAYERS = 10;

const rooms = new Map<string, Room>();
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
});

function genCode(): string {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
  let currentRoom: Room | null = null;

  socket.on('room:create', ({ name, mode }: { name: string; mode: GameMode }, cb) => {
    const code = genCode();
    const room: Room = {
      code,
      hostId: socket.id,
      players: [{ socketId: socket.id, name: name || 'Spieler 1', color: COLORS[0] }],
      sim: new GameSimulation(mode || 'SIMULTANEOUS'),
      started: false,
    };
    rooms.set(code, room);
    currentRoom = room;
    socket.join(code);
    cb?.({ ok: true, code, players: room.players });
  });

  socket.on('room:join', ({ code, name }: { code: string; name: string }, cb) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) return cb?.({ ok: false, error: 'Raum nicht gefunden' });
    if (room.started) return cb?.({ ok: false, error: 'Match läuft bereits' });
    if (room.players.length >= MAX_PLAYERS) return cb?.({ ok: false, error: 'Raum voll (max. 10)' });

    const color = COLORS[room.players.length % COLORS.length];
    room.players.push({ socketId: socket.id, name: name || `Spieler ${room.players.length + 1}`, color });
    currentRoom = room;
    socket.join(room.code);
    io.to(room.code).emit('room:players', room.players);
    cb?.({ ok: true, code: room.code, players: room.players });
  });

  socket.on('match:start', ({ fillWithBots = 4 }: { fillWithBots?: number }) => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    const room = currentRoom;
    room.started = true;

    const participants: Array<{ id: string; name: string; color: string; isBot: boolean; botType?: BotDifficulty }> =
      room.players.map((p) => ({ id: p.socketId, name: p.name, color: p.color, isBot: false }));

    const targetTotal = Math.min(MAX_PLAYERS, Math.max(participants.length, fillWithBots));
    let botIdx = 0;
    while (participants.length < targetTotal) {
      const botType = BOT_TYPES[botIdx % BOT_TYPES.length];
      participants.push({
        id: `bot_${botIdx}`,
        name: botType.replace('_', ' '),
        color: COLORS[participants.length % COLORS.length],
        isBot: true,
        botType,
      });
      botIdx++;
    }

    room.sim.setupMatch(participants);
    io.to(room.code).emit('game:state', room.sim.getSnapshot(true));
    startRoomLoop(room);
  });

  socket.on('game:shoot', (cmd: Omit<ShotCommand, 'tankId'>) => {
    if (!currentRoom || !currentRoom.started) return;
    currentRoom.sim.submitShot({ ...cmd, tankId: socket.id });
    io.to(currentRoom.code).emit('game:state', currentRoom.sim.getSnapshot(false));
  });

  socket.on('shop:buy', ({ itemId }: { itemId: ShopItemId }) => {
    if (!currentRoom) return;
    if (currentRoom.sim.buyItem(socket.id, itemId)) {
      io.to(currentRoom.code).emit('game:state', currentRoom.sim.getSnapshot(false));
    }
  });

  socket.on('shop:nextRound', () => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    currentRoom.sim.startNextRound();
    io.to(currentRoom.code).emit('game:state', currentRoom.sim.getSnapshot(true));
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    currentRoom.players = currentRoom.players.filter((p) => p.socketId !== socket.id);
    if (currentRoom.players.length === 0) {
      if (currentRoom.simTimer) clearInterval(currentRoom.simTimer);
      rooms.delete(currentRoom.code);
    } else {
      io.to(currentRoom.code).emit('room:players', currentRoom.players);
    }
  });
});

function startRoomLoop(room: Room): void {
  if (room.simTimer) clearInterval(room.simTimer);
  let tickCount = 0;

  room.simTimer = setInterval(() => {
    const sim = room.sim;

    if (sim.mode === 'CLASSIC' && sim.phase === 'PLANNING') {
      const active = sim.tanks[sim.activeTankIndex];
      if (active?.isBot && tickCount % 45 === 0) {
        sim.submitShot(computeBotShot(active, sim.tanks, sim.wind));
      }
    }

    if (sim.phase === 'RESOLVING') {
      sim.step(1 / 60);
      const hadExplosion = sim.recentExplosions.length > 0;
      if (hadExplosion || tickCount % 3 === 0 || sim.phase !== 'RESOLVING') {
        io.to(room.code).emit('game:state', sim.getSnapshot(hadExplosion));
      }
    }
    tickCount++;
  }, 1000 / 60);
}

const PORT = Number(process.env.PORT) || 3090;
httpServer.listen(PORT, () => {
  console.log(`🚀 TankWars Server läuft auf Port ${PORT}`);
});
