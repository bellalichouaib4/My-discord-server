// setup.js — Full L3attaR server builder
const {
  ChannelType, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');

const ROLES = [
  { name: '🔒 Unverified',   color: '#95a5a6', hoist: false },
  { name: '✅ Member',        color: '#57F287', hoist: true  },
  { name: '🎮 Gamer',         color: '#3498DB', hoist: true  },
  { name: '📺 Subscriber',    color: '#E67E22', hoist: true  },
  { name: '🔴 Live Now',      color: '#ED4245', hoist: true  },
  { name: '🎖️ VIP',          color: '#F1C40F', hoist: true  },
  { name: '🔔 Stream Alerts', color: '#9146FF', hoist: false },
  { name: '🔔 Video Alerts',  color: '#FF0000', hoist: false },
  { name: '🛡️ Moderator',    color: '#1ABC9C', hoist: true  },
  { name: '⚙️ Admin',        color: '#E74C3C', hoist: true  },
];

const STRUCTURE = [
  {
    name: '📋 ─── INFORMATION', public: true,
    channels: [
      { name: '👋・welcome',       topic: 'Welcome to L3attaR community!' },
      { name: '📢・announcements', topic: 'Server & stream announcements' },
      { name: '📜・rules',         topic: 'Server rules — read before chatting' },
      { name: '🔗・social-links',  topic: 'All L3attaR social media links', isSocials: true },
    ]
  },
  {
    name: '🔒 ─── VERIFICATION', public: true,
    channels: [
      { name: '🔒・verify', topic: 'Click the button to unlock the server', isVerify: true },
    ]
  },
  {
    name: '🔔 ─── NOTIFICATIONS', public: true,
    channels: [
      { name: '🔔・get-notified', topic: 'Choose your notification roles here', isNotifPicker: true },
    ]
  },
  {
    name: '💬 ─── COMMUNITY', membersOnly: true,
    channels: [
      { name: '💬・general',       topic: 'General chat — keep it chill' },
      { name: '👋・introductions', topic: 'Introduce yourself!' },
      { name: '😂・memes',         topic: 'Memes and funny clips' },
      { name: '🖼️・media',        topic: 'Share images, clips and fan art' },
    ]
  },
  {
    name: '🎮 ─── GAMING', membersOnly: true,
    channels: [
      { name: '🎮・gaming-general',   topic: 'All gaming talk' },
      { name: '🎯・valorant',         topic: 'Valorant ranked grind 🎯' },
      { name: '🎬・clips-highlights', topic: 'Share your best plays!' },
      { name: '🏆・tournaments',      topic: 'Community tournaments and scrims' },
    ]
  },
  {
    name: '🔴 ─── STREAMS',
    channels: [
      { name: '📡・stream-alerts', topic: '🔔 Live notifications | twitch.tv/l3attar_', public: true },
      { name: '💬・stream-chat',   topic: 'Chat during live streams', membersOnly: true },
      { name: '🎞️・stream-clips', topic: 'Best clips from streams', membersOnly: true },
    ]
  },
  {
    name: '📺 ─── CONTENT',
    channels: [
      { name: '📺・youtube-videos', topic: '🔔 YouTube video notifications | @L3attaR', public: true },
      { name: '📱・tiktok-reels',   topic: 'TikTok & Reels | @l3attar_b', membersOnly: true },
      { name: '📘・facebook',       topic: 'Facebook updates | L3attar01', membersOnly: true },
    ]
  },
  {
    name: '🎤 ─── VOICE', membersOnly: true, voice: true,
    channels: [
      { name: '➕ Create Room',    voice: true, isJ2C: true },
      { name: '🔊 Lounge',         voice: true },
      { name: '🎮 Gaming',         voice: true },
      { name: '🔴 Stream Room',    voice: true },
      { name: '🎵 Music / Chill',  voice: true },
    ]
  },
  {
    name: '🛡️ ─── MODERATION', adminOnly: true,
    channels: [
      { name: '⚙️・bot-commands', topic: 'Admin bot commands' },
      { name: '📋・mod-log',       topic: 'Moderation action log' },
      { name: '🔨・bot-logs',      topic: 'Bot activity log' },
    ]
  }
];

module.exports = async function setupGuild(guild) {
  console.log(`\n🔧 Setting up: ${guild.name}`);

  // Create roles
  const roleMap = {};
  for (const def of ROLES) {
    let role = guild.roles.cache.find(r => r.name === def.name);
    if (!role) role = await guild.roles.create({ name: def.name, color: def.color, hoist: def.hoist, mentionable: true });
    roleMap[def.name] = role;
    console.log(`  ✅ Role: ${def.name}`);
  }

  // Lock @everyone
  await guild.roles.everyone.setPermissions(0n);

  // Build channels
  for (const cat of STRUCTURE) {
    const perms = buildPerms(cat, roleMap, guild);
    const existing = guild.channels.cache.find(c => c.name === cat.name && c.type === ChannelType.GuildCategory);
    const category = existing || await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: perms });

    for (const ch of cat.channels) {
      if (guild.channels.cache.find(c => c.name === ch.name)) {
        console.log(`  ⏭️  Skipping (exists): ${ch.name}`);
        continue;
      }
      const chPerms = ch.membersOnly ? buildPerms({ membersOnly: true }, roleMap, guild)
                    : ch.public      ? buildPerms({ public: true }, roleMap, guild)
                    : perms;
      const created = await guild.channels.create({
        name: ch.name,
        type: ch.voice ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        topic: ch.topic,
        permissionOverwrites: chPerms,
      });
      if (ch.isVerify)       await postVerifyMessage(created);
      if (ch.isSocials)      await postSocialLinks(created);
      if (ch.isNotifPicker)  await postNotifPicker(created);
      if (ch.isJ2C)          console.log(`  🎤 Join-to-Create hub ready: ${ch.name}`);
      console.log(`  📌 Channel: ${ch.name}`);
    }
  }
  console.log('\n✅ L3attaR server setup complete!\n');
};

