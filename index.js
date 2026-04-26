require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Events,
  PermissionFlagsBits, REST, Routes, SlashCommandBuilder,
  ActivityType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ChannelType
} = require('discord.js');
const axios  = require('axios');
const Parser = require('rss-parser');
const config = require('./config.json');
const setupGuild = require('./setup');

const INSTAGRAM = 'https://www.instagram.com/l3attar/';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

let twitchToken = null, wasLive = false, lastVideoId = null;
const rss = new Parser();
const j2cChannels = new Map();

client.once(Events.ClientReady, async () => {
  console.log(`\n🤖 L3attaR Bot online: ${client.user.tag}`);
  client.user.setActivity('🔴 twitch.tv/l3attar_', { type: ActivityType.Streaming, url: 'https://twitch.tv/l3attar_' });
  await registerCommands();
  const hasYT = config.youtube?.channelId && !config.youtube.channelId.startsWith('YOUR');
  const hasTW = config.twitch?.clientId && !config.twitch.clientId.startsWith('YOUR');
  if (hasTW) startTwitchPolling(); else console.log('⚠️  Twitch keys not set — polling skipped');
  if (hasYT) startYouTubePolling(); else console.log('⚠️  YouTube channel ID not set — polling skipped');
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const guild = member.guild;
    const unverRole = guild.roles.cache.find(r => r.name === '🔒 Unverified');
    if (unverRole) await member.roles.add(unverRole).catch(() => {});
    const welcomeCh = guild.channels.cache.find(c => c.name === '👋・welcome');
    if (!welcomeCh) return;
    const verifyId = guild.channels.cache.find(c => c.name === '🔒・verify')?.id;
    const rulesId  = guild.channels.cache.find(c => c.name === '📜・rules')?.id;
    const embed = new EmbedBuilder()
      .setColor('#9146FF')
      .setAuthor({ name: 'L3attaR Community', iconURL: guild.iconURL() ?? undefined })
      .setTitle(`👋 Welcome, ${member.displayName}!`)
      .setDescription(
        `You just joined **${guild.name}** — the official community of **L3attaR**! 🎮\n\n` +
        `**Before you can chat, you need to verify:**\n` +
        `${verifyId ? `> 🔒 Head to <#${verifyId}> and click **Verify Me**` : ''}\n\n` +
        `${rulesId  ? `> 📜 Read the rules at <#${rulesId}> first` : ''}\n\n` +
        `**Follow L3attaR:**\n` +
        `🔴 [Twitch](https://twitch.tv/l3attar_) · ` +
        `📺 [YouTube](https://www.youtube.com/@L3attaR) · ` +
        `📸 [Instagram](${INSTAGRAM}) · ` +
        `🎵 [TikTok](https://www.tiktok.com/@l3attar_b)`
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setFooter({ text: `Member #${guild.memberCount}` })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Verify Now 🔒').setStyle(ButtonStyle.Success).setCustomId('verify_btn'),
      new ButtonBuilder().setLabel('Watch Live 🔴').setStyle(ButtonStyle.Link).setURL('https://twitch.tv/l3attar_'),
    );
    await welcomeCh.send({ content: `Hey ${member}! 👋`, embeds: [embed], components: [row] });
  } catch (e) { console.error('[Welcome]', e.message); }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const guild  = newState.guild || oldState.guild;
    const j2cHub = guild.channels.cache.find(c => c.name === '➕ Create Room');
    if (newState.channelId && j2cHub && newState.channelId === j2cHub.id) {
      const member = newState.member;
      const newCh  = await guild.channels.create({
        name: `🎮 ${member.displayName}'s Room`,
        type: ChannelType.GuildVoice,
        parent: j2cHub.parentId,
        userLimit: 10,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: guild.roles.cache.find(r => r.name === '✅ Membre')?.id ?? guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
          { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.ManageChannels] },
        ].filter(p => p.id),
      });
      await member.voice.setChannel(newCh);
      j2cChannels.set(member.id, newCh.id);
    }
    if (oldState.channelId) {
      const leftCh = guild.channels.cache.get(oldState.channelId);
      if (leftCh && leftCh.name.includes("'s Room") && leftCh.members.size === 0) {
        await leftCh.delete().catch(() => {});
        for (const [uid, cid] of j2cChannels) if (cid === leftCh.id) j2cChannels.delete(uid);
      }
    }
  } catch (e) { console.error('[J2C]', e.message); }
});

