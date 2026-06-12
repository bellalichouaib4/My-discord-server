const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags
} = require('discord.js');
const playdl = require('play-dl');

const pendingSearches = new Map();

module.exports = {
  pendingSearches,

  data: [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('🎵 Search YouTube and pick a song')
      .addStringOption(o => o.setName('query').setDescription('Song name, artist, or YouTube URL').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('⏭️ Skip the current song'),
    new SlashCommandBuilder().setName('stop').setDescription('⏹️ Stop music and clear the queue'),
    new SlashCommandBuilder().setName('pause').setDescription('⏸️ Pause / Resume'),
    new SlashCommandBuilder().setName('resume').setDescription('▶️ Resume the paused song'),
    new SlashCommandBuilder().setName('queue').setDescription('📊 Show the current music queue'),
    new SlashCommandBuilder().setName('nowplaying').setDescription('🎶 Show what\'s currently playing'),
  ],

  async execute(interaction, distube) {
    const cmd    = interaction.commandName;
    const member = interaction.member;
    const vc     = member.voice?.channel;
    const queue  = distube.getQueue(interaction.guild);

    if (cmd === 'play') {
      if (!vc) return interaction.reply({ content: '❌ Join a voice channel first!', flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString('query');

      // Direct URL — play immediately
      if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(query)) {
        try {
          await distube.play(vc, query, { member, textChannel: interaction.channel });
          return interaction.editReply({ content: '🔊 Playing from URL!', embeds: [], components: [] });
        } catch (e) {
          console.error('[/play URL]', e.message);
          return interaction.editReply('❌ Could not play that URL.');
        }
      }

      // Search — show dropdown
      try {
        const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 5 });
        if (!results.length) return interaction.editReply('❌ No results found.');

        pendingSearches.set(interaction.user.id, {
          videos: results, vc, guildId: interaction.guild.id, channelId: interaction.channelId, member,
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
              `**${i + 1}.** [${v.title}](${v.url})\n┗ 📺 ${v.channel?.name ?? 'Unknown'} · ⏱️ ${v.durationRaw || '?'}`
            ).join('\n\n')
          )
          .setFooter({ text: 'Pick from the dropdown · expires in 60s' });

        return interaction.editReply({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('music_search_pick').setPlaceholder('🎵 Pick a song…').addOptions(options)
          )],
        });
      } catch (e) {
        console.error('[/play search]', e.message);
        return interaction.editReply('❌ Search failed. Try again.');
      }
    }

    if (cmd === 'skip') {
      if (!queue) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral });
      await distube.skip(interaction.guild);
      return interaction.reply({ content: '⏭️ Skipped!', flags: MessageFlags.Ephemeral });
    }
    if (cmd === 'stop') {
      if (!queue) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral });
      await distube.stop(interaction.guild);
      return interaction.reply({ content: '⏹️ Stopped!', flags: MessageFlags.Ephemeral });
    }
    if (cmd === 'pause') {
      if (!queue) return interaction.reply({ content: '❌ Nothing playing.', flags: MessageFlags.Ephemeral });
      queue.paused ? distube.resume(interaction.guild) : distube.pause(interaction.guild);
      return interaction.reply({ content: queue.paused ? '▶️ Resumed!' : '⏸️ Paused!', flags: MessageFlags.Ephemeral });
    }
    if (cmd === 'resume') {
      if (!queue) return interaction.reply({ content: '❌ Nothing paused.', flags: MessageFlags.Ephemeral });
      distube.resume(interaction.guild);
      return interaction.reply({ content: '▶️ Resumed!', flags: MessageFlags.Ephemeral });
    }
    if (cmd === 'queue') {
      if (!queue) return interaction.reply({ content: '💭 Queue is empty.', flags: MessageFlags.Ephemeral });
      const list = queue.songs.slice(0, 10).map((s, i) =>
        `${i === 0 ? '🔴' : `${i}.`} **${s.name}** \`${s.formattedDuration}\``
      ).join('\n');
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor('#9146FF').setTitle('📊 Queue').setDescription(list).setFooter({ text: `${queue.songs.length} song(s)` })],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (cmd === 'nowplaying') {
      if (!queue?.songs[0]) return interaction.reply({ content: '💭 Nothing playing.', flags: MessageFlags.Ephemeral });
      const s = queue.songs[0];
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor('#9146FF').setTitle('🎶 Now Playing')
          .setDescription(`**[${s.name}](${s.url})**`)
          .addFields({ name: '⏱️ Duration', value: s.formattedDuration, inline: true }, { name: '👤 Requested by', value: s.member?.displayName ?? 'Unknown', inline: true })
          .setThumbnail(s.thumbnail)],
      });
    }
  },
};
