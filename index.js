require('dotenv').config();

// Point DisTube (and yt-dlp) to the bundled ffmpeg BEFORE any other require
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;
process.env.PATH = `${require('path').dirname(ffmpegPath)}${require('path').delimiter}${process.env.PATH}`;

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Events,
  PermissionFlagsBits, REST, Routes, SlashCommandBuilder,
  ActivityType, ChannelType, Collection, MessageFlags,
} = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const axios  = require('axios');
const Parser = require('rss-parser');
const fs     = require('fs');
const path   = require('path');
const config = require('./config.json');
const setupGuild = require('./setup');
const { GAME_ROLES } = require('./commands/gameroles');
const { pendingSearches } = require('./commands/music');
const { handleAntiSpam, handleBadWords, handleInviteLinks, handleAntiRaid, unlockServer } = require('./automod');

const INSTAGRAM = 'https://www.instagram.com/l3attar/';
const GUILD_ID  = config.guildId;

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

// ── DisTube
const distube = new DisTube(client, {
  plugins: [new YtDlpPlugin({ update: false })],
  emitNewSongOnly: true,
  joinNewVoiceChannel: true,
});

distube
  .on('playSong', (queue, song) => {
    const embed = new EmbedBuilder()
      .setColor('#9146FF')
      .setTitle('🎵 Now Playing')
      .setDescription(`**[${song.name}](${song.url})**`)
      .addFields(
        { name: '⏱️ Duration',     value: song.formattedDuration, inline: true },
        { name: '👤 Requested by', value: song.member?.displayName ?? 'Unknown', inline: true },
        { name: '📊 Queue',        value: `${queue.songs.length} song(s)`, inline: true },
      )
      .setThumbnail(song.thumbnail)
      .setFooter({ text: 'L3attaR Community · Music' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('music_pause').setLabel('⏸️ Pause').setStyle(ButtonStyle.Primary),
    );
    queue.textChannel?.send({ embeds: [embed], components: [row] }).catch(() => {});
  })
  .on('addSong', (queue, song) => {
    const embed = new EmbedBuilder().setColor('#57F287').setTitle('✅ Added to Queue')
      .setDescription(`**[${song.name}](${song.url})**`)
      .addFields(
        { name: '⏱️ Duration', value: song.formattedDuration, inline: true },
        { name: '📊 Position', value: `#${queue.songs.length}`, inline: true },
      )
      .setThumbnail(song.thumbnail);
    queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
  })
  .on('error', (channel, error) => {
    console.error('[DisTube]', error.message);
    channel?.send(`❌ Music error: ${error.message}`).catch(() => {});
  })
  .on('finish', queue => queue.textChannel?.send('⏹️ Queue finished!').catch(() => {}));

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const mod = require(path.join(commandsPath, file));
    const cmds = Array.isArray(mod.data)
      ? mod.data.map(d => ({ data: d, execute: (i) => mod.execute(i, distube) }))
      : (mod?.data && mod?.execute ? [{ data: mod.data, execute: (i) => mod.execute(i, distube) }] : []);
    for (const cmd of cmds) client.commands.set(cmd.data.name, cmd);
  }
}

let twitchToken = null, wasLive = false, lastVideoId = null;
const rss = new Parser();
const j2cChannels = new Map();

