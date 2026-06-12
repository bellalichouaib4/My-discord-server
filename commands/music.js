const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags
} = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, StreamType, VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');
const ytdl     = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
const ffmpeg   = require('ffmpeg-static');
const cp       = require('child_process');

const queues          = new Map();
const pendingSearches = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId))
    queues.set(guildId, { songs: [], player: null, connection: null, textChannel: null });
  return queues.get(guildId);
}

async function playSong(guildId) {
  const q = getQueue(guildId);
  if (!q.songs.length) {
    q.connection?.destroy();
    queues.delete(guildId);
    return;
  }
  const song = q.songs[0];
  try {
    console.log('[Music] Streaming:', song.url);

    // Pipe through ffmpeg to get a stable PCM/Opus stream
    const ytStream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'lowestaudio',
      highWaterMark: 1 << 25,
    });
    const ffmpegProcess = cp.spawn(ffmpeg, [
      '-i', 'pipe:0',
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });
    ytStream.pipe(ffmpegProcess.stdin);
    const resource = createAudioResource(ffmpegProcess.stdout, {
      inputType: StreamType.Raw,
    });
    q.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor('#9146FF')
      .setTitle('🎵 Now Playing')
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: '⏱️ Duration',     value: song.duration,   inline: true },
        { name: '👤 Requested by', value: song.requester,  inline: true },
        { name: '📊 Queue',        value: `${q.songs.length} song(s)`, inline: true },
      )
      .setThumbnail(song.thumbnail)
      .setFooter({ text: 'L3attaR Community · Music' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('music_pause').setLabel('⏸️ Pause').setStyle(ButtonStyle.Primary),
    );
    q.textChannel?.send({ embeds: [embed], components: [row] }).catch(() => {});
  } catch (err) {
    console.error('[Music] playSong error:', err.message);
    q.textChannel?.send({ content: `❌ Could not play **${song.title}** — skipping...` }).catch(() => {});
    q.songs.shift();
    playSong(guildId);
  }
}

