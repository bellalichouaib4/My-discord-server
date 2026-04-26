const {
  ChannelType, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');

// ══════════════════════════════════════════════
//  ROLES
// ══════════════════════════════════════════════
const ROLES = [
  // Gated access
  { name: '🔒 Unverified',     color: '#747F8D', hoist: false, mentionable: false },
  { name: '✅ Membre',          color: '#57F287', hoist: true,  mentionable: false },
  // Notification opt-in
  { name: '🔔 Stream Alerts',  color: '#9146FF', hoist: false, mentionable: true  },
  { name: '🔔 Video Alerts',   color: '#FF0000', hoist: false, mentionable: true  },
  // Community
  { name: '🎮 Gamer',          color: '#3498DB', hoist: true,  mentionable: false },
  { name: '📺 Subscriber',     color: '#E67E22', hoist: true,  mentionable: false },
  { name: '🎖️ VIP',           color: '#F1C40F', hoist: true,  mentionable: false },
  // Live indicator
  { name: '🔴 Live Now',       color: '#ED4245', hoist: true,  mentionable: false },
  // Staff
  { name: '🛡️ Moderateur',    color: '#1ABC9C', hoist: true,  mentionable: true  },
  { name: '⚙️ Admin',         color: '#E74C3C', hoist: true,  mentionable: true  },
];

// ══════════════════════════════════════════════
//  SERVER STRUCTURE
// ══════════════════════════════════════════════
const STRUCTURE = [
  {
    name: '📋 ── INFORMATION',
    type: 'public',
    channels: [
      { name: '👋・welcome',       type: 'public',  isWelcome: true },
      { name: '📢・announcements', type: 'public',  topic: 'Official announcements from L3attaR' },
      { name: '📜・rules',         type: 'public',  isRules: true },
      { name: '🔗・social-links',  type: 'public',  isSocials: true },
    ]
  },
  {
    name: '🔒 ── VERIFICATION',
    type: 'public',
    channels: [
      { name: '🔒・verify',        type: 'public',  isVerify: true },
    ]
  },
  {
    name: '🔔 ── NOTIFICATIONS',
    type: 'public',
    channels: [
      { name: '🔔・get-notified',  type: 'public',  isNotifPicker: true },
      { name: '📡・stream-alerts', type: 'public',  topic: '🔴 Live stream notifications — l3attar_' },
      { name: '📺・youtube-videos',type: 'public',  topic: '📺 New YouTube video notifications — @L3attaR' },
    ]
  },
  {
    name: '💬 ── COMMUNITY',
    type: 'member',
    channels: [
      { name: '💬・general',        type: 'member', topic: 'General chat — keep it chill 😎' },
      { name: '👋・introductions',  type: 'member', topic: 'New here? Introduce yourself!' },
      { name: '😂・memes',          type: 'member', topic: 'Memes, funny clips, and laughs 😂' },
      { name: '🖼️・media',         type: 'member', topic: 'Fan art, screenshots, highlights' },
      { name: '🙋・suggestions',    type: 'member', topic: 'Ideas to improve the server or stream' },
    ]
  },
  {
    name: '🎮 ── GAMING',
    type: 'member',
    channels: [
      { name: '🎮・gaming-general',   type: 'member', topic: 'All things gaming' },
      { name: '🎯・valorant',         type: 'member', topic: 'Valorant ranked grind 🎯 — tips, clips, comps' },
      { name: '🎬・clips-highlights', type: 'member', topic: 'Post your best plays and clips here!' },
      { name: '🏆・tournaments',      type: 'member', topic: 'Community scrims, tournaments & challenges' },
      { name: '🔍・lfg',             type: 'member', topic: 'Looking for group — find teammates here' },
    ]
  },
  {
    name: '🔴 ── STREAMS',
    type: 'member',
    channels: [
      { name: '💬・stream-chat',   type: 'member', topic: 'Chat here during live streams!' },
      { name: '🎞️・stream-clips', type: 'member', topic: 'Best moments saved from streams' },
      { name: '📱・tiktok-reels',  type: 'member', topic: 'TikTok & Reels content — @l3attar_b' },
    ]
  },
  {
    name: '🎤 ── VOICE',
    type: 'member',
    voice: true,
    channels: [
      { name: '➕ Create Room',    voice: true, type: 'member' },
      { name: '🔊 Lounge',         voice: true, type: 'member' },
      { name: '🎮 Gaming',         voice: true, type: 'member' },
      { name: '🔴 Stream Room',    voice: true, type: 'member' },
      { name: '🎵 Music / Chill',  voice: true, type: 'member' },
      { name: '📖 Study / AFK',    voice: true, type: 'member' },
    ]
  },
  {
    name: '🛡️ ── MODERATION',
    type: 'admin',
    channels: [
      { name: '⚙️・bot-commands',  type: 'admin', topic: 'Run bot commands here' },
      { name: '📋・mod-log',        type: 'admin', topic: 'Auto moderation log' },
      { name: '🔨・ban-appeals',    type: 'admin', topic: 'Ban appeal submissions' },
      { name: '📊・server-stats',   type: 'admin', topic: 'Server analytics' },
    ]
  }
];

// ══════════════════════════════════════════════
//  MAIN SETUP FUNCTION
// ══════════════════════════════════════════════
module.exports = async function setupGuild(guild) {
  console.log(`\n🔧 Building server: ${guild.name}`);
  await guild.members.fetch();

  // 1. Create roles
  const roleMap = {};
  for (const def of ROLES) {
    let role = guild.roles.cache.find(r => r.name === def.name);
    if (!role) {
      role = await guild.roles.create({ name: def.name, color: def.color, hoist: def.hoist, mentionable: def.mentionable });
      console.log(`  ✅ Role: ${def.name}`);
    }
    roleMap[def.name] = role;
  }

  // 2. Lock @everyone
  await guild.roles.everyone.setPermissions(0n);

  // 3. Build channels
  for (const cat of STRUCTURE) {
    const catPerms = permsFor(cat.type, roleMap, guild);
    let category = guild.channels.cache.find(c => c.name === cat.name && c.type === ChannelType.GuildCategory);
    if (!category) {
      category = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: catPerms });
    }

    for (const ch of cat.channels) {
      if (guild.channels.cache.find(c => c.name === ch.name)) { console.log(`  ⏭️  Exists: ${ch.name}`); continue; }
      const chPerms = permsFor(ch.type || cat.type, roleMap, guild);
      const created = await guild.channels.create({
        name: ch.name,
        type: ch.voice ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        topic: ch.topic || undefined,
        permissionOverwrites: chPerms,
      });
      // Post messages into special channels
      if (ch.isVerify)       await postVerify(created);
      if (ch.isRules)        await postRules(created);
      if (ch.isWelcome)      await postWelcomeInfo(created);
      if (ch.isSocials)      await postSocials(created);
      if (ch.isNotifPicker)  await postNotifPicker(created);
      console.log(`  📌 ${ch.name}`);
    }
  }
  console.log('\n✅ Server build complete!\n');
};

