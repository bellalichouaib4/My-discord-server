// ═══════════════════════════════════════════════════════════
//  L3attaR Streaming Discord Bot — discord.js v14
//  Twitch: l3attar_ | YouTube: @L3attaR
//  Features: auto-setup, button verification, Twitch alerts,
//            YouTube alerts, auto Live-Now role, social links
// ═══════════════════════════════════════════════════════════
require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Events,
  PermissionFlagsBits, REST, Routes, SlashCommandBuilder, ActivityType
} = require('discord.js');
const axios   = require('axios');
const Parser  = require('rss-parser');
const config  = require('./config.json');
const setupGuild = require('./setup');

// ── Client ───────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

// ── State ────────────────────────────────────────────────
let twitchToken = null;
let wasLive     = false;
let lastVideoId = null;
const rss       = new Parser();

// ══════════════════════════════════════════════════════════
//  READY
// ══════════════════════════════════════════════════════════
client.once(Events.ClientReady, async () => {
  console.log(`\n🤖 Bot online: ${client.user.tag}`);
  client.user.setActivity('🔴 twitch.tv/l3attar_', { type: ActivityType.Streaming, url: 'https://twitch.tv/l3attar_' });

  await registerCommands();

  if (config.twitch?.clientId)   startTwitchPolling();
  if (config.youtube?.channelId) startYouTubePolling();
});

// ══════════════════════════════════════════════════════════
//  WELCOME — new member
// ══════════════════════════════════════════════════════════
client.on(Events.GuildMemberAdd, async (member) => {
  const guild = member.guild;
  const ch = guild.channels.cache.find(c => c.name === '👋・welcome');
  if (!ch) return;

  const rulesId  = guild.channels.cache.find(c => c.name === '📜・rules')?.id;
  const verifyId = guild.channels.cache.find(c => c.name === '🔒・verify')?.id;
  const genId    = guild.channels.cache.find(c => c.name === '💬・general')?.id;

  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle(`👋 Welcome to L3attaR's Server!`)
    .setDescription(
      `Hey ${member}! Welcome to the official community. 🎮\n\n` +
      `${rulesId  ? `📜 Read the rules → <#${rulesId}>` : ''}\n` +
      `${verifyId ? `🔒 Verify yourself → <#${verifyId}>` : ''}\n` +
      `${genId    ? `💬 Say hi → <#${genId}>` : ''}\n\n` +
      `🔴 [Watch Live](https://twitch.tv/l3attar_) · 📺 [YouTube](https://www.youtube.com/@L3attaR) · 📸 [Instagram](https://www.instagram.com/l3attar_clips/)`
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: `Member #${guild.memberCount} · L3attaR Community` })
    .setTimestamp();

  await ch.send({ embeds: [embed] });
});

// ══════════════════════════════════════════════════════════
//  AUTO LIVE ROLE — presence streaming detection
// ══════════════════════════════════════════════════════════
client.on(Events.PresenceUpdate, async (oldP, newP) => {
  if (!newP.guild) return;
  const liveRole = newP.guild.roles.cache.find(r => r.name === '🔴 Live Now');
  if (!liveRole) return;

  const member = await newP.guild.members.fetch(newP.userId).catch(() => null);
  if (!member) return;

  const isStreaming  = newP.activities?.some(a => a.type === ActivityType.Streaming);
  const wasStreaming = oldP?.activities?.some(a => a.type === ActivityType.Streaming);

  if (isStreaming && !wasStreaming)  await member.roles.add(liveRole).catch(console.error);
  if (!isStreaming && wasStreaming)  await member.roles.remove(liveRole).catch(console.error);
});

// ══════════════════════════════════════════════════════════
//  INTERACTIONS — buttons + slash commands
// ══════════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {

  // ── Button: Verify ──
  if (interaction.isButton() && interaction.customId === 'verify_btn') {
    const { guild, member } = interaction;
    const memberRole     = guild.roles.cache.find(r => r.name === '✅ Member');
    const unverifiedRole = guild.roles.cache.find(r => r.name === '🔒 Unverified');

    if (memberRole && member.roles.cache.has(memberRole.id))
      return interaction.reply({ content: '✅ Already verified!', ephemeral: true });

    if (memberRole)     await member.roles.add(memberRole).catch(console.error);
    if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(console.error);
    return interaction.reply({ content: '✅ Verified! Welcome to L3attaR\'s server! 🎉', ephemeral: true });
  }

  if (!interaction.isChatInputCommand()) return;

  // ── /setup ──
  if (interaction.commandName === 'setup') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: '❌ Need Administrator permission.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });
    await setupGuild(interaction.guild);
    return interaction.editReply('✅ Server structure created! All channels, roles, and categories are set up.');
  }

  // ── /live ──
  if (interaction.commandName === 'live') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return interaction.reply({ content: '❌ Need Manage Messages permission.', ephemeral: true });

    await announceStream(interaction.guild, {
      user_name:    'l3attar_',
      title:        interaction.options.getString('title') || '🔴 Live now — Come watch!',
      game_name:    interaction.options.getString('game')  || 'Valorant',
      viewer_count: 0,
    });
    return interaction.reply({ content: '✅ Stream announced!', ephemeral: true });
  }

  // ── /socials ──
  if (interaction.commandName === 'socials') {
    const embed = new EmbedBuilder()
      .setColor('#9146FF')
      .setTitle('🔗 L3attaR Social Links')
      .addFields(
        { name: '🔴 Twitch',    value: '[l3attar_](https://twitch.tv/l3attar_)',                         inline: true },
        { name: '📺 YouTube',   value: '[@L3attaR](https://www.youtube.com/@L3attaR)',                  inline: true },
        { name: '📸 Instagram', value: '[l3attar_clips](https://www.instagram.com/l3attar_clips/)',    inline: true },
        { name: '🎵 TikTok',    value: '[@l3attar_b](https://www.tiktok.com/@l3attar_b)',              inline: true },
        { name: '📘 Facebook',  value: '[L3attar](https://www.facebook.com/L3attar01/)',               inline: true },
      )
      .setFooter({ text: 'Follow for streams, clips & highlights!' });
    return interaction.reply({ embeds: [embed] });
  }
});