client.on(Events.PresenceUpdate, async (oldP, newP) => {
  try {
    if (!newP.guild) return;
    const liveRole = newP.guild.roles.cache.find(r => r.name === '🔴 Live Now');
    if (!liveRole) return;
    const member = await newP.guild.members.fetch(newP.userId).catch(() => null);
    if (!member) return;
    const isNow = newP.activities?.some(a => a.type === ActivityType.Streaming);
    const wasB  = oldP?.activities?.some(a => a.type === ActivityType.Streaming);
    if (isNow && !wasB)  await member.roles.add(liveRole).catch(() => {});
    if (!isNow && wasB)  await member.roles.remove(liveRole).catch(() => {});
  } catch (e) { console.error('[Presence]', e.message); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
      const { guild, member } = interaction;
      const memberRole = guild.roles.cache.find(r => r.name === '✅ Membre');
      const unverRole  = guild.roles.cache.find(r => r.name === '🔒 Unverified');
      if (memberRole && member.roles.cache.has(memberRole.id))
        return interaction.reply({ content: '✅ You are already verified!', ephemeral: true });
      if (memberRole)  await member.roles.add(memberRole).catch(() => {});
      if (unverRole)   await member.roles.remove(unverRole).catch(() => {});
      return interaction.reply({ content: '✅ **Verified!** Welcome to the L3attaR community — all channels are now unlocked! 🎉', ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'notif_roles') {
      const { guild, member } = interaction;
      const streamRole = guild.roles.cache.find(r => r.name === '🔔 Stream Alerts');
      const videoRole  = guild.roles.cache.find(r => r.name === '🔔 Video Alerts');
      const sel = interaction.values;
      if (streamRole) sel.includes('stream') ? await member.roles.add(streamRole).catch(() => {}) : await member.roles.remove(streamRole).catch(() => {});
      if (videoRole)  sel.includes('video')  ? await member.roles.add(videoRole).catch(() => {})  : await member.roles.remove(videoRole).catch(() => {});
      const labels = sel.map(s => s === 'stream' ? '🔔 Stream Alerts' : '🔔 Video Alerts');
      return interaction.reply({ content: sel.length ? `✅ You now have: **${labels.join(', ')}**` : '✅ All notifications removed.', ephemeral: true });
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Administrator permission required.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      await setupGuild(interaction.guild);
      return interaction.editReply('✅ Server fully set up!');
    }

    if (interaction.commandName === 'resetserver') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Administrator permission required.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;
      for (const [, ch] of guild.channels.cache)   await ch.delete().catch(() => {});
      for (const [, r]  of guild.roles.cache) {
        if (r.id !== guild.roles.everyone.id && !r.managed) await r.delete().catch(() => {});
      }
      await setupGuild(guild);
      return interaction.editReply('✅ Server wiped and rebuilt from scratch!');
    }

    if (interaction.commandName === 'live') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages))
        return interaction.reply({ content: '❌ Manage Messages permission required.', ephemeral: true });
      await announceStream(interaction.guild, {
        user_name: 'l3attar_',
        title:     interaction.options.getString('title') || '🔴 Come watch — live now!',
        game_name: interaction.options.getString('game')  || 'Valorant',
        viewer_count: 0,
      });
      return interaction.reply({ content: '✅ Stream announced!', ephemeral: true });
    }

    if (interaction.commandName === 'socials') {
      const embed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle('🔗 L3attaR — All Socials')
        .addFields(
          { name: '🔴 Twitch',    value: '[twitch.tv/l3attar_](https://twitch.tv/l3attar_)',       inline: true },
          { name: '📺 YouTube',   value: '[@L3attaR](https://www.youtube.com/@L3attaR)',            inline: true },
          { name: '📸 Instagram', value: `[l3attar](${INSTAGRAM})`,                                inline: true },
          { name: '🎵 TikTok',    value: '[@l3attar_b](https://www.tiktok.com/@l3attar_b)',        inline: true },
          { name: '📘 Facebook',  value: '[L3attar01](https://www.facebook.com/L3attar01/)',        inline: true },
        ).setFooter({ text: 'Follow for streams, clips & highlights!' });
      return interaction.reply({ embeds: [embed] });
    }
  } catch (e) { console.error('[Interaction]', e.message); }
});

