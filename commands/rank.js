const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

// In-memory XP store  { userId: { xp, level, messages } }
// For persistence across restarts, swap this Map with a JSON file or DB
const xpStore = new Map();

const XP_PER_MESSAGE  = 15;   // base XP per message
const XP_COOLDOWN_MS  = 10_000; // 10s cooldown between XP gains
const cooldowns       = new Map();

function xpForLevel(level) {
  // XP needed to reach this level: 100 * level^1.5
  return Math.floor(100 * Math.pow(level, 1.5));
}

function getUser(userId) {
  if (!xpStore.has(userId))
    xpStore.set(userId, { xp: 0, level: 1, messages: 0 });
  return xpStore.get(userId);
}

// Call this from index.js on every non-bot MessageCreate
function addXp(message) {
  if (message.author.bot) return null;
  const userId = message.author.id;
  const now    = Date.now();
  if (cooldowns.has(userId) && now - cooldowns.get(userId) < XP_COOLDOWN_MS) return null;
  cooldowns.set(userId, now);

  const user   = getUser(userId);
  const gained = XP_PER_MESSAGE + Math.floor(Math.random() * 6); // 15–20 XP
  user.xp      += gained;
  user.messages += 1;

  let leveledUp = false;
  while (user.xp >= xpForLevel(user.level + 1)) {
    user.level++;
    leveledUp = true;
  }
  return leveledUp ? { level: user.level, user: message.author } : null;
}

// Leaderboard helper — top N users sorted by XP
function getLeaderboard(n = 10) {
  return [...xpStore.entries()]
    .sort((a, b) => b[1].xp - a[1].xp || b[1].level - a[1].level)
    .slice(0, n);
}

const LEVEL_COLORS = [
  '#747F8D', // 1-4  grey
  '#CD7F32', // 5-9  bronze
  '#C0C0C0', // 10-14 silver
  '#FFD700', // 15-19 gold
  '#00D4FF', // 20-29 platinum
  '#B9F2FF', // 30-39 diamond
  '#00FF87', // 40-49 ascendant
  '#FF4655', // 50-74 immortal
  '#FFFB96', // 75+  radiant
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
  if (level >= 30) return '💎 Diamond';
  if (level >= 20) return '🔵 Platinum';
  if (level >= 15) return '🥇 Gold';
  if (level >= 10) return '🥈 Silver';
  if (level >= 5)  return '🥉 Bronze';
  return '⚙️ Iron';
}

module.exports = {
  xpStore, getUser, addXp, getLeaderboard,

  data: [
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('📊 Check your server rank & XP')
      .addUserOption(o => o.setName('user').setDescription('Check another member (leave blank for yourself)')),
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('🏆 Show the top 10 most active members'),
  ],

  async execute(interaction) {
    const cmd = interaction.commandName;

    // ── /rank
    if (cmd === 'rank') {
      const target = interaction.options.getUser('user') || interaction.user;
      const data   = getUser(target.id);
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);

      const currentXp  = data.xp;
      const nextLvlXp  = xpForLevel(data.level + 1);
      const prevLvlXp  = xpForLevel(data.level);
      const progress   = currentXp - prevLvlXp;
      const needed     = nextLvlXp - prevLvlXp;
      const barFilled  = Math.round((progress / needed) * 20);
      const bar        = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);

      // Rank position on leaderboard
      const sorted   = [...xpStore.entries()].sort((a, b) => b[1].xp - a[1].xp);
      const position = sorted.findIndex(([id]) => id === target.id) + 1 || '—';

      const embed = new EmbedBuilder()
        .setColor(levelColor(data.level))
        .setAuthor({ name: member?.displayName ?? target.username, iconURL: target.displayAvatarURL({ dynamic: true }) })
        .setTitle(`${levelTitle(data.level)}  ·  Level ${data.level}`)
        .setDescription(`\`[${bar}]\`\n**${progress} / ${needed} XP** to level ${data.level + 1}`)
        .addFields(
          { name: '⭐ Total XP',    value: `**${currentXp}**`,    inline: true },
          { name: '💬 Messages',    value: `**${data.messages}**`, inline: true },
          { name: '🏅 Server Rank', value: `**#${position}**`,    inline: true },
        )
        .setFooter({ text: 'L3attaR Community · Server Rank' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ── /leaderboard
    if (cmd === 'leaderboard') {
      const top = getLeaderboard(10);
      if (!top.length) return interaction.reply({ content: '💭 No one has earned XP yet!', flags: MessageFlags.Ephemeral });

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = await Promise.all(top.map(async ([userId, data], i) => {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const name   = member?.displayName ?? `<@${userId}>`;
        const medal  = medals[i] ?? `**${i + 1}.**`;
        return `${medal} ${name} — ${levelTitle(data.level)} Lv.**${data.level}** · ${data.xp} XP`;
      }));

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Server Leaderboard — Top 10')
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'L3attaR Community · Most Active Members' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }
  },
};