// ══════════════════════════════════════════════════════════
//  TWITCH — poll every 2 minutes
// ══════════════════════════════════════════════════════════
async function getTwitchToken() {
  const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: {
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      grant_type: 'client_credentials',
    },
  });
  twitchToken = res.data.access_token;
}

async function checkTwitch() {
  try {
    if (!twitchToken) await getTwitchToken();
    const res = await axios.get(
      `https://api.twitch.tv/helix/streams?user_login=l3attar_`,
      { headers: { 'Client-ID': config.twitch.clientId, Authorization: `Bearer ${twitchToken}` } }
    );
    const stream = res.data.data[0];
    const guild  = client.guilds.cache.get(config.guildId);
    if (!guild) return;

    if (stream && !wasLive) { wasLive = true;  await announceStream(guild, stream); }
    if (!stream && wasLive) { wasLive = false; }
  } catch (e) {
    if (e.response?.status === 401) twitchToken = null;
    console.error('[Twitch]', e.message);
  }
}

async function announceStream(guild, stream) {
  const ch = guild.channels.cache.find(c => c.name === '📡・stream-alerts');
  if (!ch) return;

  const alertRole = guild.roles.cache.find(r => r.name === '🔔 Stream Alerts');
  const ping = alertRole ? `<@&${alertRole.id}>` : '@everyone';

  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle(`🔴 L3attaR is LIVE on Twitch!`)
    .setDescription(`**${stream.title}**`)
    .addFields(
      { name: '🎮 Game',    value: stream.game_name    || 'Valorant', inline: true },
      { name: '👥 Viewers', value: String(stream.viewer_count || 0),  inline: true },
    )
    .setURL('https://twitch.tv/l3attar_')
    .setImage(`https://static-cdn.jtvnw.net/previews-ttv/live_user_l3attar_-1280x720.jpg?v=${Date.now()}`)
    .setFooter({ text: 'L3attaR · Valorant Streamer' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Watch Live 🔴').setStyle(ButtonStyle.Link).setURL('https://twitch.tv/l3attar_'),
    new ButtonBuilder().setLabel('YouTube 📺').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@L3attaR'),
    new ButtonBuilder().setLabel('Instagram 📸').setStyle(ButtonStyle.Link).setURL('https://www.instagram.com/l3attar_clips/'),
  );

  await ch.send({ content: `${ping} 🔴 **L3attaR is LIVE!**`, embeds: [embed], components: [row] });
}

function startTwitchPolling() {
  checkTwitch();
  setInterval(checkTwitch, 2 * 60 * 1000);
  console.log('📡 Twitch polling started (every 2 min) → l3attar_');
}

// ══════════════════════════════════════════════════════════
//  YOUTUBE — poll RSS every 10 minutes
// ══════════════════════════════════════════════════════════
async function checkYouTube() {
  try {
    const feed   = await rss.parseURL(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${config.youtube.channelId}`
    );
    const latest = feed.items[0];
    if (!latest || latest.id === lastVideoId) return;
    lastVideoId = latest.id;

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;

    const ch = guild.channels.cache.find(c => c.name === '📺・youtube-videos');
    if (!ch) return;

    const videoRole = guild.roles.cache.find(r => r.name === '🔔 Video Alerts');
    const ping = videoRole ? `<@&${videoRole.id}>` : '';

    const thumb = latest['media:group']?.['media:thumbnail']?.[0]?.['$']?.url
               || `https://i.ytimg.com/vi/${latest.id.split(':').pop()}/maxresdefault.jpg`;

    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle(`📺 New Video: ${latest.title}`)
      .setURL(latest.link)
      .setImage(thumb)
      .setFooter({ text: 'L3attaR · YouTube' })
      .setTimestamp(new Date(latest.pubDate));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Watch ▶️').setStyle(ButtonStyle.Link).setURL(latest.link),
      new ButtonBuilder().setLabel('Subscribe 🔔').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@L3attaR?sub_confirmation=1'),
    );

    await ch.send({ content: `${ping} 📺 New video just dropped!`, embeds: [embed], components: [row] });
  } catch (e) {
    console.error('[YouTube]', e.message);
  }
}

function startYouTubePolling() {
  checkYouTube();
  setInterval(checkYouTube, 10 * 60 * 1000);
  console.log('📺 YouTube polling started (every 10 min) → @L3attaR');
}

// ══════════════════════════════════════════════════════════
//  SLASH COMMANDS REGISTRATION
// ══════════════════════════════════════════════════════════
async function registerCommands() {
  const cmds = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('🔧 Auto-setup the full server structure (Admin only)'),
    new SlashCommandBuilder()
      .setName('live')
      .setDescription('📡 Manually announce a stream')
      .addStringOption(o => o.setName('title').setDescription('Stream title'))
      .addStringOption(o => o.setName('game').setDescription('Game being played')),
    new SlashCommandBuilder()
      .setName('socials')
      .setDescription('🔗 Show all L3attaR social media links'),
  ].map(c => c.toJSON());

  const rest = new REST().setToken(process.env.BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
  console.log('⚡ Slash commands registered: /setup /live /socials');
}

// ── Login ────────────────────────────────────────────────
client.login(process.env.BOT_TOKEN);
