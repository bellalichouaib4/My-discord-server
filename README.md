# 🔴 L3attaR Discord Bot

Official Discord bot for the L3attaR streaming community.

**Socials:**
- 🔴 Twitch: [twitch.tv/l3attar_](https://twitch.tv/l3attar_)
- 📺 YouTube: [youtube.com/@L3attaR](https://www.youtube.com/@L3attaR)
- 📸 Instagram: [l3attar_clips](https://www.instagram.com/l3attar/)
- 🎵 TikTok: [@l3attar_b](https://www.tiktok.com/@l3attar_b)
- 📘 Facebook: [L3attar01](https://www.facebook.com/L3attar01/)

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔧 `/setup` | Creates all channels, categories & roles automatically |
| ✅ Button Verification | 1-click verify gate |
| 🔴 Twitch Alerts | Auto-detects l3attar_ going live (polls every 2 min) |
| 📺 YouTube Alerts | Posts new video notification (polls RSS every 10 min) |
| 🔴 Auto Live Role | Assigns `🔴 Live Now` role when streaming |
| 👋 Welcome Embed | Auto-welcome with social links for new members |
| 🔗 `/socials` | Posts all social media links in chat |
| 📡 `/live` | Manually trigger a stream announcement |

---

## 🚀 Setup Guide (Step by Step)

### Step 1 — Create Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → Name it `L3attaR Bot`
3. Go to **Bot** tab → click **Add Bot** → confirm
4. Click **Reset Token** → copy your **Bot Token** (save it!)
5. Scroll down → enable these **3 Privileged Gateway Intents**:
   - ✅ **Server Members Intent**
   - ✅ **Presence Intent**
   - ✅ **Message Content Intent**
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot` + `applications.commands`
   - Permissions: **Administrator**
   - Copy the generated URL → open it → select your server → **Authorize**

### Step 2 — Get Twitch API Keys

1. Go to [dev.twitch.tv/console](https://dev.twitch.tv/console)
2. Click **Register Your Application**
3. Name: anything | OAuth Redirect: `http://localhost` | Category: Chat Bot
4. Copy **Client ID** and click **New Secret** → copy **Client Secret**

### Step 3 — Get Your YouTube Channel ID

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Settings → Channel → Advanced Settings
3. Copy the **Channel ID** (starts with `UC...`)

### Step 4 — Configure the Bot

Clone this repo and set up files:

```bash
git clone https://github.com/bellalichouaib4/My-discord-server.git
cd My-discord-server
npm install
cp .env.example .env
```

Edit `.env`:
```
BOT_TOKEN=paste_your_bot_token_here
```

Edit `config.json`:
```json
{
  "guildId": "RIGHT-CLICK YOUR SERVER IN DISCORD → Copy Server ID",
  "twitch": {
    "username": "l3attar_",
    "clientId": "paste_twitch_client_id",
    "clientSecret": "paste_twitch_client_secret"
  },
  "youtube": {
    "channelId": "paste_UC_channel_id"
  }
}
```

> **How to get Server ID:** In Discord, go to Settings → Advanced → enable Developer Mode. Then right-click your server icon → Copy Server ID.

### Step 5 — Run the Bot

```bash
npm start
```

In Discord, type:
```
/setup
```

Your full server structure will be created automatically! 🎉

---

## 🌐 Deploy Free 24/7 (Railway)

1. Push to GitHub (already done)
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Select this repo
4. Go to **Variables** → add `BOT_TOKEN` = your token
5. Deploy — bot stays online forever for free

---

## 🐳 Docker

```bash
docker build -t l3attar-bot .
docker run -d --env-file .env l3attar-bot
```

---

## ⚠️ Important
- Run `/setup` only **once** — it skips existing channels
- Never commit `.env` to GitHub — it's in `.gitignore`
- `config.json` Twitch/YouTube fields can be left empty if you don't use them
