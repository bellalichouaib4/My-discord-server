const {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');

const GAME_ROLES = [
  { label: '🎯 Valorant',       value: 'valorant',    description: 'Valorant player',          emoji: '🎯', color: '#FF4655' },
  { label: '⚽ FC 25',          value: 'fc25',        description: 'FC 25 / FIFA player',      emoji: '⚽', color: '#00A550' },
  { label: '🪖 Call of Duty',   value: 'cod',         description: 'COD / Warzone player',     emoji: '🪖', color: '#8B7355' },
  { label: '🏝️ Fortnite',      value: 'fortnite',    description: 'Fortnite player',          emoji: '🏝️', color: '#00D4FF' },
  { label: '🌌 Minecraft',      value: 'minecraft',   description: 'Minecraft player',         emoji: '🌌', color: '#7CFC00' },
  { label: '🧠 Other Games',    value: 'other',       description: 'Other games',              emoji: '🧠', color: '#9B59B6' },
];

module.exports = {
  GAME_ROLES,
  data: new SlashCommandBuilder()
    .setName('postgameroles')
    .setDescription('📌 Post the game role selector embed (Admin only)'),

  async execute(interaction) {
    const { PermissionFlagsBits } = require('discord.js');
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: '❌ Administrator permission required.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor('#3498DB')
      .setTitle('🎮 Pick Your Games')
      .setDescription(
        'Select the games you play to get your roles and find teammates!\n\n' +
        '> 🎯 **Valorant** — Tactical FPS ranked grind\n' +
        '> ⚽ **FC 25** — Football / FIFA\n' +
        '> 🪖 **Call of Duty** — Warzone & MP\n' +
        '> 🏝️ **Fortnite** — Battle Royale\n' +
        '> 🌌 **Minecraft** — Survival & Creative\n' +
        '> 🧠 **Other Games** — Everything else\n\n' +
        '**You can pick multiple — change anytime!** 👇'
      )
      .setFooter({ text: 'L3attaR Community · Game Roles' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('game_roles')
      .setPlaceholder('🎮 Select your games...')
      .setMinValues(0)
      .setMaxValues(GAME_ROLES.length)
      .addOptions(
        GAME_ROLES.map(g =>
          new StringSelectMenuOptionBuilder()
            .setLabel(g.label)
            .setDescription(g.description)
            .setValue(g.value)
            .setEmoji(g.emoji)
        )
      );

    await interaction.reply({ content: '✅ Game role selector posted!', ephemeral: true });
    await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
  },
};