client.once(Events.ClientReady, async () => {
  console.log(`\n🤖 L3attaR Bot online: ${client.user.tag}`);
  client.user.setActivity('🔴 twitch.tv/l3attar_', { type: ActivityType.Streaming, url: 'https://twitch.tv/l3attar_' });
  await registerCommands();
  const hasYT = config.youtube?.channelId && !config.youtube.channelId.startsWith('YOUR');
  const hasTW = config.twitch?.clientId  && !config.twitch.clientId.startsWith('YOUR');
  if (hasTW) startTwitchPolling(); else console.log('⚠️  Twitch keys not set — polling skipped');
  if (hasYT) startYouTubePolling(); else console.log('⚠️  YouTube channel ID not set — polling skipped');
  console.log('🛡️  AutoMod active — anti-spam, bad words, invites, anti-raid');
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  handleAntiSpam(message);
  await handleBadWords(message);
  await handleInviteLinks(message);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    handleAntiRaid(member);
    const guild = member.guild;
    const unverRole = guild.roles.cache.find(r => r.name === '🔒 Unverified');
    if (unverRole) await member.roles.add(unverRole).catch(() => {});
    const welcomeCh = guild.channels.cache.find(c => c.name === '👋・welcome');
    if (welcomeCh) {
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
    }
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle('👋 Welcome to the L3attaR Community!')
        .setDescription(
          `Hey **${member.displayName}**, thanks for joining **${member.guild.name}**! 🎉\n\n` +
          `Here's how to get started:\n` +
          `> 1️⃣ **Verify** yourself in the server to unlock all channels\n` +
          `> 2️⃣ **Read the rules** to stay safe and have fun\n` +
          `> 3️⃣ **Pick your notifications** so you never miss a stream or video\n\n` +
          `**Follow L3attaR everywhere:**\n` +
          `🔴 [Twitch](https://twitch.tv/l3attar_) · ` +
          `📺 [YouTube](https://www.youtube.com/@L3attaR) · ` +
          `📸 [Instagram](${INSTAGRAM}) · ` +
          `🎵 [TikTok](https://www.tiktok.com/@l3attar_b)\n\n` +
          `*See you in the server — Let's get this! 🎮*`
        )
        .setThumbnail(member.guild.iconURL())
        .setFooter({ text: 'L3attaR Community · Built with ❤️' })
        .setTimestamp();
      await member.user.send({ embeds: [dmEmbed] });
    } catch (_) {}
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
    // ── verify button
    if (interaction.isButton() && interaction.customId === 'verify_btn') {
      const { guild, member } = interaction;
      const memberRole = guild.roles.cache.find(r => r.name === '✅ Membre');
      const unverRole  = guild.roles.cache.find(r => r.name === '🔒 Unverified');
      if (memberRole && member.roles.cache.has(memberRole.id))
        return interaction.reply({ content: '✅ You are already verified!', flags: MessageFlags.Ephemeral });
      if (memberRole) await member.roles.add(memberRole).catch(() => {});
      if (unverRole)  await member.roles.remove(unverRole).catch(() => {});
      return interaction.reply({ content: '✅ **Verified!** Welcome to the L3attaR community — all channels are now unlocked! 🎉', flags: MessageFlags.Ephemeral });
    }

    // ── music buttons
    if (interaction.isButton() && ['music_skip','music_stop','music_pause'].includes(interaction.customId)) {
      const queue = distube.getQueue(interaction.guild);
      if (!queue) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral });
      if (interaction.customId === 'music_skip')  { await distube.skip(interaction.guild);  return interaction.reply({ content: '⏭️ Skipped!',  flags: MessageFlags.Ephemeral }); }
      if (interaction.customId === 'music_stop')  { await distube.stop(interaction.guild);  return interaction.reply({ content: '⏹️ Stopped!',  flags: MessageFlags.Ephemeral }); }
      if (interaction.customId === 'music_pause') {
        queue.paused ? distube.resume(interaction.guild) : distube.pause(interaction.guild);
        return interaction.reply({ content: queue.paused ? '▶️ Resumed!' : '⏸️ Paused!', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    // ── music search dropdown
    if (interaction.isStringSelectMenu() && interaction.customId === 'music_search_pick') {
      const pending = pendingSearches.get(interaction.user.id);
      if (!pending) return interaction.reply({ content: '❌ Search expired. Run `/play` again.', flags: MessageFlags.Ephemeral });
      pendingSearches.delete(interaction.user.id);
      await interaction.deferUpdate();
      const { videos, channelId } = pending;
      const video = videos[parseInt(interaction.values[0], 10)];
      const vc    = interaction.member.voice?.channel;
      if (!vc) return interaction.editReply({ content: '❌ Join a voice channel first!', embeds: [], components: [] });
      try {
        await distube.play(vc, video.url, { member: interaction.member, textChannel: interaction.guild.channels.cache.get(channelId) });
        return interaction.editReply({ content: `🔊 Queued **${video.title}**!`, embeds: [], components: [] });
      } catch (e) {
        console.error('[music pick]', e.message);
        return interaction.editReply({ content: `❌ Could not play: ${e.message}`, embeds: [], components: [] });
      }
    }

    // ── notification roles
    if (interaction.isStringSelectMenu() && interaction.customId === 'notif_roles') {
      const { guild, member } = interaction;
      const streamRole = guild.roles.cache.find(r => r.name === '🔔 Stream Alerts');
      const videoRole  = guild.roles.cache.find(r => r.name === '🔔 Video Alerts');
      const sel = interaction.values;
      if (streamRole) sel.includes('stream') ? await member.roles.add(streamRole).catch(() => {}) : await member.roles.remove(streamRole).catch(() => {});
      if (videoRole)  sel.includes('video')  ? await member.roles.add(videoRole).catch(() => {})  : await member.roles.remove(videoRole).catch(() => {});
      const labels = sel.map(s => s === 'stream' ? '🔔 Stream Alerts' : '🔔 Video Alerts');
      return interaction.reply({ content: sel.length ? `✅ You now have: **${labels.join(', ')}**` : '✅ All notifications removed.', flags: MessageFlags.Ephemeral });
    }

    // ── game roles
    if (interaction.isStringSelectMenu() && interaction.customId === 'game_roles') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { guild, member } = interaction;
      const selected = interaction.values;
      const assigned = [], removed = [];
      for (const game of GAME_ROLES) {
        let role = guild.roles.cache.find(r => r.name === game.label);
        if (!role) role = await guild.roles.create({ name: game.label, color: game.color, hoist: false, mentionable: false }).catch(() => null);
        if (!role) continue;
        if (selected.includes(game.value)) { await member.roles.add(role).catch(() => {}); assigned.push(game.label); }
        else { await member.roles.remove(role).catch(() => {}); removed.push(game.label); }
      }
      return interaction.editReply({ content: assigned.length
        ? `✅ Roles updated!\n**Added:** ${assigned.join(', ')}${removed.length ? `\n**Removed:** ${removed.join(', ')}` : ''}`
        : '✅ All game roles removed.' });
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = client.commands.get(interaction.commandName);
    if (cmd) return await cmd.execute(interaction);

    if (interaction.commandName === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await setupGuild(interaction.guild);
      return interaction.editReply('✅ Server fully set up!');
    }
    if (interaction.commandName === 'resetserver') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      for (const [, ch] of interaction.guild.channels.cache) await ch.delete().catch(() => {});
      for (const [, r]  of interaction.guild.roles.cache)    if (r.id !== interaction.guild.roles.everyone.id && !r.managed) await r.delete().catch(() => {});
      await setupGuild(interaction.guild);
      return interaction.editReply('✅ Server wiped and rebuilt!');
    }
    if (interaction.commandName === 'live') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ No permission.', flags: MessageFlags.Ephemeral });
      await announceStream(interaction.guild, { title: interaction.options.getString('title') || '🔴 Live now!', game_name: interaction.options.getString('game') || 'Valorant', viewer_count: 0 });
      return interaction.reply({ content: '✅ Announced!', flags: MessageFlags.Ephemeral });
    }
    if (interaction.commandName === 'socials') {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9146FF').setTitle('🔗 L3attaR — All Socials')
        .addFields(
          { name: '🔴 Twitch',    value: '[twitch.tv/l3attar_](https://twitch.tv/l3attar_)', inline: true },
          { name: '📺 YouTube',   value: '[@L3attaR](https://www.youtube.com/@L3attaR)',      inline: true },
          { name: '📸 Instagram', value: `[l3attar](${INSTAGRAM})`,                          inline: true },
          { name: '🎵 TikTok',    value: '[@l3attar_b](https://www.tiktok.com/@l3attar_b)',  inline: true },
        )] });
    }
    if (interaction.commandName === 'unlock') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await unlockServer(interaction.guild);
      return interaction.editReply('✅ Server unlocked!');
    }
  } catch (e) { console.error('[Interaction]', e.message); }
});

