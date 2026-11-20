require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");

// All bot configuration is kept here and loaded from environment variables.
const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mainGuildId: process.env.MAIN_GUILD_ID,
  controlChannelId: process.env.CONTROL_CHANNEL_ID,
  accessRoleId: process.env.ACCESS_ROLE_ID,
  logsGuildId: process.env.LOGS_GUILD_ID,
  logsChannelId: process.env.LOGS_CHANNEL_ID,
  sessionTtlMs: Math.max(60000, Number(process.env.SESSION_TTL_MS) || 600000)
};

const requiredConfig = [
  "DISCORD_TOKEN",
  "MAIN_GUILD_ID",
  "CONTROL_CHANNEL_ID",
  "ACCESS_ROLE_ID",
  "LOGS_GUILD_ID",
  "LOGS_CHANNEL_ID"
];
const missingConfig = requiredConfig.filter((key) => !process.env[key] || process.env[key].startsWith("PUT_"));
if (missingConfig.length) {
  console.error("[CONFIG] Missing environment variables:", missingConfig.join(", "));
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Drafts are temporary. Restarting the bot clears unfinished requests.
const sessions = new Map();
const pendingCleanupTimers = new Map();

const COLORS = {
  primary: 0x5865F2,
  success: 0x57F287,
  danger: 0xED4245
};

function makeId(action, sessionId) {
  return `${action}:${sessionId}`;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function hasAccess(member) {
  return Boolean(member?.roles?.cache?.has(config.accessRoleId));
}

function createSession(message) {
  const session = {
    id: message.id,
    sourceUserId: message.author.id,
    sourceUserTag: message.author.tag,
    sourceUsername: message.author.username,
    sourceChannelId: message.channel.id,
    sourceMessageId: message.id,
    setupMessageId: null,
    body: message.content.trim(),
    attachments: [...message.attachments.values()].map((file) => ({
      url: file.url,
      name: file.name || "attachment",
      contentType: file.contentType || ""
    })),
    targetChannelId: null,
    mode: null,
    mention: "",
    color: "#5865F2",
    imageUrl: "",
    expiresAt: Date.now() + config.sessionTtlMs
  };
  sessions.set(session.id, session);
  return session;
}

function isValidHex(value) {
  return /^#?[0-9a-fA-F]{6}$/.test(value);
}

function normalizeHex(value) {
  return value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`;
}

function isValidHttpUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// Prevent @everyone written inside the announcement body from becoming an extra ping.
function sanitizeBody(text) {
  return text.replace(/@everyone/gi, "@\u200beveryone").replace(/@here/gi, "@\u200bhere");
}

function parseMention(raw, targetGuild) {
  const value = (raw || "").trim();
  if (!value) {
    return { content: "", allowedMentions: { parse: [] }, description: "بدون منشن", type: "none" };
  }

  if (value.toLowerCase() === "everyone") {
    return {
      content: "@everyone",
      allowedMentions: { parse: ["everyone"] },
      description: "@everyone",
      type: "everyone"
    };
  }

  const roleId = value.replace(/[<@&>]/g, "");
  if (!/^\d{17,20}$/.test(roleId)) {
    throw new Error("المنشن غير صحيح. اكتب everyone أو ID رول صحيح، أو اترك الخانة فاضية.");
  }

  const role = targetGuild.roles.cache.get(roleId);
  if (!role) throw new Error("الرول بالـ ID ده مش موجود في السيرفر الأساسي.");

  return {
    content: `<@&${role.id}>`,
    allowedMentions: { parse: [], roles: [role.id] },
    description: `Role: ${role.name} (${role.id})`,
    type: "role"
  };
}

function buildStartRows(sessionId) {
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(makeId("choose_channel", sessionId))
    .setPlaceholder("اختار التشانل اللي هتتبعت فيه الرسالة")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);

  const idButton = new ButtonBuilder()
    .setCustomId(makeId("channel_id", sessionId))
    .setLabel("اختيار باستخدام ID")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("🆔");

  return [
    new ActionRowBuilder().addComponents(channelSelect),
    new ActionRowBuilder().addComponents(idButton)
  ];
}

function buildModeRows(sessionId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeId("mode_normal", sessionId))
      .setLabel("رسالة عادية")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("💬"),
    new ButtonBuilder()
      .setCustomId(makeId("mode_embed", sessionId))
      .setLabel("Embed")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🧩")
  )];
}

function buildConfirmRows(sessionId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeId("confirm", sessionId))
      .setLabel("تأكيد الإرسال")
      .setStyle(ButtonStyle.Success)
      .setEmoji("📨"),
    new ButtonBuilder()
      .setCustomId(makeId("cancel", sessionId))
      .setLabel("إلغاء")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("✖️")
  )];
}

function buildMentionInput() {
  return new TextInputBuilder()
    .setCustomId("mention")
    .setLabel("المنشن (فارغ / everyone / ID الرول)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(30)
    .setPlaceholder("everyone أو 123456789012345678");
}

function buildNormalModal(sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(makeId("normal_modal", sessionId))
    .setTitle("إعداد الرسالة العادية");

  modal.addComponents(new ActionRowBuilder().addComponents(buildMentionInput()));
  return modal;
}

function buildEmbedModal(sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(makeId("embed_modal", sessionId))
    .setTitle("إعداد الـ Embed");

  const color = new TextInputBuilder()
    .setCustomId("color")
    .setLabel("لون الإمبيد بصيغة Hex")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(7)
    .setValue("#5865F2")
    .setPlaceholder("#FF0000");

  const image = new TextInputBuilder()
    .setCustomId("image")
    .setLabel("رابط الصورة (اختياري)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500)
    .setPlaceholder("https://example.com/image.png");

  modal.addComponents(
    new ActionRowBuilder().addComponents(color),
    new ActionRowBuilder().addComponents(image),
    new ActionRowBuilder().addComponents(buildMentionInput())
  );
  return modal;
}

function buildPayload(session, mentionData) {
  if (session.mode === "normal") {
    return {
      content: session.body,
      allowedMentions: { parse: ["everyone", "users", "roles"] }
    };
  }

  const body = sanitizeBody(session.body);

  const embed = new EmbedBuilder()
    .setDescription(body || "*رسالة بدون نص*")
    .setColor(parseInt(session.color.replace("#", ""), 16));

  if (session.imageUrl) embed.setImage(session.imageUrl);

  return {
    content: mentionData.content || null,
    embeds: [embed],
    allowedMentions: mentionData.allowedMentions
  };
}

async function sendMediaSession(session, target) {
  if (!session.attachments?.length) return false;

  if (session.attachments.length > 10) {
    throw new Error("تقدر تبعت بحد أقصى 10 صور أو فيديوهات في الإعلان الواحد.");
  }

  const unsupported = session.attachments.filter((file) =>
    !/^(image|video)\//i.test(file.contentType) &&
    !/\.(png|jpe?g|gif|webp|bmp|mp4|mov|webm|m4v)$/i.test(file.name)
  );
  if (unsupported.length) {
    throw new Error("المرفقات المدعومة حاليًا هي الصور والفيديوهات فقط.");
  }

  const me = await target.guild.members.fetchMe();
  const permissions = target.permissionsFor(me);
  if (!permissions?.has(PermissionsBitField.Flags.AttachFiles)) {
    throw new Error("البوت محتاج صلاحية Attach Files في التشانل دي.");
  }

  await target.send({
    content: session.body || undefined,
    files: session.attachments.map((file) => ({ attachment: file.url, name: file.name })),
    allowedMentions: { parse: ["everyone", "users", "roles"] }
  });

  session.mode = "media";
  await writeLog(session, "SUCCESS");
  return true;
}

async function fetchTargetChannel(channelId) {
  const guild = await client.guilds.fetch(config.mainGuildId);
  const channel = await guild.channels.fetch(channelId);

  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    throw new Error("التشانل مش موجود أو مش Text/Announcement Channel في السيرفر الأساسي.");
  }

  const me = await guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);

  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) ||
      !permissions?.has(PermissionsBitField.Flags.SendMessages)) {
    throw new Error("البوت محتاج صلاحيات View Channel و Send Messages في التشانل دي.");
  }

  return channel;
}

function clearPendingCleanup(sessionId) {
  const timer = pendingCleanupTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  pendingCleanupTimers.delete(sessionId);
}

function schedulePendingCleanup(session) {
  clearPendingCleanup(session.id);
  const timer = setTimeout(async () => {
    pendingCleanupTimers.delete(session.id);
    sessions.delete(session.id);

    try {
      const channel = await client.channels.fetch(session.sourceChannelId);
      if (!channel?.isTextBased()) return;

      const sourceMessage = await channel.messages.fetch(session.sourceMessageId).catch(() => null);
      if (sourceMessage) await sourceMessage.delete().catch(() => {});

      if (session.setupMessageId) {
        const setupMessage = await channel.messages.fetch(session.setupMessageId).catch(() => null);
        if (setupMessage) await setupMessage.delete().catch(() => {});
      }
    } catch (error) {
      console.error("[INACTIVITY CLEANUP] Could not delete control messages:", error.message);
    }
  }, 60000);

  pendingCleanupTimers.set(session.id, timer);
}

function scheduleSessionCleanup(session, interaction = null) {
  setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(session.sourceChannelId);
      if (channel?.isTextBased()) {
        const sourceMessage = await channel.messages.fetch(session.sourceMessageId).catch(() => null);
        if (sourceMessage) await sourceMessage.delete().catch(() => {});

        if (session.setupMessageId) {
          const setupMessage = await channel.messages.fetch(session.setupMessageId).catch(() => null);
          if (setupMessage) await setupMessage.delete().catch(() => {});
        }
      }
    } catch (error) {
      console.error("[CLEANUP] Could not delete control messages:", error.message);
    }

    // Also remove the ephemeral preview / ID-selection response when one exists.
    if (interaction?.isRepliable?.() && interaction.webhook) {
      await interaction.deleteReply().catch(() => {});
    }
  }, 10000);
}

async function writeLog(session, status, details = "") {
  try {
    const logGuild = await client.guilds.fetch(config.logsGuildId);
    const logChannel = await logGuild.channels.fetch(config.logsChannelId);

    if (!logChannel?.isTextBased()) {
      console.error("[LOG] Logs channel is not a text channel.");
      return;
    }

    const statusTitle =
      status === "SUCCESS" ? "تم إرسال الإعلان بنجاح" :
      status === "DENIED" ? "محاولة استخدام بدون صلاحية" : "فشل إرسال الإعلان";

    const embed = new EmbedBuilder()
      .setColor(status === "SUCCESS" ? COLORS.success : COLORS.danger)
      .setTitle(statusTitle)
      .addFields(
        { name: "بواسطة", value: `<@!${session.sourceUserId}>\nuser: ${session.sourceUsername || session.sourceUserTag || "Unknown"}\nID: \`${session.sourceUserId}\``, inline: false },
        { name: "نوع العملية", value: session.mode === "normal" ? "رسالة عادية" : session.mode === "embed" ? "Embed" : session.mode || "غير محدد", inline: true },
        { name: "التشانل المستهدف", value: session.targetChannelId ? `<#${session.targetChannelId}>` : "غير محدد", inline: true },
        { name: "المنشن", value: session.mention || "حسب محتوى الرسالة / بدون منشن", inline: true },
        { name: "نص الرسالة", value: (session.body || "بدون نص").slice(0, 1000) },
        ...(session.attachments?.length ? [{
          name: "المرفقات",
          value: session.attachments.map((file) => `📎 ${file.name}`).join("\n").slice(0, 1000),
          inline: false
        }] : [])
      )
      .setTimestamp();

    if (details) embed.addFields({ name: "التفاصيل", value: details.slice(0, 1000) });
    await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error("[LOG] Could not write log:", error.message);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[READY] Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (message.guild.id !== config.mainGuildId) return;
    if (message.channel.id !== config.controlChannelId) return;

    if (!hasAccess(message.member)) {
      const deniedSession = {
        sourceUserId: message.author.id,
        sourceUserTag: message.author.tag,
        sourceUsername: message.author.username,
        sourceChannelId: message.channel.id,
        sourceMessageId: message.id,
        sourceUserMention: `<@!${message.author.id}>`,
        body: message.content.trim(),
        mode: "Unauthorized attempt",
        targetChannelId: null,
        mention: ""
      };

      await writeLog(deniedSession, "DENIED", "شخص لا يمتلك الرتبة المطلوبة حاول استخدام بوت الإعلانات.");

      const denialReply = await message.reply({
        content: "⛔ ليس لديك صلاحية استخدام البوت.",
        allowedMentions: { repliedUser: false }
      });
      setTimeout(async () => {
        await message.delete().catch(() => {});
        await denialReply.delete().catch(() => {});
      }, 5000);
      return;
    }

    const body = message.content.trim();
    const hasAttachments = message.attachments.size > 0;
    if (!body && !hasAttachments) {
      await message.reply("⚠️ ابعت نص الرسالة أو أرفق صورة/فيديو.");
      return;
    }

    const session = createSession(message);
    const setupMessage = await message.reply({
      content: "📢 **تم استلام رسالتك. اختار التشانل اللي عايز تبعت فيه:**",
      components: buildStartRows(session.id),
      allowedMentions: { repliedUser: false }
    });
    session.setupMessageId = setupMessage.id;
    schedulePendingCleanup(session);
  } catch (error) {
    console.error("[MESSAGE]", error);
    await message.reply("حصل خطأ وأنا بجهز الرسالة. راجع لوجات البوت.").catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  const customId = interaction.customId || "";
  if (!customId.includes(":")) return;

  const [action, sessionId] = customId.split(":");
  const session = getSession(sessionId);

  try {
    if (!session) {
      await interaction.reply({ content: "انتهت صلاحية الطلب. ابعت الرسالة من جديد.", ephemeral: true });
      return;
    }

    if (interaction.user.id !== session.sourceUserId) {
      await interaction.reply({ content: "الاختيارات دي لصاحب الطلب فقط.", ephemeral: true });
      return;
    }

    schedulePendingCleanup(session);
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !hasAccess(member)) {
      sessions.delete(sessionId);
      await interaction.reply({ content: "⛔ ليس لديك صلاحية استخدام البوت.", ephemeral: true });
      return;
    }

    if (action === "choose_channel" && interaction.isChannelSelectMenu()) {
      const target = await fetchTargetChannel(interaction.values[0]);
      session.targetChannelId = target.id;

      if (session.attachments?.length) {
        try {
          await sendMediaSession(session, target);
          clearPendingCleanup(sessionId);
          sessions.delete(sessionId);
          await interaction.update({
            content: `✅ تم إرسال الصورة/الفيديو بنجاح في <#${target.id}>.`,
            embeds: [],
            components: []
          });
          scheduleSessionCleanup(session, interaction);
        } catch (sendError) {
          await writeLog(session, "FAILED", sendError.message);
          throw sendError;
        }
        return;
      }

      await interaction.update({
        content: `✅ التشانل المختار: <#${target.id}>\n\n**اختار شكل الرسالة:**`,
        components: buildModeRows(sessionId)
      });
      return;
    }

    if (action === "channel_id" && interaction.isButton()) {
      const modal = new ModalBuilder()
        .setCustomId(makeId("channel_modal", sessionId))
        .setTitle("اختيار التشانل بالـ ID");

      const idInput = new TextInputBuilder()
        .setCustomId("channel_id")
        .setLabel("Channel ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(25)
        .setPlaceholder("123456789012345678");

      modal.addComponents(new ActionRowBuilder().addComponents(idInput));
      await interaction.showModal(modal);
      return;
    }

    if (action === "channel_modal" && interaction.isModalSubmit()) {
      const channelId = interaction.fields.getTextInputValue("channel_id").trim();
      if (!/^\d{17,20}$/.test(channelId)) {
        await interaction.reply({ content: "ID التشانل غير صحيح.", ephemeral: true });
        return;
      }

      const target = await fetchTargetChannel(channelId);
      session.targetChannelId = target.id;

      if (session.attachments?.length) {
        try {
          await sendMediaSession(session, target);
          clearPendingCleanup(sessionId);
          sessions.delete(sessionId);
          await interaction.reply({
            content: `✅ تم إرسال الصورة/الفيديو بنجاح في <#${target.id}>.`,
            ephemeral: true
          });
          scheduleSessionCleanup(session, interaction);
        } catch (sendError) {
          await writeLog(session, "FAILED", sendError.message);
          throw sendError;
        }
        return;
      }

      await interaction.reply({
        content: `✅ التشانل المختار: <#${target.id}>\n\n**اختار شكل الرسالة:**`,
        components: buildModeRows(sessionId),
        ephemeral: true
      });
      return;
    }

    if ((action === "mode_normal" || action === "mode_embed") && interaction.isButton()) {
      if (!session.targetChannelId) {
        await interaction.reply({ content: "اختار التشانل الأول.", ephemeral: true });
        return;
      }

      if (action === "mode_normal") {
        session.mode = "normal";
        session.mention = "";

        if (session.body.length > 1900) {
          await interaction.reply({ content: "الرسالة العادية طويلة جدًا. الحد الأقصى 1900 حرف.", ephemeral: true });
          return;
        }

        const target = await fetchTargetChannel(session.targetChannelId);
        const mentionData = parseMention("", target.guild);

        await target.send(buildPayload(session, mentionData));
        await writeLog(session, "SUCCESS");
        clearPendingCleanup(sessionId);
        sessions.delete(sessionId);

        await interaction.update({
          content: `✅ تم إرسال الرسالة العادية بنجاح في <#${target.id}>.`,
          embeds: [],
          components: []
        });
        scheduleSessionCleanup(session, interaction);
        return;
      }

      session.mode = "embed";
      await interaction.showModal(buildEmbedModal(sessionId));
      return;
    }

    if ((action === "normal_modal" || action === "embed_modal") && interaction.isModalSubmit()) {
      const target = await fetchTargetChannel(session.targetChannelId);

      if (action === "normal_modal") {
        session.mention = interaction.fields.getTextInputValue("mention").trim();
      } else {
        const color = interaction.fields.getTextInputValue("color").trim();
        const imageUrl = interaction.fields.getTextInputValue("image").trim();
        session.mention = interaction.fields.getTextInputValue("mention").trim();

        if (!isValidHex(color)) {
          await interaction.reply({ content: "لون Hex غير صحيح. مثال: #FF0000", ephemeral: true });
          return;
        }
        if (!isValidHttpUrl(imageUrl)) {
          await interaction.reply({ content: "رابط الصورة لازم يبدأ بـ http:// أو https://", ephemeral: true });
          return;
        }

        session.color = normalizeHex(color);
        session.imageUrl = imageUrl;
      }

      if (session.mode === "normal" && session.body.length > 1900) {
        await interaction.reply({ content: "الرسالة العادية طويلة جدًا. الحد الأقصى 1900 حرف.", ephemeral: true });
        return;
      }
      if (session.mode === "embed" && session.body.length > 4000) {
        await interaction.reply({ content: "نص الـ Embed طويل جدًا. قلل النص إلى 4000 حرف أو أقل.", ephemeral: true });
        return;
      }

      const mentionData = parseMention(session.mention, target.guild);
      const previewEmbed = new EmbedBuilder()
        .setColor(session.mode === "embed" ? parseInt(session.color.replace("#", ""), 16) : COLORS.primary)
        .setTitle("Preview — مراجعة الرسالة")
        .addFields(
          { name: "Target", value: `<#${target.id}>`, inline: true },
          { name: "Type", value: session.mode === "embed" ? "Embed" : "Normal", inline: true },
          { name: "Mention", value: mentionData.description, inline: true }
        )
        .setTimestamp();

      if (session.mode === "embed") {
        const innerEmbed = new EmbedBuilder()
          .setDescription(sanitizeBody(session.body) || "*رسالة بدون نص*")
          .setColor(parseInt(session.color.replace("#", ""), 16));
        if (session.imageUrl) innerEmbed.setImage(session.imageUrl);

        await interaction.reply({
          content: mentionData.content || " ",
          embeds: [previewEmbed, innerEmbed],
          components: buildConfirmRows(sessionId),
          ephemeral: true,
          allowedMentions: { parse: [] }
        });
      } else {
        const previewText = [mentionData.content, sanitizeBody(session.body)].filter(Boolean).join("\n");
        await interaction.reply({
          content: `**Preview — مراجعة الرسالة**\n${previewText}\n\nراجع الرسالة قبل التأكيد.`,
          components: buildConfirmRows(sessionId),
          ephemeral: true,
          allowedMentions: { parse: [] }
        });
      }
      return;
    }

    if (action === "confirm" && interaction.isButton()) {
      if (!session.targetChannelId || !session.mode) {
        await interaction.reply({ content: "الطلب ناقص. ابدأ من جديد.", ephemeral: true });
        return;
      }

      const target = await fetchTargetChannel(session.targetChannelId);
      const mentionData = parseMention(session.mention, target.guild);
      const me = await target.guild.members.fetchMe();
      const permissions = target.permissionsFor(me);

      if (session.mode === "embed" && !permissions?.has(PermissionsBitField.Flags.EmbedLinks)) {
        await interaction.reply({ content: "البوت محتاج صلاحية Embed Links في التشانل دي.", ephemeral: true });
        return;
      }
      if (mentionData.type === "everyone" && !permissions?.has(PermissionsBitField.Flags.MentionEveryone)) {
        await interaction.reply({ content: "البوت محتاج صلاحية Mention Everyone في التشانل دي.", ephemeral: true });
        return;
      }

      try {
        await target.send(buildPayload(session, mentionData));
        await writeLog(session, "SUCCESS");
        clearPendingCleanup(sessionId);
        sessions.delete(sessionId);
        await interaction.update({
          content: `✅ تم إرسال الرسالة بنجاح في <#${target.id}>.`,
          embeds: [],
          components: []
        });
        scheduleSessionCleanup(session, interaction);
      } catch (sendError) {
        await writeLog(session, "FAILED", sendError.message);
        throw sendError;
      }
      return;
    }

    if (action === "cancel" && interaction.isButton()) {
      clearPendingCleanup(sessionId);
      sessions.delete(sessionId);
      await interaction.update({
        content: "❌ تم إلغاء الإرسال.",
        embeds: [],
        components: []
      });
    }
  } catch (error) {
    console.error("[INTERACTION]", error);
    const errorMessage = error.message || "حصل خطأ غير متوقع.";
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: `⚠️ ${errorMessage}`, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: `⚠️ ${errorMessage}`, ephemeral: true }).catch(() => {});
      }
    }
  }
});

client.login(config.token).catch((error) => {
  console.error("[LOGIN] Could not log in:", error);
  process.exit(1);
});
