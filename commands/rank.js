const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// Rank tier → color mapping
const RANK_COLORS = {
  Iron:        '#8B8B8B',
  Bronze:      '#CD7F32',
  Silver:      '#C0C0C0',
  Gold:        '#FFD700',
  Platinum:    '#00D4FF',
  Diamond:     '#B9F2FF',
  Ascendant:   '#00FF87',
  Immortal:    '#FF4655',
  Radiant:     '#FFFB96',
  Unranked:    '#747F8D',
};

function rankColor(tierName) {
  const base = tierName?.split(' ')[0];
  return RANK_COLORS[base] || '#9146FF';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('🎯 Check a Valorant player\'s rank')
    .addStringOption(o =>
      o.setName('name')
       .setDescription('Riot ID name (e.g. l3attar)')
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('tag')
       .setDescription('Riot tag without # (e.g. EUW1)')
       .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const name = interaction.options.getString('name').trim();
    const tag  = interaction.options.getString('tag').trim().replace('#', '');

    try {
      // Henrik Dev API v2 — no key required for basic requests
      const [mmrRes, profileRes] = await Promise.allSettled([
        axios.get(`https://api.henrikdev.xyz/valorant/v2/mmr/eu/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`),
        axios.get(`https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`),
      ]);

      if (mmrRes.status === 'rejected' || mmrRes.value.data?.status !== 200) {
        return interaction.editReply({ content: `❌ Player **${name}#${tag}** not found. Check the Riot ID and tag.` });
      }

      const mmr     = mmrRes.value.data.data;
      const profile = profileRes.status === 'fulfilled' ? profileRes.value.data.data : null;

      const currentTier  = mmr.current_data?.currenttierpatched  || 'Unranked';
      const rr           = mmr.current_data?.ranking_in_tier      ?? 0;
      const peakTier     = mmr.highest_rank?.patched_tier          || 'N/A';
      const peakSeason   = mmr.highest_rank?.season                || '';
      const rankIcon     = mmr.current_data?.images?.large         || null;
      const card         = profile?.card?.small                    || null;
      const level        = profile?.account_level                  || '?';
      const region       = profile?.region?.toUpperCase()          || 'EU';

      const embed = new EmbedBuilder()
        .setColor(rankColor(currentTier))
        .setAuthor({ name: `${name}#${tag}`, iconURL: card || undefined })
        .setTitle(`🎯 Valorant Rank — ${currentTier}`)
        .setThumbnail(rankIcon)
        .addFields(
          { name: '🏅 Current Rank', value: `**${currentTier}**`,          inline: true },
          { name: '🔺 RR',           value: `**${rr} RR**`,                 inline: true },
          { name: '🌍 Region',       value: `**${region}**`,                inline: true },
          { name: '🏆 Peak Rank',    value: `**${peakTier}** (${peakSeason})`, inline: true },
          { name: '📊 Account Lvl', value: `**${level}**`,                  inline: true },
        )
        .setFooter({ text: `L3attaR Community · Data via tracker.gg` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('[/rank]', err.message);
      if (err.response?.status === 404)
        return interaction.editReply({ content: `❌ Player **${name}#${tag}** not found.` });
      if (err.response?.status === 429)
        return interaction.editReply({ content: '⏳ Rate limited — try again in a few seconds.' });
      return interaction.editReply({ content: '❌ Something went wrong fetching Valorant data. Try again later.' });
    }
  },
};
