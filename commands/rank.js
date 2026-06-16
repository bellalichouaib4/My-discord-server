const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');

// ─────────────────────────────────────────────────────────────
// XP STORE
// xpStore: userId → { xp, level, messages, history: [{ts, xp}] }
// history is a rolling log of every XP gain with a timestamp so
// we can sum "XP earned this week / this month" on the fly.
// ─────────────────────────────────────────────────────────────
const xpStore   = new Map();
const cooldowns = new Map();

const XP_PER_MESSAGE = 15;
const XP_COOLDOWN_MS = 10_000;

function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

function getUser(userId) {
  if (!xpStore.has(userId))
    xpStore.set(userId, { xp: 0, level: 1, messages: 0, history: [] });
  return xpStore.get(userId);
}

// Prune history older than 31 days to keep memory clean
function pruneHistory(user) {
  const cutoff = Date.now() - 31 * 24 * 60 * 60 * 1000;
  user.history = user.history.filter(e => e.ts >= cutoff);
}

function addXp(message) {
  if (message.author.bot) return null;
  const userId = message.author.id;
  const now    = Date.now();
  if (cooldowns.has(userId) && now - cooldowns.get(userId) < XP_COOLDOWN_MS) return null;
  cooldowns.set(userId, now);

  const user   = getUser(userId);
  const gained = XP_PER_MESSAGE + Math.floor(Math.random() * 6);
  user.xp      += gained;
  user.messages += 1;
  user.history.push({ ts: now, xp: gained });
  pruneHistory(user);

  let leveledUp = false;
  while (user.xp >= xpForLevel(user.level + 1)) {
    user.level++;
    leveledUp = true;
  }
  return leveledUp ? { level: user.level, user: message.author } : null;
}

// ─────────────────────────────────────────────────────────────
// LEADERBOARD HELPERS
// period: 'all' | 'week' | 'month'
// Returns [ [userId, { xp: periodXp, totalLevel, totalXp }], ... ]
// Only includes users who earned at least 1 XP in the period.
// ─────────────────────────────────────────────────────────────
function getLeaderboard(n = 10, period = 'all') {
  const now    = Date.now();
  const cutoff = period === 'week'  ? now - 7  * 24 * 60 * 60 * 1000
               : period === 'month' ? now - 30 * 24 * 60 * 60 * 1000
               : 0;

  const rows = [];
  for (const [userId, data] of xpStore) {
    if (period === 'all') {
      rows.push([userId, { periodXp: data.xp, level: data.level, totalXp: data.xp }]);
    } else {
      const periodXp = data.history
        .filter(e => e.ts >= cutoff)
        .reduce((sum, e) => sum + e.xp, 0);
      if (periodXp === 0) continue; // skip inactive users
      rows.push([userId, { periodXp, level: data.level, totalXp: data.xp }]);
    }
  }

  return rows
    .sort((a, b) => b[1].periodXp - a[1].periodXp)
    .slice(0, n);
}

// ─────────────────────────────────────────────────────────────
// RANK STYLING
// ─────────────────────────────────────────────────────────────
const LEVEL_COLORS = [
  '#747F8D','#CD7F32','#C0C0C0','#FFD700',
  '#00D4FF','#B9F2FF','#00FF87','#FF4655','#FFFB96',
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
      .setDescription('🏆 Show the most active members')
      .addStringOption(o =>
        o.setName('period')
         .setDescription('Time period to rank by (default: all time)')
         .setRequired(false)
         .addChoices(
           { name: '🔵 This Week',  value: 'week'  },
           { name: '🟣 This Month', value: 'month' },
           { name: '🌍 All Time',   value: 'all'   },
         )),

    // ── /setlevel
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

    // ──────────────────────── /rank ────────────────────────
    if (cmd === 'rank') {
      await interaction.deferReply();

      const target  = interaction.options.getUser('user') ?? interaction.user;
      const data    = getUser(target.id);
      const member  = await interaction.guild.members.fetch(target.id).catch(() => null);

      const prevLvlXp = xpForLevel(data.level);
      const nextLvlXp = xpForLevel(data.level + 1);
      const needed    = Math.max(1, nextLvlXp - prevLvlXp);
      const progress  = Math.max(0, data.xp - prevLvlXp);
      const barFilled = Math.min(20, Math.max(0, Math.round((progress / needed) * 20)));
      const bar       = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);

      const sorted   = [...xpStore.entries()].sort((a, b) => b[1].xp - a[1].xp);
      const position = sorted.findIndex(([id]) => id === target.id) + 1 || '—';

      // XP earned this week
      const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekXp     = (data.history ?? []).filter(e => e.ts >= weekCutoff).reduce((s, e) => s + e.xp, 0);

      const embed = new EmbedBuilder()
        .setColor(levelColor(data.level))
        .setAuthor({ name: member?.displayName ?? target.username, iconURL: target.displayAvatarURL({ dynamic: true }) })
        .setTitle(`${levelTitle(data.level)}  ·  Level ${data.level}`)
        .setDescription(`\`[${bar}]\`\n**${progress} / ${needed} XP** to level ${data.level + 1}`)
        .addFields(
          { name: '⭐ Total XP',    value: `**${data.xp}**`,       inline: true },
          { name: '💬 Messages',    value: `**${data.messages}**`, inline: true },
          { name: '🏅 Server Rank', value: `**#${position}**`,    inline: true },
          { name: '🔵 XP This Week', value: `**${weekXp}**`,       inline: true },
        )
        .setFooter({ text: 'L3attaR Community · Server Rank' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ──────────────────────── /leaderboard ────────────────────────
    if (cmd === 'leaderboard') {
      await interaction.deferReply();

      const period = interaction.options.getString('period') ?? 'all';
      const top    = getLeaderboard(10, period);

      const periodLabel = period === 'week'  ? '🔵 This Week'
                        : period === 'month' ? '🟣 This Month'
                        : '🌍 All Time';

      if (!top.length) {
        const msg = period === 'all'
          ? '💭 No one has earned XP yet — start chatting!'
          : `💭 Nobody was active ${period === 'week' ? 'this week' : 'this month'} yet!`;
        return interaction.editReply({ content: msg });
      }

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = await Promise.all(top.map(async ([userId, d], i) => {
        const m    = await interaction.guild.members.fetch(userId).catch(() => null);
        const name = m?.displayName ?? `<@${userId}>`;
        const icon = medals[i] ?? `**${i + 1}.**`;
        const xpLabel = period === 'all'
          ? `${d.totalXp} XP total`
          : `**+${d.periodXp} XP** ${period === 'week' ? 'this week' : 'this month'}`;
        return `${icon} ${name} — ${levelTitle(d.level)} Lv.**${d.level}** · ${xpLabel}`;
      }));

      const embed = new EmbedBuilder()
        .setColor(period === 'week' ? '#00D4FF' : period === 'month' ? '#9B59B6' : '#FFD700')
        .setTitle(`🏆 Server Leaderboard — ${periodLabel}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'L3attaR Community · Most Active Members' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ──────────────────────── /setlevel ────────────────────────
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
      data.xp    = xpForLevel(newLevel);

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