async function getTwitchToken() {
  const r = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: { client_id: config.twitch.clientId, client_secret: config.twitch.clientSecret, grant_type: 'client_credentials' },
  });
  twitchToken = r.data.access_token;
}
async function checkTwitch() {
  try {
    if (!twitchToken) await getTwitchToken();
    const r = await axios.get('https://api.twitch.tv/helix/streams?user_login=l3attar_', {
      headers: { 'Client-ID': config.twitch.clientId, Authorization: `Bearer ${twitchToken}` },
    });
    const stream = r.data.data[0];
    const guild  = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    if (stream && !wasLive) { wasLive = true;  await announceStream(guild, stream); }
    if (!stream && wasLive) { wasLive = false; await announceStreamEnd(guild); }
  } catch (e) {
    if (e.response?.status === 401) twitchToken = null;
  }
}
async function announceStream(guild, stream) {
  const ch = guild.channels.cache.find(c => c.name === '📡・stream-alerts');
  if (!ch) return;
  const role = guild.roles.cache.find(r => r.name === '🔔 Stream Alerts');
  const ping = role ? `<@&${role.id}>` : '@everyone';
  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle(`🔴 L3attaR is LIVE!`)
    .setDescription(`**${stream.title}**`)
    .addFields(
      { name: '🎮 Playing', value: stream.game_name || 'Valorant', inline: true },
      { name: '👥 Viewers', value: String(stream.viewer_count ?? 0), inline: true },
    )
    .setURL('https://twitch.tv/l3attar_')
    .setImage(`https://static-cdn.jtvnw.net/previews-ttv/live_user_l3attar_-1280x720.jpg?v=${Date.now()}`)
    .setFooter({ text: 'L3attaR · Valorant Streamer · twitch.tv/l3attar_' })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Watch Live 🔴').setStyle(ButtonStyle.Link).setURL('https://twitch.tv/l3attar_'),
    new ButtonBuilder().setLabel('YouTube 📺').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@L3attaR'),
    new ButtonBuilder().setLabel('Instagram 📸').setStyle(ButtonStyle.Link).setURL(INSTAGRAM),
  );
  await ch.send({ content: `${ping} 🔴 **L3attaR is LIVE on Twitch!**`, embeds: [embed], components: [row] });
}
async function announceStreamEnd(guild) {
  const ch = guild.channels.cache.find(c => c.name === '📡・stream-alerts');
  if (!ch) return;
  const embed = new EmbedBuilder()
    .setColor('#6441a5')
    .setTitle('📴 Stream Ended')
    .setDescription('Thanks for watching! Catch the VOD on [YouTube](https://www.youtube.com/@L3attaR) soon. 🎬')
    .setFooter({ text: 'L3attaR · See you next time!' })
    .setTimestamp();
  await ch.send({ embeds: [embed] });
}
function startTwitchPolling() {
  checkTwitch();
  setInterval(checkTwitch, 2 * 60 * 1000);
  console.log('📡 Twitch polling active → l3attar_');
}

async function checkYouTube() {
  try {
    const feed   = await rss.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${config.youtube.channelId}`);
    const latest = feed.items[0];
    if (!latest || latest.id === lastVideoId) return;
    lastVideoId = latest.id;
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    const ch = guild.channels.cache.find(c => c.name === '📺・youtube-videos');
    if (!ch) return;
    const role = guild.roles.cache.find(r => r.name === '🔔 Video Alerts');
    const ping = role ? `<@&${role.id}>` : '';
    const vid   = latest.id.split(':').pop();
    const thumb = latest['media:group']?.['media:thumbnail']?.[0]?.['$']?.url || `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle(latest.title)
      .setURL(latest.link)
      .setImage(thumb)
      .setFooter({ text: 'L3attaR · YouTube' })
      .setTimestamp(new Date(latest.pubDate));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Watch ▶️').setStyle(ButtonStyle.Link).setURL(latest.link),
      new ButtonBuilder().setLabel('Subscribe 🔔').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@L3attaR?sub_confirmation=1'),
    );
    await ch.send({ content: `${ping} 📺 **New video just dropped!**`, embeds: [embed], components: [row] });
  } catch (e) { console.error('[YouTube]', e.message); }
}
function startYouTubePolling() {
  checkYouTube();
  setInterval(checkYouTube, 10 * 60 * 1000);
  console.log('📺 YouTube polling active → @L3attaR');
}

async function registerCommands() {
  const cmds = [
    new SlashCommandBuilder().setName('setup').setDescription('🔧 Build the full server (Admin only)'),
    new SlashCommandBuilder().setName('resetserver').setDescription('🔄 Wipe and rebuild server (Admin only)'),
    new SlashCommandBuilder().setName('live').setDescription('📡 Manually announce a stream')
      .addStringOption(o => o.setName('title').setDescription('Stream title'))
      .addStringOption(o => o.setName('game').setDescription('Game being played')),
    new SlashCommandBuilder().setName('socials').setDescription('🔗 Show all L3attaR social links'),
  ].map(c => c.toJSON());
  const rest = new REST().setToken(process.env.BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
  console.log('⚡ Slash commands ready');
}

client.login(process.env.BOT_TOKEN);
