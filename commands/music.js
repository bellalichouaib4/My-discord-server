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
const YTDlpWrap = require('yt-dlp-wrap').default;
const ytSearch  = require('yt-search');
const ffmpegBin = require('ffmpeg-static');
const cp        = require('child_process');
const path      = require('path');
const fs        = require('fs');

// yt-dlp binary path
const ytDlpBin = path.join(__dirname, '..', 'bin', 'yt-dlp' + (process.platform === 'win32' ? '.exe' : ''));

async function ensureYtDlp() {
  if (fs.existsSync(ytDlpBin)) return;
  console.log('[Music] Downloading yt-dlp binary...');
  fs.mkdirSync(path.dirname(ytDlpBin), { recursive: true });
  await YTDlpWrap.downloadFromGithub(ytDlpBin);
  console.log('[Music] yt-dlp ready!');
}
ensureYtDlp().catch(e => console.error('[Music] yt-dlp download failed:', e.message));

const queues          = new Map();
const pendingSearches = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId))
    queues.set(guildId, { songs: [], player: null, connection: null, textChannel: null, proc: null });
  return queues.get(guildId);
}

function killProcs(q) {
  try { q.proc?.kill('SIGKILL'); } catch (_) {}
  q.proc = null;
}

async function playSong(guildId) {
  const q = getQueue(guildId);
  killProcs(q);

  if (!q.songs.length) {
    q.connection?.destroy();
    queues.delete(guildId);
    return;
  }

  const song = q.songs[0];
  try {
    await ensureYtDlp();
    console.log('[Music] Streaming:', song.title);

    // 1) yt-dlp → stdout (raw audio container)
    const ytProc = cp.spawn(ytDlpBin, [
      song.url,
      '-f', 'bestaudio',
      '--no-playlist',
      '-o', '-',
      '--quiet',
      '--no-warnings',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    // 2) ffmpeg: stdin ← yt-dlp stdout, stdout → raw s16le PCM for Discord
    const ffProc = cp.spawn(ffmpegBin, [
      '-i', 'pipe:0',
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    ytProc.stdout.pipe(ffProc.stdin);
    ytProc.on('error', e => console.error('[yt-dlp]', e.message));
    ffProc.on('error', e => console.error('[ffmpeg]', e.message));
    ffProc.stdin.on('error', () => {});
    ytProc.stdout.on('error', () => {});

    // store so we can kill on skip/stop
    q.proc = { kill: (sig) => { ytProc.kill(sig); ffProc.kill(sig); } };

    const resource = createAudioResource(ffProc.stdout, { inputType: StreamType.Raw });
    q.player.play(resource);

    // send Now Playing embed
    const embed = new EmbedBuilder()
      .setColor('#9146FF')
      .setTitle('🎵 Now Playing')
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: '⏱️ Duration',     value: song.duration,  inline: true },
        { name: '👤 Requested by', value: song.requester, inline: true },
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

    // ── /play
    if (cmd === 'play') {
      const vc = member.voice?.channel;
      if (!vc) return interaction.reply({ content: '❌ Join a voice channel first!', flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString('query');

      // Direct YouTube URL
      if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(query)) {
        try {
          const raw  = await cp.spawnSync(ytDlpBin, ['--dump-json', '--no-playlist', '--quiet', query], { encoding: 'utf8' });
          const info = JSON.parse(raw.stdout);
          const song = { url: query, title: info.title, duration: fmtSec(info.duration || 0), thumbnail: info.thumbnail || '', requester: member.displayName };
          return await enqueue(song, q, guild, vc, interaction);
        } catch { return interaction.editReply('❌ Could not load that URL.'); }
      }

      // Search
      try {
        const { videos } = await ytSearch(query);
        const results = videos.slice(0, 5);
        if (!results.length) return interaction.editReply('❌ No results found.');

        pendingSearches.set(interaction.user.id, { videos: results, vc, guildId: guild.id, channelId: interaction.channelId, member });
        setTimeout(() => pendingSearches.delete(interaction.user.id), 60_000);

        const embed = new EmbedBuilder()
          .setColor('#9146FF')
          .setTitle(`🔍 Results for "${query}"`)
          .setDescription(results.map((v, i) => `**${i + 1}.** [${v.title}](${v.url})\n┗ 📺 ${v.author?.name ?? '?'} · ⏱️ ${v.timestamp || '?'}`).join('\n\n'))
          .setFooter({ text: 'Pick from the dropdown · expires in 60s' });
        return interaction.editReply({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('music_search_pick')
              .setPlaceholder('🎵 Pick a song…')
              .addOptions(results.map((v, i) =>
                new StringSelectMenuOptionBuilder()
                  .setValue(String(i))
                  .setLabel(`${i + 1}. ${v.title.slice(0, 90)}`)
                  .setDescription(`${v.author?.name ?? 'Unknown'} · ${v.timestamp || '?'}`)
              ))
          )],
        });
      } catch (e) {
        console.error('[/play]', e.message);
        return interaction.editReply('❌ Search failed.');
      }
    }

    if (cmd === 'skip')   { if (!q.player) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral }); killProcs(q); q.player.stop(); return interaction.reply({ content: '⏭️ Skipped!', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'stop')   { killProcs(q); q.songs = []; q.player?.stop(); q.connection?.destroy(); queues.delete(guild.id); return interaction.reply({ content: '⏹️ Stopped and queue cleared!', flags: MessageFlags.Ephemeral }); }
    if (cmd === 'pause')  { if (!q.player) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral }); q.player.pause();   return interaction.reply({ content: '⏸️ Paused.',   flags: MessageFlags.Ephemeral }); }
    if (cmd === 'resume') { if (!q.player) return interaction.reply({ content: '❌ Nothing paused.',  flags: MessageFlags.Ephemeral }); q.player.unpause(); return interaction.reply({ content: '▶️ Resumed!', flags: MessageFlags.Ephemeral }); }
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
    q.connection  = joinVoiceChannel({ channelId: vc.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
    q.player      = createAudioPlayer();
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
  return `${m}:${String(s).padStart(2, '0')}`;
}
