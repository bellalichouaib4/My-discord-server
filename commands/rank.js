const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');

// In-memory XP store  { userId: { xp, level, messages } }
const xpStore  = new Map();
const cooldowns = new Map();

const XP_PER_MESSAGE = 15;
const XP_COOLDOWN_MS = 10_000; // 10 s between XP gains

function xpForLevel(level) {
  // XP needed to REACH this level (cumulative from 0)
  if (level <= 1) return 0;  // level 1 starts at 0 XP
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

function getUser(userId) {
  if (!xpStore.has(userId))
    xpStore.set(userId, { xp: 0, level: 1, messages: 0 });
  return xpStore.get(userId);
}

function addXp(message) {
  if (message.author.bot) return null;
  const userId = message.author.id;
  const now    = Date.now();
  if (cooldowns.has(userId) && now - cooldowns.get(userId) < XP_COOLDOWN_MS) return null;
  cooldowns.set(userId, now);

  const user   = getUser(userId);
  user.xp      += XP_PER_MESSAGE + Math.floor(Math.random() * 6); // 15-20 XP
  user.messages += 1;

  let leveledUp = false;
  while (user.xp >= xpForLevel(user.level + 1)) {
    user.level++;
    leveledUp = true;
  }
  return leveledUp ? { level: user.level, user: message.author } : null;
}

function getLeaderboard(n = 10) {
  return [...xpStore.entries()]
    .sort((a, b) => b[1].xp - a[1].xp || b[1].level - a[1].level)
    .slice(0, n);
}

const LEVEL_COLORS = [
  '#747F8D', // 1-4   Iron
  '#CD7F32', // 5-9   Bronze
  '#C0C0C0', // 10-14 Silver
  '#FFD700', // 15-19 Gold
  '#00D4FF', // 20-29 Platinum
  '#B9F2FF', // 30-39 Diamond
  '#00FF87', // 40-49 Ascendant
  '#FF4655', // 50-74 Immortal
  '#FFFB96', // 75+   Radiant
];
function levelColor(level) {
  if (level >= 75) return LEVEL_COLORS[8];
  if (level >= 50) return LEVEL_COLORS[7];
  if (level >= 40) return LEVEL_COLORS[6];
  if (level >= 30) return LEVEL_COLORS[5];
  if (level >= 20) return LEVEL_COLORS[4];
  if (level >= 15) return LEVEL_COLORS[3];
  if (level >= 10) return LEVEL_COLORS[2];
  if (level >= 5)  return LEVEL_COLORS[1];
  return LEVEL_COLORS[0];
}
function levelTitle(level) {
  if (level >= 75) return '✨ Radiant';
  if (level >= 50) return '🔴 Immortal';
  if (level >= 40) return '🌿 Ascendant';
  if (level >= 30) return '📎 Diamond';
  if (level >= 20) return '🔵 Platinum';
  if (level >= 15) return '🥇 Gold';
  if (level >= 10) return '🥈 Silver';
  if (level >= 5)  return '🥉 Bronze';
  return '⚙️ Iron';
}

module.exports = {
  xpStore, getUser, addXp, getLeaderboard,

  data: [
    // ── /rank
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('📊 Check your server rank & XP')
      .addUserOption(o =>
        o.setName('user')
         .setDescription('Check another member (leave blank for yourself)')
         .setRequired(false)),

    // ── /leaderboard
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('🏆 Show the top 10 most active members'),

    // ── /setlevel  (owner + mods only)
    new SlashCommandBuilder()
      .setName('setlevel')
      .setDescription('🔧 Manually set a member\'s level (Mod/Owner only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption(o =>
        o.setName('user')
         .setDescription('The member to adjust')
         .setRequired(true))
      .addIntegerOption(o =>
        o.setName('level')
         .setDescription('New level (1 – 100)')
         .setMinValue(1)
         .setMaxValue(100)
         .setRequired(true)),
  ],

  async execute(interaction) {
    const cmd = interaction.commandName;

    // ────────────────── /rank ──────────────────
    if (cmd === 'rank') {
      await interaction.deferReply();

      const target  = interaction.options.getUser('user') ?? interaction.user;
      const data    = getUser(target.id);
      const member  = await interaction.guild.members.fetch(target.id).catch(() => null);

      const prevLvlXp = xpForLevel(data.level);
      const nextLvlXp = xpForLevel(data.level + 1);
      const needed    = Math.max(1, nextLvlXp - prevLvlXp);
      const progress  = Math.max(0, data.xp - prevLvlXp); // clamp >= 0
      const barFilled = Math.min(20, Math.max(0, Math.round((progress / needed) * 20))); // 0-20
      const bar       = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);

      const sorted   = [...xpStore.entries()].sort((a, b) => b[1].xp - a[1].xp);
      const position = sorted.findIndex(([id]) => id === target.id) + 1 || '—';

      const embed = new EmbedBuilder()
        .setColor(levelColor(data.level))
        .setAuthor({ name: member?.displayName ?? target.username, iconURL: target.displayAvatarURL({ dynamic: true }) })
        .setTitle(`${levelTitle(data.level)}  ·  Level ${data.level}`)
        .setDescription(`\`[${bar}]\`\n**${progress} / ${needed} XP** to level ${data.level + 1}`)
        .addFields(
          { name: '⭐ Total XP',    value: `**${data.xp}**`,       inline: true },
          { name: '💬 Messages',    value: `**${data.messages}**`, inline: true },
          { name: '🏅 Server Rank', value: `**#${position}**`,    inline: true },
        )
        .setFooter({ text: 'L3attaR Community · Server Rank' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ────────────────── /leaderboard ──────────────────
    if (cmd === 'leaderboard') {
      await interaction.deferReply();

      const top = getLeaderboard(10);
      if (!top.length)
        return interaction.editReply({ content: '💭 No one has earned XP yet — start chatting!' });

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = await Promise.all(top.map(async ([userId, d], i) => {
        const m    = await interaction.guild.members.fetch(userId).catch(() => null);
        const name = m?.displayName ?? `<@${userId}>`;
        const icon = medals[i] ?? `**${i + 1}.**`;
        return `${icon} ${name} — ${levelTitle(d.level)} Lv.**${d.level}** · ${d.xp} XP`;
      }));

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Server Leaderboard — Top 10')
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'L3attaR Community · Most Active Members' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ────────────────── /setlevel ──────────────────
    if (cmd === 'setlevel') {
      const isOwner = interaction.guild.ownerId === interaction.user.id;
      const isMod   = interaction.member.permissions.has(PermissionFlagsBits.ManageRoles);
      if (!isOwner && !isMod)
        return interaction.reply({ content: '❌ Only moderators and the server owner can use this command.', flags: MessageFlags.Ephemeral });

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const target   = interaction.options.getUser('user');
      const newLevel = interaction.options.getInteger('level');
      const data     = getUser(target.id);

      data.level = newLevel;
      data.xp    = xpForLevel(newLevel); // set XP to the start of that level

      const m    = await interaction.guild.members.fetch(target.id).catch(() => null);
      const name = m?.displayName ?? target.username;

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(levelColor(newLevel))
            .setTitle('🔧 Level Updated')
            .setDescription(`${name} is now **${levelTitle(newLevel)} — Level ${newLevel}**.`)
            .setFooter({ text: `Set by ${interaction.user.username}` })
            .setTimestamp(),
        ],
      });
    }
  },
};
