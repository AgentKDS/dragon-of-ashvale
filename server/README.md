# Dragon of Ashvale — multiplayer server

This folder is everything needed to run the game online with real players.

```
server/
  server.js         the game server (Node.js + the "ws" WebSocket library)
  package.json      tells Node what to install and how to start
  public/index.html the game itself (served to players' browsers)
```

The server does two jobs at one address:

- `https://your-game-address/` sends players the game page.
- `wss://your-game-address/ws` is the live connection that moves everyone's dragons.

When the game page loads from the server, it connects by itself. If no server is found (like in the
Claude preview), the game quietly stays single-player with bots.

## Try it on your own computer

1. Install Node.js 18 or newer from https://nodejs.org
2. In this folder run:
   ```
   npm install
   npm start
   ```
3. Open http://localhost:3000 in two browser tabs. Each tab is a different player.

Friends on the same Wi-Fi can join at `http://YOUR-COMPUTER-IP:3000`.

## Put it on the internet (pick one)

All of these give you a public link like `https://dragon-of-ashvale.onrender.com` that anyone can open
and play in their browser. First, put this `server` folder in a GitHub repository.

- **Render** (render.com), easiest: New → Web Service → pick your repo. Build command `npm install`,
  start command `npm start`. The free plan works but sleeps after 15 minutes idle (first visit then takes ~1 minute).
- **Railway** (railway.app): New Project → Deploy from GitHub repo. It detects Node and runs `npm start`.
  Small monthly cost after the trial credit.
- **Fly.io** (fly.io): install `flyctl`, run `fly launch` in this folder, then `fly deploy`. Can run close to players
  in several regions.
- **Glitch** (glitch.com): import the GitHub repo. Good for quick experiments.
- **Your own VPS** (DigitalOcean, Hetzner, etc.): copy the folder, `npm install`, run it with `pm2 start server.js`,
  and put Caddy or nginx in front for HTTPS.

The server reads the `PORT` environment variable, which all of these hosts set automatically.

## Playing on a different web host

If the game page is hosted somewhere else (for example GitHub Pages or itch.io) and only the server runs on
Render, add the server address to the game link:

```
https://yourname.github.io/dragon/?server=wss://dragon-of-ashvale.onrender.com/ws
```

## Settings (top of server.js)

| Setting | Default | What it does |
|---|---|---|
| `MAX_PER_ROOM` | 30 | Players per room; a new room opens when one is full |
| `TICK_MS` | 100 | How often everyone gets an update (100 ms = 10 per second) |
| `MAX_MSGS_PER_SEC` | 40 | Flood protection per player |
| `MAX_GROWTH_PER_SEC` | 400 | Limits how fast a player's size can jump |

## How it works

- Each player's browser sends its dragon's position, size, health and flags 10 times a second.
- The server sends every player the whole room 10 times a second, and the game smooths the motion in between.
- **Fireballs and fire trails:** the player who gets hit decides whether it hit, using what their own screen shows.
- **Bites:** the biter decides, and the server passes the bite to the victim.
- **Kills:** when you die, the server tells the player who got you, and they swallow your size.
- **Shared bots and Elder Wyrm:** in each room, the longest-connected player's game is the *host*. It runs the bots
  and the Elder Wyrm and sends them to everyone 10 times a second, so the whole room sees the same bots and fights
  the same Wyrm. Other players' hits on bots and the Wyrm go to the host. The host sends back kill rewards and each
  player's share of the Wyrm's reward. If the host leaves, the next player takes over where things were.
- **Walking:** other players see you walk, run, jump, sit and swim with folded wings.
- Birds, villagers, embers and power-ups are still separate in each player's game.

## Limits to know about

- The server trusts each player's game for position, so a determined cheater could edit their copy of the game.
  To fix that, the server would have to run the whole game itself (a much bigger project).
- The bots run in the host's browser, so if the host's connection is slow, everyone's bots look a bit jumpy.
