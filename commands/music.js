const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags
} = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, StreamType
} = require('@discordjs/voice');
const ytdl    = require('@distube/ytdl-core');
const playdl  = require('play-dl');
const ffmpeg  = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpeg;

const YTDL_OPTS = {
  filter: 'audioonly',
  quality: 'lowestaudio',
  highWaterMark: 1 << 25,
  requestOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  },
};

const queues = new Map();
const pendingSearches = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) queues.set(guildId, { songs: [], player: null, connection: null });
  return queues.get(guildId);
}

async function playSong(guildId, textChannel) {
  const q = getQueue(guildId);
  if (!q.songs.length) {
    q.connection?.destroy();
    queues.delete(guildId);
    return;
  }
  const song = q.songs[0];
  try {
    console.log('[Music] Streaming:', song.url);
    const stream   = ytdl(song.url, YTDL_OPTS);
    const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
    q.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor('#9146FF')
      .setTitle('🎵 Now Playing')
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: '⏱️ Duration',     value: song.duration || 'Live',     inline: true },
        { name: '👤 Requested by', value: song.requester,              inline: true },
        { name: '📊 Queue',        value: `${q.songs.length} song(s)`, inline: true },
      )
      .setThumbnail(song.thumbnail)
      .setFooter({ text: 'L3attaR Community · Music' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('music_pause').setLabel('⏸️ Pause').setStyle(ButtonStyle.Primary),
    );
    await textChannel?.send({ embeds: [embed], components: [row] }).catch(() => {});
  } catch (err) {
    console.error('[Music] playSong error:', err.message);
    textChannel?.send({ content: `❌ Could not play **${song.title}** — skipping...` }).catch(() => {});
    q.songs.shift();
    playSong(guildId, textChannel);
  }
}