async function getTwitchToken() {
  const r = await axios.post('https://id.twitch.tv/oauth2/token', null, { params: { client_id: config.twitch.clientId, client_secret: config.twitch.clientSecret, grant_type: 'client_credentials' } });
  twitchToken = r.data.access_token;
}
async function checkTwitch() {
  try {
    if (!twitchToken) await getTwitchToken();
    const r = await axios.get('https://api.twitch.tv/helix/streams?user_login=l3attar_', { headers: { 'Client-ID': config.twitch.clientId, Authorization: `Bearer ${twitchToken}` } });
    const stream = r.data.data[0];
    const guild  = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    if (stream && !wasLive) { wasLive = true;  await announceStream(guild, stream); }
    if (!stream && wasLive) { wasLive = false; await announceStreamEnd(guild); }
  } catch (e) { if (e.response?.status === 401) twitchToken = null; }
}
async function announceStream(guild, stream) {
  const ch = guild.channels.cache.find(c => c.name === '📡・stream-alerts');
  if (!ch) return;
  const role = guild.roles.cache.find(r => r.name === '🔔 Stream Alerts');
  const ping = role ? `<@&${role.id}>` : '@everyone';
  const embed = new EmbedBuilder().setColor('#9146FF').setTitle('🔴 L3attaR is LIVE!')
    .setDescription(`**${stream.title}**`)
    .addFields({ name: '🎮 Playing', value: stream.game_name || 'Valorant', inline: true }, { name: '👥 Viewers', value: String(stream.viewer_count ?? 0), inline: true })
    .setURL('https://twitch.tv/l3attar_')
    .setImage(`https://static-cdn.jtvnw.net/previews-ttv/live_user_l3attar_-1280x720.jpg?v=${Date.now()}`)
    .setFooter({ text: 'L3attaR · Valorant Streamer' }).setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Watch Live 🔴').setStyle(ButtonStyle.Link).setURL('https://twitch.tv/l3attar_'),
    new ButtonBuilder().setLabel('YouTube 📺').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@L3attaR'),
  );
  await ch.send({ content: `${ping} 🔴 **L3attaR is LIVE on Twitch!**`, embeds: [embed], components: [row] });
}
async function announceStreamEnd(guild) {
  const ch = guild.channels.cache.find(c => c.name === '📡・stream-alerts');
  if (!ch) return;
  await ch.send({ embeds: [new EmbedBuilder().setColor('#6441a5').setTitle('📴 Stream Ended').setDescription('Thanks for watching! VOD coming soon on [YouTube](https://www.youtube.com/@L3attaR). 🎬').setTimestamp()] });
}
function startTwitchPolling()  { checkTwitch();   setInterval(checkTwitch,   2  * 60 * 1000); console.log('📡 Twitch polling active → l3attar_'); }

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
    const role  = guild.roles.cache.find(r => r.name === '🔔 Video Alerts');
    const ping  = role ? `<@&${role.id}>` : '';
    const vid   = latest.id.split(':').pop();
    const thumb = latest['media:group']?.['media:thumbnail']?.[0]?.['$']?.url || `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg`;
    const embed = new EmbedBuilder().setColor('#FF0000').setTitle(latest.title).setURL(latest.link).setImage(thumb).setFooter({ text: 'L3attaR · YouTube' }).setTimestamp(new Date(latest.pubDate));
    const row   = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Watch ▶️').setStyle(ButtonStyle.Link).setURL(latest.link),
      new ButtonBuilder().setLabel('Subscribe 🔔').setStyle(ButtonStyle.Link).setURL('https://www.youtube.com/@L3attaR?sub_confirmation=1'),
    );
    await ch.send({ content: `${ping} 📺 **New video just dropped!**`, embeds: [embed], components: [row] });
  } catch (e) { console.error('[YouTube]', e.message); }
}
function startYouTubePolling() { checkYouTube(); setInterval(checkYouTube, 10 * 60 * 1000); console.log('📺 YouTube polling active → @L3attaR'); }

