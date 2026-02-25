# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alba3ati is a real-time multiplayer game server for a Sudanese Mafia/Werewolf variant. Built with Express.js, Socket.IO, and MongoDB (Mongoose). The game features role-based night/day cycles with WebRTC voice chat.

## Commands

- `npm run dev` — Start dev server with nodemon (port 3009 by default)
- `npm install` — Install dependencies
- No test framework is configured yet

## Required Environment

- MongoDB running locally (default: `mongodb://localhost:27017/madb`)
- `.env` file with: `NODE_ENV`, `PORT`, `MONGO_URI`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`

## Architecture

**Entry point:** `src/app.js` — Creates HTTP server, initializes loaders, mounts routes.

**Loader pattern:** `src/loaders/` modules initialize subsystems independently:
- `express.js` — Helmet, CORS, body parsing
- `mongoose.js` — MongoDB connection
- `socket.io.js` — All real-time event handlers (this is the largest file and core of the game)

**Layered structure:**
- `src/api/controllers/` — HTTP request handlers (auth, room listing)
- `src/api/models/` — Mongoose schemas (User, Room, GameRound)
- `src/api/routes/` — Express route definitions mounted at `/api`
- `src/api/services/` — Chat namespace service
- `src/api/game/` — Game logic modules (role assignment, night actions, voting, timers, win conditions)
- `src/config/config.js` — Centralized env config
- `src/utils/constants.js` — Game roles and timing constants

## Game Logic Flow

Most game interaction happens through Socket.IO events, not REST endpoints. The flow:

1. **Room creation/joining** — `createRoom`/`joinRoom` socket events, Room model tracks players
2. **Role assignment** (`roles.game.js`) — Random role distribution from 5 roles defined in `constants.js`
3. **Night phase** — Each role acts via dedicated socket events (`b3atiAction`, `al3omdaAction`, `damazeenAction`, `damazeenProtection`)
4. **Day phase** — `calculate.game.js` resolves night actions (kills, protections), then `vote` event triggers village voting
5. **Vote resolution** (`claculateVoteResult.game.js`) — Aggregates votes, handles ties
6. **Win check** (`results.game.js`) — Ba3ati wins if they outnumber villagers; villagers win if all Ba3ati eliminated

## Key Models

- **Room** (`room.model.js`) — Central game state: players array with roles/status, action targets (`ba3atiTargets`, `al3omdaTargets`, `damazeenTargets`), room status (`waiting`/`playing`/`ended`), round tracking
- **User** (`user.model.js`) — Simple: name, email, createdAt
- **GameRound** (`gameRound.model.js`) — Round tracking: roomId, roundNumber, status

## REST API

- `POST /api/auth/register` — Create player (body: `{ name }`)
- `GET /api/rooms` — List public waiting rooms
- `GET /health` — Health check

## Game Roles (from constants.js)

| ID | Arabic Name | Role |
|----|------------|------|
| 1 | البعاتي | Killer (Ba3ati) |
| 2 | العمدة | Protector (Al3omda) |
| 3 | شيخ الدمازين | Damazeen Chief |
| 4 | ست الودع | Special role |
| 5 | ابو جنزير | Special role |

## Socket.IO Event Map

The main socket handler in `src/loaders/socket.io.js` registers all events. Game action handlers are in `src/api/game/room.actions.js`. All handlers receive `(io, socket, arg)` as parameters.

## Conventions

- All game logic files use the `.game.js` suffix
- Socket event handlers follow the pattern: `socket.on("eventName", (arg) => handlerFn(io, socket, arg))`
- Room IDs are random 7-character alphanumeric strings
- Player limit per room: 15
- Language: JavaScript (Node.js), no TypeScript

## Deploy to VPS

### Prerequisites

- Ubuntu 20.04+ VPS (or similar Debian-based)
- SSH access with sudo privileges
- Domain name (optional, for SSL)

### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install MongoDB
sudo apt install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl start mongod
sudo systemctl enable mongod

# Install PM2 (process manager)
sudo npm install -g pm2

# Install Nginx (reverse proxy)
sudo apt install -y nginx
```

### 2. Deploy the App

```bash
# Clone the repo (replace with your repo URL)
cd /var/www
git clone <your-repo-url> alba3ati-backend
cd alba3ati-backend

# Install dependencies
npm install --production

# Create .env file
cat > .env << 'EOF'
NODE_ENV=production
PORT=3009
MONGO_URI=mongodb://localhost:27017/madb
JWT_SECRET=<generate-a-strong-secret>
GOOGLE_CLIENT_ID=<your-google-client-id>
EOF

# Start with PM2
pm2 start src/app.js --name alba3ati
pm2 save
pm2 startup  # follow the printed command to enable on boot
```

### 3. Nginx Reverse Proxy (with WebSocket support)

```bash
sudo nano /etc/nginx/sites-available/alba3ati
```

Paste this config (replace `your-domain.com` with your domain or server IP):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3009;
        proxy_http_version 1.1;

        # WebSocket support (required for Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Socket.IO long-polling fallback
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

Enable and restart:

```bash
sudo ln -s /etc/nginx/sites-available/alba3ati /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # remove default site
sudo nginx -t                              # test config
sudo systemctl restart nginx
```

### 4. SSL with Let's Encrypt (if you have a domain)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# Certbot auto-configures Nginx for HTTPS and sets up auto-renewal
```

### 5. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 6. Useful PM2 Commands

```bash
pm2 status              # check app status
pm2 logs alba3ati       # view logs
pm2 restart alba3ati    # restart after code changes
pm2 monit               # real-time monitoring dashboard
```

### 7. Updating the App

```bash
cd /var/www/alba3ati-backend
git pull
npm install --production
pm2 restart alba3ati
```

### Important Notes

- **CORS:** In production, update `src/loaders/socket.io.js` to replace `"*"` origin with your actual frontend domain
- **MongoDB security:** For production, enable MongoDB authentication and bind to `127.0.0.1` only (default)
- **Socket.IO:** The Nginx config above handles both WebSocket upgrades and long-polling fallback — both are required for Socket.IO
- **Environment:** Ensure `NODE_ENV=production` in `.env` so CORS and other settings apply correctly