// ══════════════════════════════════════════════
//  PERMISSIONS HELPER
// ══════════════════════════════════════════════
function permsFor(type, roleMap, guild) {
  const everyone = guild.roles.everyone.id;
  const member   = roleMap['✅ Membre']?.id;
  const mod      = roleMap['🛡️ Moderateur']?.id;
  const admin    = roleMap['⚙️ Admin']?.id;

  if (type === 'admin') return [
    { id: everyone, deny:  [PermissionFlagsBits.ViewChannel] },
    { id: mod,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    { id: admin,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
  ].filter(p => p.id);

  if (type === 'member') return [
    { id: everyone, deny:  [PermissionFlagsBits.ViewChannel] },
    { id: member,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions] },
    { id: mod,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
    { id: admin,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages] },
  ].filter(p => p.id);

  // public — everyone can read, only members/mods can type
  return [
    { id: everyone, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
    { id: member,   allow: [PermissionFlagsBits.ViewChannel] },
    { id: mod,      allow: [PermissionFlagsBits.SendMessages] },
    { id: admin,    allow: [PermissionFlagsBits.SendMessages] },
  ].filter(p => p.id);
}

// ══════════════════════════════════════════════
//  CHANNEL MESSAGE TEMPLATES
// ══════════════════════════════════════════════
async function postWelcomeInfo(channel) {
  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle('👋 Welcome to the L3attaR Community!')
    .setDescription(
      'This is the **official Discord server** of **L3attaR** — Valorant streamer & content creator.\n\n' +
      '🔴 **Twitch** → [twitch.tv/l3attar_](https://twitch.tv/l3attar_)\n' +
      '📺 **YouTube** → [youtube.com/@L3attaR](https://www.youtube.com/@L3attaR)\n' +
      '📸 **Instagram** → [l3attar_clips](https://www.instagram.com/l3attar_clips/)\n' +
      '🎵 **TikTok** → [@l3attar_b](https://www.tiktok.com/@l3attar_b)\n' +
      '📘 **Facebook** → [L3attar01](https://www.facebook.com/L3attar01/)'
    )
    .addFields(
      { name: '\u200B', value: '**Getting started:**' },
      { name: '1️⃣ Read the rules', value: 'Check <#rules> before anything else.', inline: true },
      { name: '2️⃣ Verify yourself', value: 'Click the button in <#verify> to unlock all channels.', inline: true },
      { name: '3️⃣ Get notifications', value: 'Choose stream/video alerts in <#get-notified>.', inline: true },
    )
    .setImage('https://static-cdn.jtvnw.net/jtv_user_pictures/l3attar_-channel_offline_image-1920x1080.jpeg')
    .setFooter({ text: 'L3attaR Community · Built with ❤️' });
  await channel.send({ embeds: [embed] });
}

async function postRules(channel) {
  const embed = new EmbedBuilder()
    .setColor('#ED4245')
    .setTitle('📜 Server Rules')
    .setDescription('Follow these rules to keep the community fun and respectful for everyone.\n\u200B')
    .addFields(
      { name: '1️⃣ Respect everyone', value: 'No insults, harassment, hate speech, or discrimination of any kind.' },
      { name: '2️⃣ No spam', value: 'No repeated messages, wall of text, or excessive emojis.' },
      { name: '3️⃣ No NSFW content', value: 'Keep all content clean and appropriate for all ages.' },
      { name: '4️⃣ No self-promotion', value: 'Do not advertise other servers, channels, or social media without permission.' },
      { name: '5️⃣ Speak the right language', value: 'Use the appropriate channel for Arabic, French, or English.' },
      { name: '6️⃣ No spoilers', value: 'Use spoiler tags when discussing story content in games or shows.' },
      { name: '7️⃣ Follow Discord ToS', value: 'You must follow [Discord\'s Terms of Service](https://discord.com/terms) at all times.' },
      { name: '8️⃣ Listen to staff', value: 'Moderators and Admins have final say. Disrespecting staff = instant ban.' },
      { name: '\u200B', value: '*Breaking rules = mute, kick, or permanent ban depending on severity.*' },
    )
    .setFooter({ text: 'Last updated by L3attaR · Rules apply to all members' });
  await channel.send({ embeds: [embed] });
}

async function postVerify(channel) {
  const embed = new EmbedBuilder()
    .setColor('#57F287')
    .setTitle('🔒 Verification Required')
    .setDescription(
      'To keep the server safe, **all new members must verify** before accessing community channels.\n\n' +
      '> ✅ Click the button below to verify your account\n' +
      '> 📜 By verifying, you confirm you have read and agree to the rules\n' +
      '> 🎮 Once verified, you unlock: gaming, stream chat, voice rooms & more!\n\n' +
      '**This takes 1 second.** 👇'
    )
    .setFooter({ text: 'L3attaR Community · Verification Gate' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_btn')
      .setLabel('✅  I Agree — Verify Me')
      .setStyle(ButtonStyle.Success)
  );
  await channel.send({ embeds: [embed], components: [row] });
}

async function postSocials(channel) {
  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle('🔗 L3attaR — All Platforms')
    .setDescription('Follow on every platform to never miss a stream or video!')
    .addFields(
      { name: '🔴 Twitch',    value: '[twitch.tv/l3attar_](https://twitch.tv/l3attar_) — Live streams',       inline: true },
      { name: '📺 YouTube',   value: '[@L3attaR](https://www.youtube.com/@L3attaR) — Videos & VODs',          inline: true },
      { name: '📸 Instagram', value: '[l3attar_clips](https://www.instagram.com/l3attar_clips/) — Clips',     inline: true },
      { name: '🎵 TikTok',    value: '[@l3attar_b](https://www.tiktok.com/@l3attar_b) — Short clips',         inline: true },
      { name: '📘 Facebook',  value: '[L3attar01](https://www.facebook.com/L3attar01/) — Updates',            inline: true },
    )
    .setFooter({ text: 'Use /socials anytime to see these links' });
  await channel.send({ embeds: [embed] });
}

async function postNotifPicker(channel) {
  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setTitle('🔔 Choose Your Notifications')
    .setDescription(
      'Stay updated — pick which alerts you want to receive:\n\n' +
      '> 🟣 **Stream Alerts** — Get pinged the moment L3attaR goes live on Twitch\n' +
      '> 🔴 **Video Alerts** — Get pinged when a new YouTube video is uploaded\n\n' +
      '**You can change or remove anytime!** Select below 👇'
    )
    .setFooter({ text: 'Only you can see your response · No spam, ever' });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('notif_roles')
    .setPlaceholder('📬 Pick your notifications...')
    .setMinValues(0)
    .setMaxValues(2)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('🟣 Stream Alerts')
        .setDescription('Ping when L3attaR goes live on Twitch')
        .setValue('stream')
        .setEmoji('🟣'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🔴 Video Alerts')
        .setDescription('Ping when a new YouTube video drops')
        .setValue('video')
        .setEmoji('🔴'),
    );
  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}