async function registerCommands() {
  const dynamicCmds = [];
  if (fs.existsSync(commandsPath)) {
    for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
      const mod = require(path.join(commandsPath, file));
      if (Array.isArray(mod.data)) dynamicCmds.push(...mod.data.map(d => d.toJSON()));
      else if (mod?.data) dynamicCmds.push(mod.data.toJSON());
    }
  }
  const builtinCmds = [
    new SlashCommandBuilder().setName('setup').setDescription('🔧 Build the full server (Admin only)'),
    new SlashCommandBuilder().setName('resetserver').setDescription('🔄 Wipe and rebuild server (Admin only)'),
    new SlashCommandBuilder().setName('live').setDescription('📡 Manually announce a stream')
      .addStringOption(o => o.setName('title').setDescription('Stream title'))
      .addStringOption(o => o.setName('game').setDescription('Game being played')),
    new SlashCommandBuilder().setName('socials').setDescription('🔗 Show all L3attaR social links'),
    new SlashCommandBuilder().setName('unlock').setDescription('🔓 Lift raid lockdown (Admin only)'),
  ].map(c => c.toJSON());
  const allCmds = [...builtinCmds, ...dynamicCmds];
  const rest = new REST().setToken(process.env.BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: allCmds });
  console.log(`⚡ Slash commands ready (${allCmds.length} total) — guild-scoped → instant!`);
}

client.login(process.env.BOT_TOKEN);