module.exports = {
  queues, getQueue, playSong, pendingSearches,

  data: [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('🎵 Search YouTube and pick a song')
      .addStringOption(o => o.setName('query').setDescription('Song name, artist, or YouTube URL').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('⏭️ Skip the current song'),
    new SlashCommandBuilder().setName('stop').setDescription('⏹️ Stop music and clear the queue'),
    new SlashCommandBuilder().setName('pause').setDescription('⏸️ Pause the current song'),
    new SlashCommandBuilder().setName('resume').setDescription('▶️ Resume the paused song'),
    new SlashCommandBuilder().setName('queue').setDescription('📊 Show the current music queue'),
    new SlashCommandBuilder().setName('nowplaying').setDescription('🎶 Show what\'s currently playing'),
  ],

  async execute(interaction) {
    const cmd    = interaction.commandName;
    const guild  = interaction.guild;
    const member = interaction.member;
    const q      = getQueue(guild.id);

    if (cmd === 'play') {
      const voiceChannel = member.voice?.channel;
      if (!voiceChannel)
        return interaction.reply({ content: '❌ Join a voice channel first!', flags: MessageFlags.Ephemeral });

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString('query');

      // Direct YouTube URL — use ytdl
      if (ytdl.validateURL(query)) {
        try {
          const info = await ytdl.getBasicInfo(query, YTDL_OPTS);
          const d    = info.videoDetails;
          const song = {
            url:       query,
            title:     d.title,
            duration:  d.lengthSeconds ? fmtDur(+d.lengthSeconds) : 'Live',
            thumbnail: d.thumbnails?.slice(-1)[0]?.url || '',
            requester: member.displayName,
          };
          return await enqueueSong(song, q, guild, voiceChannel, interaction);
        } catch (e) {
          console.error('[/play URL]', e.message);
          return interaction.editReply('❌ Could not load that URL. Try a search instead.');
        }
      }

      // Search — use play-dl (search only, not streaming)
      try {
        const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 5 });
        if (!results.length) return interaction.editReply('❌ No results found. Try a different search.');

        pendingSearches.set(interaction.user.id, {
          videos:         results,
          voiceChannelId: voiceChannel.id,
          guildId:        guild.id,
          channelId:      interaction.channelId,
        });
        setTimeout(() => pendingSearches.delete(interaction.user.id), 60_000);

        const options = results.map((v, i) =>
          new StringSelectMenuOptionBuilder()
            .setValue(String(i))
            .setLabel(`${i + 1}. ${v.title.slice(0, 90)}`)
            .setDescription(`${v.channel?.name ?? 'Unknown'} · ${v.durationRaw || '?'}`)
        );

        const embed = new EmbedBuilder()
          .setColor('#9146FF')
          .setTitle(`🔍 Results for "${query}"`)
          .setDescription(
            results.map((v, i) =>
              `**${i + 1}.** [${v.title}](${v.url})\n` +
              `┗ 📺 ${v.channel?.name ?? 'Unknown'} · ⏱️ ${v.durationRaw || '?'} · 👁️ ${fmtViews(v.views)}`
            ).join('\n\n')
          )
          .setFooter({ text: 'Pick from the dropdown · expires in 60s' });

        const menu = new StringSelectMenuBuilder()
          .setCustomId('music_search_pick')
          .setPlaceholder('🎵 Pick a song…')
          .addOptions(options);

        return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
      } catch (err) {
        console.error('[/play search]', err.message);
        return interaction.editReply('❌ Search failed. Try again.');
      }
    }

    if (cmd === 'skip')      { if (!q.player) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral }); q.player.stop(); return interaction.reply({ content: '⏭️ Skipped!', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'stop')      { q.songs = []; q.player?.stop(); q.connection?.destroy(); queues.delete(guild.id); return interaction.reply({ content: '⏹️ Stopped!', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'pause')     { if (!q.player) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral }); q.player.pause(); return interaction.reply({ content: '⏸️ Paused.', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'resume')    { if (!q.player) return interaction.reply({ content: '❌ Nothing paused.', flags: MessageFlags.Ephemeral }); q.player.unpause(); return interaction.reply({ content: '▶️ Resumed!', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'queue') {
      if (!q.songs.length) return interaction.reply({ content: '💭 Queue is empty.', flags: MessageFlags.Ephemeral });
      const list = q.songs.slice(0, 10).map((s, i) => `${i === 0 ? '🔴' : `${i}.`} **${s.title}** \`${s.duration}\``).join('\n');
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9146FF').setTitle('📊 Queue').setDescription(list + (q.songs.length > 10 ? `\n+${q.songs.length - 10} more` : '')).setFooter({ text: `${q.songs.length} song(s)` })], flags: MessageFlags.Ephemeral });
    }
    if (cmd === 'nowplaying') {
      if (!q.songs[0]) return interaction.reply({ content: '💭 Nothing playing.', flags: MessageFlags.Ephemeral });
      const s = q.songs[0];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9146FF').setTitle('🎶 Now Playing').setDescription(`**[${s.title}](${s.url})**`).addFields({ name: '⏱️ Duration', value: s.duration || 'Live', inline: true }, { name: '👤 Requested by', value: s.requester, inline: true }).setThumbnail(s.thumbnail)] });
    }
  },
};

async function enqueueSong(song, q, guild, voiceChannel, interaction) {
  q.songs.push(song);
  if (!q.connection) {
    q.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
    q.player = createAudioPlayer();
    q.connection.subscribe(q.player);
    const textChannel = guild.channels.cache.get(interaction.channelId);
    q.player.on(AudioPlayerStatus.Idle, () => { q.songs.shift(); playSong(guild.id, textChannel); });
    q.player.on('error', err => { console.error('[Player]', err.message); q.songs.shift(); playSong(guild.id, textChannel); });
    playSong(guild.id, textChannel);
    return interaction.editReply({ content: `🔊 Joined **${voiceChannel.name}** — starting playback!`, embeds: [], components: [] });
  }
  const embed = new EmbedBuilder().setColor('#57F287').setTitle('✅ Added to Queue')
    .setDescription(`**[${song.title}](${song.url})**`)
    .addFields({ name: '⏱️ Duration', value: song.duration || 'Live', inline: true }, { name: '📊 Position', value: `#${q.songs.length}`, inline: true })
    .setThumbnail(song.thumbnail);
  return interaction.editReply({ embeds: [embed], components: [] });
}

function fmtDur(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${s.toString().padStart(2, '0')}`; }
function fmtViews(n) { if (!n) return '?'; if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`; if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`; return String(n); }
