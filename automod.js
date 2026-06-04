/**
 * automod.js — L3attaR Community Auto-Moderation
 * Features:
 *  - Anti-spam (5 messages in 5s → mute)
 *  - Anti-raid (10 joins in 10s → lockdown)
 *  - Bad word filter (customizable)
 *  - Discord invite link blocker (non-staff)
 *  - All actions logged to 💻・mod-log
 */

const { EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

// ── Config
const SPAM_LIMIT      = 5;    // messages
const SPAM_WINDOW_MS  = 5000; // 5 seconds
const RAID_LIMIT      = 10;   // joins
const RAID_WINDOW_MS  = 10000;// 10 seconds
const MUTE_DURATION   = 5 * 60 * 1000; // 5 minutes timeout

const BAD_WORDS = [
  'nigger', 'nigga', 'faggot', 'retard', 'chink', 'spic', 'kike',
  // Add more as needed
];

// ── In-memory trackers
const spamMap  = new Map(); // userId → { count, timer }
const raidMap  = new Map(); // guildId → { count, timer }
const mutedMap = new Set(); // userIds currently muted by automod

async function logAction(guild, color, title, description, user = null) {
  const logCh = guild.channels.cache.find(c => c.name === '💻・mod-log');
  if (!logCh) return;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🛡️ AutoMod — ${title}`)
    .setDescription(description)
    .setTimestamp();
  if (user) embed.setThumbnail(user.displayAvatarURL?.() || user.user?.displayAvatarURL?.() || null);
  await logCh.send({ embeds: [embed] }).catch(() => {});
}

function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.ManageMessages);
}

// ── Anti-Spam
export function handleAntiSpam(message) {
  if (!message.guild || message.author.bot) return;
  const member = message.member;
  if (!member || isStaff(member)) return;

  const uid = message.author.id;
  if (!spamMap.has(uid)) {
    spamMap.set(uid, { count: 1, timer: setTimeout(() => spamMap.delete(uid), SPAM_WINDOW_MS) });
  } else {
    const entry = spamMap.get(uid);
    entry.count++;
    if (entry.count >= SPAM_LIMIT && !mutedMap.has(uid)) {
      mutedMap.add(uid);
      clearTimeout(entry.timer);
      spamMap.delete(uid);

      // Timeout the member (Discord timeout = communication disabled)
      member.disableCommunicationUntil(
        new Date(Date.now() + MUTE_DURATION),
        'AutoMod: Spam detected'
      ).catch(() => {});

      setTimeout(() => mutedMap.delete(uid), MUTE_DURATION);

      logAction(
        message.guild, '#FF4655', 'Spam Detected',
        `**User:** ${message.author} (${message.author.tag})\n**Reason:** Sent ${SPAM_LIMIT}+ messages in ${SPAM_WINDOW_MS / 1000}s\n**Action:** Timed out for 5 minutes`,
        message.member
      );

      message.channel.send({
        content: `⚠️ ${message.author} **slow down!** You've been muted for 5 minutes for spamming.`,
      }).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
    }
  }
}

// ── Bad Word Filter
export async function handleBadWords(message) {
  if (!message.guild || message.author.bot) return;
  if (!message.member || isStaff(message.member)) return;

  const content = message.content.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const found = BAD_WORDS.find(w => content.includes(w));
  if (!found) return;

  await message.delete().catch(() => {});
  const warn = await message.channel.send({
    content: `❌ ${message.author} that word is not allowed here. Please keep it respectful.`,
  });
  setTimeout(() => warn.delete().catch(() => {}), 6000);

  logAction(
    message.guild, '#E67E22', 'Bad Word Blocked',
    `**User:** ${message.author} (${message.author.tag})\n**Word matched:** \`${found}\`\n**Channel:** ${message.channel}`,
    message.member
  );
}

// ── Invite Link Blocker
export async function handleInviteLinks(message) {
  if (!message.guild || message.author.bot) return;
  if (!message.member || isStaff(message.member)) return;

  const inviteRegex = /(discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9]+/i;
  if (!inviteRegex.test(message.content)) return;

  await message.delete().catch(() => {});
  const warn = await message.channel.send({
    content: `🚫 ${message.author} posting Discord invite links is not allowed without staff permission.`,
  });
  setTimeout(() => warn.delete().catch(() => {}), 6000);

  logAction(
    message.guild, '#E74C3C', 'Invite Link Blocked',
    `**User:** ${message.author} (${message.author.tag})\n**Channel:** ${message.channel}`,
    message.member
  );
}

// ── Anti-Raid
export function handleAntiRaid(member) {
  const guildId = member.guild.id;
  if (!raidMap.has(guildId)) {
    raidMap.set(guildId, {
      count: 1,
      timer: setTimeout(() => raidMap.delete(guildId), RAID_WINDOW_MS),
    });
  } else {
    const entry = raidMap.get(guildId);
    entry.count++;
    if (entry.count >= RAID_LIMIT) {
      clearTimeout(entry.timer);
      raidMap.delete(guildId);
      triggerLockdown(member.guild);
    }
  }
}

async function triggerLockdown(guild) {
  console.log(`⚠️ [RAID] Lockdown triggered in ${guild.name}`);

  // Lock all public text channels
  for (const [, ch] of guild.channels.cache) {
    if (ch.isTextBased() && !ch.isDMBased()) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false,
      }).catch(() => {});
    }
  }

  logAction(
    guild, '#ED4245', '🚨 RAID LOCKDOWN ACTIVATED',
    `**${RAID_LIMIT} members joined in ${RAID_WINDOW_MS / 1000}s** — all channels locked.\n\nTo unlock, run \`/unlock\` in the bot-commands channel.`
  );

  // Auto-unlock after 10 minutes
  setTimeout(() => unlockServer(guild), 10 * 60 * 1000);
}

export async function unlockServer(guild) {
  for (const [, ch] of guild.channels.cache) {
    if (ch.isTextBased() && !ch.isDMBased()) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: null, // reset to category default
      }).catch(() => {});
    }
  }
  logAction(guild, '#57F287', 'Lockdown Lifted', 'Server has been unlocked. All channels restored.');
}
