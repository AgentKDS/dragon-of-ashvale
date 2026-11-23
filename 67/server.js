// Dragon of Ashvale – multiplayer server
// One small Node.js process that:
//   1. serves the game page (public/index.html) at  http://yourhost/
//   2. runs the real-time relay over WebSocket at  ws(s)://yourhost/ws
// Players are grouped into rooms ("servers") of up to MAX_PER_ROOM, like slither.io.
//
// Shared world: in each room one player's game is the HOST. The host runs the bots and the Elder Wyrm
// and sends the world to everyone else; everyone else sends their damage to the host. If the host
// leaves, the next player in the room takes over automatically.
//
// Run locally:   npm install   then   npm start   then open http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = 30;          // players per room before a new room opens
const TICK_MS = 100;              // how often everyone gets a snapshot (10 per second)
const MAX_MSGS_PER_SEC = 60;      // flood protection per player (the host sends a little more)
const MAX_GROWTH_PER_SEC = 400;   // a player's size can't jump faster than this (anti-cheat, loose)

// ---------- static files ----------
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/') url = '/index.html';
  if (url === '/health'){ res.writeHead(200, {'content-type':'text/plain'}); return res.end('ok'); }
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)){ res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err){ res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'content-type': TYPES[path.extname(file)] || 'application/octet-stream'});
    res.end(data);
  });
});

