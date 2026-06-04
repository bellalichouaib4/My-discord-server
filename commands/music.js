const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState, getVoiceConnection
} = require('@discordjs/voice');
const ytdl   = require('@distube/ytdl-core');
const yts    = require('yt-search');

// ── Per-guild queue store
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) queues.set(guildId, { songs: [], player: null, connection: null, volume: 1 });
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
    const stream   = ytdl(song.url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
    const resource = createAudioResource(stream);
    q.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor('#9146FF')
      .setTitle('🎵 Now Playing')
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: '⏱️ Duration', value: song.duration || 'Live', inline: true },
        { name: '👤 Requested by', value: song.requester, inline: true },
        { name: '📊 Queue', value: `${q.songs.length} song(s)`, inline: true },
      )
      .setThumbnail(song.thumbnail)
      .setFooter({ text: 'L3attaR Community · Music' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('music_pause').setLabel('⏸️ Pause').setStyle(ButtonStyle.Primary),
    );
    await textChannel.send({ embeds: [embed], components: [row] }).catch(() => {});
  } catch (err) {
    console.error('[Music]', err.message);
    q.songs.shift();
    playSong(guildId, textChannel);
  }
}

module.exports = {
  queues,
  getQueue,
  playSong,

  data: [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('🎵 Play a song from YouTube')
      .addStringOption(o => o.setName('query').setDescription('Song name or YouTube URL').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('⏭️ Skip the current song'),
    new SlashCommandBuilder().setName('stop').setDescription('⏹️ Stop music and clear the queue'),
    new SlashCommandBuilder().setName('pause').setDescription('⏸️ Pause the current song'),
    new SlashCommandBuilder().setName('resume').setDescription('▶️ Resume the paused song'),
    new SlashCommandBuilder().setName('queue').setDescription('📊 Show the current music queue'),
    new SlashCommandBuilder().setName('nowplaying').setDescription('🎶 Show what\'s currently playing'),
  ],

  async execute(interaction) {
    const cmd     = interaction.commandName;
    const guild   = interaction.guild;
    const member  = interaction.member;
    const q       = getQueue(guild.id);

    // ── /play
    if (cmd === 'play') {
      const voiceChannel = member.voice?.channel;
      if (!voiceChannel)
        return interaction.reply({ content: '❌ Join a voice channel first!', ephemeral: true });

      await interaction.deferReply();
      const query = interaction.options.getString('query');

      try {
        let songUrl, songInfo;
        if (ytdl.validateURL(query)) {
          songUrl  = query;
          const info = await ytdl.getBasicInfo(query);
          songInfo = { title: info.videoDetails.title, duration: info.videoDetails.lengthSeconds ? formatDuration(+info.videoDetails.lengthSeconds) : 'Live', thumbnail: info.videoDetails.thumbnails.slice(-1)[0]?.url };
        } else {
          const results = await yts(query);
          const top = results.videos[0];
          if (!top) return interaction.editReply('❌ No results found.');
          songUrl  = top.url;
          songInfo = { title: top.title, duration: top.timestamp, thumbnail: top.thumbnail };
        }

        const song = { url: songUrl, title: songInfo.title, duration: songInfo.duration, thumbnail: songInfo.thumbnail, requester: member.displayName };
        q.songs.push(song);

        if (!q.connection) {
          q.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
          q.player = createAudioPlayer();
          q.connection.subscribe(q.player);

          q.player.on(AudioPlayerStatus.Idle, () => {
            q.songs.shift();
            playSong(guild.id, interaction.channel);
          });
          q.player.on('error', err => {
            console.error('[Player]', err.message);
            q.songs.shift();
            playSong(guild.id, interaction.channel);
          });

          playSong(guild.id, interaction.channel);
          return interaction.editReply({ content: `🔊 Joined **${voiceChannel.name}** and started playing!` });
        } else {
          const embed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ Added to Queue')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
              { name: '⏱️ Duration', value: song.duration || 'Live', inline: true },
              { name: '📊 Position', value: `#${q.songs.length}`, inline: true },
            )
            .setThumbnail(song.thumbnail);
          return interaction.editReply({ embeds: [embed] });
        }
      } catch (err) {
        console.error('[/play]', err.message);
        return interaction.editReply('❌ Could not play that song. Try another query.');
      }
    }

    // ── /skip
    if (cmd === 'skip') {
      if (!q.player) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
      q.player.stop();
      return interaction.reply({ content: '⏭️ Skipped!', ephemeral: true });
    }

    // ── /stop
    if (cmd === 'stop') {
      q.songs = [];
      q.player?.stop();
      q.connection?.destroy();
      queues.delete(guild.id);
      return interaction.reply({ content: '⏹️ Stopped and cleared the queue.', ephemeral: true });
    }

    // ── /pause
    if (cmd === 'pause') {
      if (!q.player) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
      q.player.pause();
      return interaction.reply({ content: '⏸️ Paused.', ephemeral: true });
    }

    // ── /resume
    if (cmd === 'resume') {
      if (!q.player) return interaction.reply({ content: '❌ Nothing is paused.', ephemeral: true });
      q.player.unpause();
      return interaction.reply({ content: '▶️ Resumed!', ephemeral: true });
    }

    // ── /queue
    if (cmd === 'queue') {
      if (!q.songs.length) return interaction.reply({ content: '💭 The queue is empty.', ephemeral: true });
      const list = q.songs.slice(0, 10).map((s, i) => `${i === 0 ? '🔴' : `${i}.`} **${s.title}** \`${s.duration}\``).join('\n');
      const embed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle('📊 Music Queue')
        .setDescription(list + (q.songs.length > 10 ? `\n...and ${q.songs.length - 10} more` : ''))
        .setFooter({ text: `${q.songs.length} song(s) total` });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── /nowplaying
    if (cmd === 'nowplaying') {
      if (!q.songs[0]) return interaction.reply({ content: '💭 Nothing is playing right now.', ephemeral: true });
      const song = q.songs[0];
      const embed = new EmbedBuilder()
        .setColor('#9146FF')
        .setTitle('🎶 Now Playing')
        .setDescription(`**[${song.title}](${song.url})**`)
        .addFields(
          { name: '⏱️ Duration', value: song.duration || 'Live', inline: true },
          { name: '👤 Requested by', value: song.requester, inline: true },
        )
        .setThumbnail(song.thumbnail);
      return interaction.reply({ embeds: [embed] });
    }
  },
};

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