module.exports = {
  queues, getQueue, playSong, pendingSearches,

  data: [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('🎵 Search YouTube and pick a song')
      .addStringOption(o => o.setName('query').setDescription('Song name or YouTube URL').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('⏭️ Skip the current song'),
    new SlashCommandBuilder().setName('stop').setDescription('⏹️ Stop music and clear the queue'),
    new SlashCommandBuilder().setName('pause').setDescription('⏸️ Pause the current song'),
    new SlashCommandBuilder().setName('resume').setDescription('▶️ Resume the paused song'),
    new SlashCommandBuilder().setName('queue').setDescription('📊 Show the music queue'),
    new SlashCommandBuilder().setName('nowplaying').setDescription('🎶 Show current song'),
  ],

  async execute(interaction) {
    const cmd    = interaction.commandName;
    const member = interaction.member;
    const guild  = interaction.guild;
    const q      = getQueue(guild.id);

    if (cmd === 'play') {
      const vc = member.voice?.channel;
      if (!vc)
        return interaction.reply({ content: '❌ Join a voice channel first!', flags: MessageFlags.Ephemeral });

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString('query');

      // Direct URL
      if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(query)) {
        try {
          const info = await ytdl.getBasicInfo(query);
          const d    = info.videoDetails;
          const song = {
            url:       query,
            title:     d.title,
            duration:  fmtSec(+d.lengthSeconds),
            thumbnail: d.thumbnails?.slice(-1)[0]?.url || '',
            requester: member.displayName,
          };
          return await enqueue(song, q, guild, vc, interaction);
        } catch (e) {
          return interaction.editReply('❌ Could not load that URL.');
        }
      }

      // Search
      try {
        const { videos } = await ytSearch(query);
        const results = videos.slice(0, 5);
        if (!results.length)
          return interaction.editReply('❌ No results found.');

        pendingSearches.set(interaction.user.id, {
          videos: results, vc, guildId: guild.id, channelId: interaction.channelId, member,
        });
        setTimeout(() => pendingSearches.delete(interaction.user.id), 60_000);

        const options = results.map((v, i) =>
          new StringSelectMenuOptionBuilder()
            .setValue(String(i))
            .setLabel(`${i + 1}. ${v.title.slice(0, 90)}`)
            .setDescription(`${v.author?.name ?? 'Unknown'} · ${v.timestamp || '?'}`)
        );
        const embed = new EmbedBuilder()
          .setColor('#9146FF')
          .setTitle(`🔍 Results for "${query}"`)
          .setDescription(
            results.map((v, i) =>
              `**${i + 1}.** [${v.title}](${v.url})\n┗ 📺 ${v.author?.name ?? '?'} · ⏱️ ${v.timestamp || '?'}`
            ).join('\n\n')
          )
          .setFooter({ text: 'Pick from the dropdown · expires in 60s' });
        return interaction.editReply({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('music_search_pick')
              .setPlaceholder('🎵 Pick a song…')
              .addOptions(options)
          )],
        });
      } catch (e) {
        console.error('[/play search]', e.message);
        return interaction.editReply('❌ Search failed.');
      }
    }

    if (cmd === 'skip')   { if (!q.player) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral }); q.player.stop(); return interaction.reply({ content: '⏭️ Skipped!', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'stop')   { q.songs = []; q.player?.stop(); q.connection?.destroy(); queues.delete(guild.id); return interaction.reply({ content: '⏹️ Stopped!', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'pause')  { if (!q.player) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral }); q.player.pause(); return interaction.reply({ content: '⏸️ Paused.', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'resume') { if (!q.player) return interaction.reply({ content: '❌ Nothing paused.', flags: MessageFlags.Ephemeral }); q.player.unpause(); return interaction.reply({ content: '▶️ Resumed!', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'queue') {
      if (!q.songs.length) return interaction.reply({ content: '💭 Queue is empty.', flags: MessageFlags.Ephemeral });
      const list = q.songs.slice(0, 10).map((s, i) => `${i === 0 ? '🔴' : `${i}.`} **${s.title}** \`${s.duration}\``).join('\n');
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9146FF').setTitle('📊 Queue').setDescription(list).setFooter({ text: `${q.songs.length} song(s)` })], flags: MessageFlags.Ephemeral });
    }
    if (cmd === 'nowplaying') {
      if (!q.songs[0]) return interaction.reply({ content: '💭 Nothing playing.', flags: MessageFlags.Ephemeral });
      const s = q.songs[0];
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#9146FF').setTitle('🎶 Now Playing').setDescription(`**[${s.title}](${s.url})**`).addFields({ name: '⏱️ Duration', value: s.duration, inline: true }, { name: '👤 Requested by', value: s.requester, inline: true }).setThumbnail(s.thumbnail)] });
    }
  },
};

async function enqueue(song, q, guild, vc, interaction) {
  q.songs.push(song);
  if (!q.connection) {
    q.connection = joinVoiceChannel({ channelId: vc.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
    q.player = createAudioPlayer();
    q.connection.subscribe(q.player);
    q.textChannel = guild.channels.cache.get(interaction.channelId);
    q.player.on(AudioPlayerStatus.Idle, () => { q.songs.shift(); playSong(guild.id); });
    q.player.on('error', err => { console.error('[Player]', err.message); q.songs.shift(); playSong(guild.id); });
    playSong(guild.id);
    return interaction.editReply({ content: `🔊 Joined **${vc.name}** — starting playback!`, embeds: [], components: [] });
  }
  return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('✅ Added to Queue').setDescription(`**[${song.title}](${song.url})**`).addFields({ name: '⏱️ Duration', value: song.duration, inline: true }, { name: '📊 Position', value: `#${q.songs.length}`, inline: true }).setThumbnail(song.thumbnail)], components: [] });
}

function fmtSec(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