function buildPerms(def, roleMap, guild) {
  if (def.adminOnly) return [
    { id: guild.roles.everyone.id,    deny:  [PermissionFlagsBits.ViewChannel] },
    { id: roleMap['⚙️ Admin']?.id,    allow: [PermissionFlagsBits.ViewChannel] },
    { id: roleMap['🛡️ Moderator']?.id,allow: [PermissionFlagsBits.ViewChannel] },
  ].filter(p => p.id);
  if (def.membersOnly) return [
    { id: guild.roles.everyone.id,    deny:  [PermissionFlagsBits.ViewChannel] },
    { id: roleMap['✅ Member']?.id,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: roleMap['🛡️ Moderator']?.id,allow: [PermissionFlagsBits.ViewChannel] },
    { id: roleMap['⚙️ Admin']?.id,    allow: [PermissionFlagsBits.ViewChannel] },
  ].filter(p => p.id);
  return [
    { id: guild.roles.everyone.id,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
    { id: roleMap['✅ Member']?.id,   allow: [PermissionFlagsBits.ViewChannel] },
    { id: roleMap['🛡️ Moderator']?.id,allow: [PermissionFlagsBits.SendMessages] },
    { id: roleMap['⚙️ Admin']?.id,    allow: [PermissionFlagsBits.SendMessages] },
  ].filter(p => p.id);
}

async function postVerifyMessage(channel) {
  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle('🔒 Welcome to L3attaR\'s Server!')
    .setDescription(
      '**One click to unlock the whole server.**\n\n' +
      '> ✅ Click **Verify Me** below\n' +
      '> 📜 By verifying you agree to follow the rules\n' +
      '> 🎮 Unlocks: gaming chat, stream chat, voice rooms & more'
    )
    .setFooter({ text: 'L3attaR Community · twitch.tv/l3attar_' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_btn').setLabel('✅  Verify Me').setStyle(ButtonStyle.Success)
  );
  await channel.send({ embeds: [embed], components: [row] });
}

async function postSocialLinks(channel) {
  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle('🔗 L3attaR — All Social Links')
    .setDescription('Follow on all platforms for streams, clips & highlights!')
    .addFields(
      { name: '🔴 Twitch',    value: '[twitch.tv/l3attar_](https://twitch.tv/l3attar_)',                      inline: true },
      { name: '📺 YouTube',   value: '[youtube.com/@L3attaR](https://www.youtube.com/@L3attaR)',             inline: true },
      { name: '📸 Instagram', value: '[l3attar_clips](https://www.instagram.com/l3attar_clips/)',           inline: true },
      { name: '🎵 TikTok',    value: '[@l3attar_b](https://www.tiktok.com/@l3attar_b)',                    inline: true },
      { name: '📘 Facebook',  value: '[L3attar01](https://www.facebook.com/L3attar01/)',                   inline: true },
    )
    .setFooter({ text: 'Use /socials anytime to see these links' });
  await channel.send({ embeds: [embed] });
}

async function postNotifPicker(channel) {
  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle('🔔 Notification Roles')
    .setDescription(
      'Pick which notifications you want to receive:\n\n' +
      '> 🟣 **Stream Alerts** — Get pinged when L3attaR goes live on Twitch\n' +
      '> 🔴 **Video Alerts** — Get pinged when a new YouTube video drops\n\n' +
      'You can change or remove at any time!'
    )
    .setFooter({ text: 'Select below — only you can see your response' });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('notif_roles')
    .setPlaceholder('Choose your notifications...')
    .setMinValues(0)
    .setMaxValues(2)
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('🟣 Stream Alerts').setDescription('Ping when L3attaR goes live').setValue('stream').setEmoji('🟣'),
      new StringSelectMenuOptionBuilder().setLabel('🔴 Video Alerts').setDescription('Ping for new YouTube videos').setValue('video').setEmoji('🔴'),
    );
  const row = new ActionRowBuilder().addComponents(menu);
  await channel.send({ embeds: [embed], components: [row] });
}