// ---------- rooms ----------
const rooms = [];
let nextId = 1;
function roomFor(){
  let r = rooms.find(r => r.players.size < MAX_PER_ROOM);
  if (!r){ r = { id: rooms.length + 1, players: new Map(), host: 0 }; rooms.push(r); }
  return r;
}
const num = (v, lo, hi, d = 0) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Dragon';
const cleanSkin = s => /^[a-z]{2,12}$/.test(String(s)) ? String(s) : 'ember';
// a bot ("b0".."b99") or the Elder Wyrm ("boss")
const cleanNpc = s => /^(b\d{1,2}|boss)$/.test(String(s)) ? String(s) : null;
function send(ws, o){ if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function broadcast(room, o, except){
  const msg = typeof o === 'string' ? o : JSON.stringify(o);
  for (const p of room.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(msg);
}
function pickHost(room){
  const first = room.players.keys().next();
  room.host = first.done ? 0 : first.value;   // the longest-connected player
  broadcast(room, { t: 'host', id: room.host });
}

// ---------- WebSocket relay ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 32768 });
wss.on('connection', ws => {
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  const room = roomFor();
  const p = { id: nextId++, ws, room, name: 'Dragon', skin: 'ember', st: null, msgs: 0, lastMass: 5, lastMassT: Date.now() };
  room.players.set(p.id, p);
  if (!room.host) room.host = p.id;
  send(ws, { t: 'welcome', id: p.id, room: room.id, host: room.host });
  console.log(`player ${p.id} joined room ${room.id} (${room.players.size} players, host ${room.host})`);
  const isHost = () => room.host === p.id;

  ws.on('message', raw => {
    if (++p.msgs > MAX_MSGS_PER_SEC) return;          // over the limit this second: drop it
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 's'){
      // our state: position, rotation, size, health, flags
      if (!Array.isArray(m.p) || !Array.isArray(m.r)) return;
      p.name = cleanName(m.n); p.skin = cleanSkin(m.k);
      let mass = num(m.m, 0, 100000, 5);
      // a size can only grow so fast; anything faster is clamped
      const t = Date.now(), dt = Math.max(0.05, (t - p.lastMassT)/1000);
      if (mass > p.lastMass + MAX_GROWTH_PER_SEC*dt + 50) mass = p.lastMass + MAX_GROWTH_PER_SEC*dt + 50;
      p.lastMass = mass; p.lastMassT = t;
      p.st = {
        id: p.id, n: p.name, k: p.skin, a: m.a ? 1 : 0,
        p: m.p.slice(0, 3).map(v => num(v, -1e5, 1e5)), r: m.r.slice(0, 3).map(v => num(v, -10, 10)),
        m: Math.round(mass*10)/10, h: num(m.h, 0, 1e6), b: m.b ? 1 : 0, w: m.w ? 1 : 0, s: num(m.s, -300, 300), rm: num(m.rm, 0, 2),
        // walking details so others see you walk, run, jump, sit and swim
        sw: m.sw ? 1 : 0, sit: num(m.sit, 0, 1), air: num(m.air, 0, 100)
      };
    }
    else if (m.t === 'world'){
      // the host's bots and Elder Wyrm, passed to everyone else as-is
      if (!isHost()) return;
      broadcast(room, JSON.stringify(m), p);
    }
    else if (m.t === 'fire'){
      if (!Array.isArray(m.p) || !Array.isArray(m.v)) return;
      const o = isHost() ? cleanNpc(m.o) : null;     // only the host fires for bots and the Wyrm
      broadcast(room, { t: 'fire', from: p.id, o, p: m.p.slice(0,3).map(v => num(v, -1e5, 1e5)), v: m.v.slice(0,3).map(v => num(v, -400, 400)),
        d: num(m.d, 1, 200, 8), z: num(m.z, 0.3, 4, 1), tg: num(m.tg, 0, 1e9), rm: num(m.rm, 0, 2) }, p);
    }
    else if (m.t === 'dmg'){
      // we hurt a bot or the Wyrm: the host applies it
      const tg = cleanNpc(m.tg); const h = room.players.get(room.host);
      if (tg && h && !isHost()) send(h.ws, { t: 'dmg', from: p.id, tg, d: num(m.d, 0, 2000), how: String(m.how || '').slice(0, 12) });
    }
    else if (m.t === 'hit'){
      // a bite: pass it to the victim, who applies it (the host also bites for bots and the Wyrm)
      const v = room.players.get(num(m.to, 0, 1e9));
      const by = isHost() ? cleanNpc(m.by) : null;
      if (v) send(v.ws, { t: 'hit', from: p.id, by, d: num(m.d, 0, 400), how: 'Bite' });
    }
    else if (m.t === 'bk' || m.t === 'br'){
      // from the host: you defeated a bot (bk) / your share of the Elder Wyrm's reward (br)
      if (!isHost()) return;
      const v = room.players.get(num(m.to, 0, 1e9));
      if (v) send(v.ws, { t: m.t, m: num(m.m, 0, 100000), n: String(m.n || '').slice(0, 20), fin: m.fin ? 1 : 0 });
    }
    else if (m.t === 'dead'){
      // we died: everyone hears about it, and whoever got us swallows our size
      const byId = num(m.by, 0, 1e9);
      const killer = room.players.has(byId) ? byId : (cleanNpc(m.by) || 0);
      const mass = Math.min(num(m.m, 0, 100000), p.lastMass + 50);
      broadcast(room, { t: 'kill', victim: p.id, killer, m: mass });
      if (p.st) p.st.a = 0;
    }
  });

  ws.on('close', () => {
    room.players.delete(p.id);
    if (room.host === p.id) pickHost(room);
    console.log(`player ${p.id} left room ${room.id} (${room.players.size} players, host ${room.host})`);
  });
});

// snapshots out, flood counters reset
setInterval(() => {
  for (const room of rooms){
    if (!room.players.size) continue;
    const ps = [];
    for (const p of room.players.values()) if (p.st) ps.push(p.st);
    broadcast(room, { t: 'snap', ps, host: room.host });
  }
}, TICK_MS);
setInterval(() => { for (const r of rooms) for (const p of r.players.values()) p.msgs = 0; }, 1000);
// drop dead connections
setInterval(() => {
  for (const ws of wss.clients){
    if (ws.alive === false){ ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log(`Dragon of Ashvale server on http://localhost:${PORT}`));
