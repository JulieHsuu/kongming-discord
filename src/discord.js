// Discord 介面：把頻道訊息交給孔明的大腦，把孔明的回覆、檔案與按鈕送回頻道
import fs from 'node:fs';
import path from 'node:path';
import {
  Client, GatewayIntentBits, Partials, Events, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, REST, Routes, SlashCommandBuilder, PermissionsBitField, ActivityType, MessageFlags,
} from 'discord.js';
import { cfg, ROOT } from './config.js';
import * as brain from './brain.js';
import { cut, logger } from './util.js';

const log = logger('discord');
const STYLE = { primary: ButtonStyle.Primary, success: ButtonStyle.Success, secondary: ButtonStyle.Secondary, danger: ButtonStyle.Danger };
export const PERMS = new PermissionsBitField([
  'ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'UseApplicationCommands',
]).bitfield;

function split(text, n = 1900) {
  const out = []; let s = String(text || '');
  while (s.length > n) { let i = s.lastIndexOf('\n', n); if (i < n * 0.5) i = n; out.push(s.slice(0, i)); s = s.slice(i).replace(/^\n/, ''); }
  if (s.trim()) out.push(s);
  return out;
}
function rows(buttons) {
  const bs = (buttons || []).slice(0, 25).map(b => b.url
    ? new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(cut(b.label, 78)).setURL(b.url)
    : new ButtonBuilder().setStyle(STYLE[b.style] || ButtonStyle.Secondary).setLabel(cut(b.label, 78)).setCustomId(b.id));
  const r = []; for (let i = 0; i < bs.length; i += 5) r.push(new ActionRowBuilder().addComponents(...bs.slice(i, i + 5)));
  return r;
}
function payload(o) {
  const p = {};
  if (o.content !== undefined) p.content = cut(o.content, 2000);
  if (o.embeds) p.embeds = o.embeds;
  if (o.files) p.files = o.files.map(f => new AttachmentBuilder(f.buffer, { name: f.name }));
  if (o.buttons) p.components = rows(o.buttons);
  p.allowedMentions = { parse: [] };
  return p;
}
const ownText = o => [o.content, ...(o.embeds || []).map(e => `${e.title || ''} ${e.description || ''}`)].filter(Boolean).join('\n');

function makeIO(channel, client) {
  const canThread = () => {
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return false;
    const p = channel.permissionsFor && channel.permissionsFor(client.user);
    return !!(p && p.has(PermissionsBitField.Flags.CreatePublicThreads) && p.has(PermissionsBitField.Flags.SendMessagesInThreads));
  };
  const io = {
    channelId: channel.id,
    async post(o) {
      const parts = split(o.content || '');
      let last = null;
      for (let i = 0; i < Math.max(1, parts.length); i++) {
        const isLast = i >= parts.length - 1;
        const body = isLast ? { ...o, content: parts[i] ?? (o.content === undefined ? undefined : '') } : { content: parts[i] };
        last = await channel.send(payload(body));
      }
      brain.recordOwn(channel.id, last.id, ownText(o));
      return { message: last, async edit(e) { await last.edit(payload(e)); if (e.embeds) brain.recordOwn(channel.id, last.id + 'e', ownText(e)); } };
    },
    async say(text) { let h = null; for (const part of split(text)) h = await io.post({ content: part }); return h; },
    typing() { const tick = () => channel.sendTyping && channel.sendTyping().catch(() => {}); tick(); const t = setInterval(tick, 8000); return () => clearInterval(t); },
    async thread(name, from) {
      if (!canThread()) return io;
      try {
        const msg = (from && from.message) || await channel.send(payload({ content: `🧵 ${name}` }));
        const th = await msg.startThread({ name: cut(name, 95), autoArchiveDuration: 1440 });
        return makeIO(th, client);
      } catch (e) { log.warn('thread', e.message); return io; }
    },
  };
  return io;
}

export function commandDef() {
  return new SlashCommandBuilder().setName('kongming').setDescription('孔明：顧問協作型數位員工').setNameLocalizations({ 'zh-TW': '孔明' })
    .addSubcommand(s => s.setName('help').setDescription('孔明會做什麼、怎麼交辦').setNameLocalizations({ 'zh-TW': '說明' }))
    .addSubcommand(s => s.setName('cases').setDescription('列出案件').setNameLocalizations({ 'zh-TW': '案件' }))
    .addSubcommand(s => s.setName('use').setDescription('切換這個頻道的案件').setNameLocalizations({ 'zh-TW': '切換' })
      .addStringOption(o => o.setName('name').setDescription('企業名稱').setNameLocalizations({ 'zh-TW': '企業' }).setRequired(true)))
    .addSubcommand(s => s.setName('status').setDescription('目前案件的狀態與待辦').setNameLocalizations({ 'zh-TW': '狀態' }))
    .addSubcommand(s => s.setName('mode').setDescription('這個頻道要不要讓孔明主動做事').setNameLocalizations({ 'zh-TW': '模式' })
      .addStringOption(o => o.setName('mode').setDescription('auto 主動做／ask 先問／off 不主動').setNameLocalizations({ 'zh-TW': '模式' }).setRequired(true)
        .addChoices({ name: 'auto：符合職能時主動把工作做好', value: 'auto' }, { name: 'ask：先問大家再做', value: 'ask' }, { name: 'off：只在被叫到時工作', value: 'off' })))
    .toJSON();
}

export async function startDiscord() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message],
  });
  const allowed = gid => !gid || !cfg.guildIds.length || cfg.guildIds.includes(gid);
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  const register = async g => { if (!allowed(g.id)) return; try { await rest.put(Routes.applicationGuildCommands(client.application.id, g.id), { body: [commandDef()] }); } catch (e) { log.warn(`指令註冊失敗 ${g.name}`, e.message); } };

  client.once(Events.ClientReady, async c => {
    log.info(`孔明上線：${c.user.tag}，在 ${c.guilds.cache.size} 個伺服器`);
    log.info(`邀請連結：https://discord.com/oauth2/authorize?client_id=${c.application.id}&scope=bot%20applications.commands&permissions=${PERMS}`);
    c.user.setPresence({ activities: [{ type: ActivityType.Custom, name: 'custom', state: '顧問協作型數位員工・@我交辦工作' }], status: 'online' });
    if (cfg.setAvatar) { try { await c.user.setAvatar(fs.readFileSync(path.join(ROOT, 'assets', 'avatar.png'))); log.info('已更新頭像'); } catch (e) { log.warn('頭像更新失敗', e.message); } }
    for (const g of c.guilds.cache.values()) await register(g);
  });
  client.on(Events.GuildCreate, g => register(g));

  client.on(Events.MessageCreate, async msg => {
    try {
      if (msg.author.bot || msg.system) return;
      if (!allowed(msg.guildId)) return;
      const me = client.user, ch = msg.channel;
      const isThread = typeof ch.isThread === 'function' && ch.isThread();
      let replyToMe = false;
      if (msg.reference && msg.reference.messageId) { const ref = await msg.fetchReference().catch(() => null); replyToMe = !!(ref && ref.author && ref.author.id === me.id); }
      const m = {
        id: msg.id, channelId: msg.channelId, parentId: isThread ? ch.parentId : null, guildId: msg.guildId || null,
        isDM: ch.type === ChannelType.DM, isOwnThread: !!(isThread && ch.ownerId === me.id),
        mentionsMe: msg.mentions.users.has(me.id) || !!(msg.guild && msg.mentions.roles.some(r => r.tags && r.tags.botId === me.id)),
        replyToMe,
        author: { id: msg.author.id, name: (msg.member && msg.member.displayName) || msg.author.globalName || msg.author.username },
        text: String(msg.content || '').replace(new RegExp(`<@!?${me.id}>`, 'g'), '').replace(/<@&\d+>/g, '').trim(),
        attachments: [...msg.attachments.values()].map(a => ({ name: a.name, url: a.url, contentType: a.contentType || '', size: a.size })),
        at: new Date(msg.createdTimestamp).toISOString(),
      };
      await brain.onMessage(m, makeIO(ch, client));
    } catch (e) { log.error('message', e); }
  });

  client.on(Events.InteractionCreate, async it => {
    try {
      if (it.isButton() && it.customId.startsWith('km:')) {
        const user = { id: it.user.id, name: (it.member && it.member.displayName) || it.user.globalName || it.user.username };
        const r = await brain.onButton(it.customId, user, makeIO(it.channel, client));
        if (r.clearButtons) await it.update({ content: cut(`${it.message.content || ''}\n${r.text}`, 2000), components: [] });
        else await it.reply({ content: r.text, flags: MessageFlags.Ephemeral });
        return;
      }
      if (it.isChatInputCommand() && it.commandName === 'kongming') {
        const sub = it.options.getSubcommand();
        const text = brain.onCommand(sub, { name: it.options.getString('name'), mode: it.options.getString('mode') }, { channelId: it.channelId, guildId: it.guildId });
        await it.reply({ content: cut(text, 2000), allowedMentions: { parse: [] } });
      }
    } catch (e) { log.error('interaction', e); try { if (!it.replied) await it.reply({ content: '這個操作沒有成功，請再試一次。', flags: MessageFlags.Ephemeral }); } catch (e2) {} }
  });

  try { await client.login(cfg.discordToken); }
  catch (e) {
    if (/disallowed intents/i.test(e.message || '')) log.error('登入失敗：請到 Discord Developer Portal → Bot，打開「MESSAGE CONTENT INTENT」後再啟動。');
    else if (/invalid token|TokenInvalid/i.test(e.message || e.code || '')) log.error('登入失敗：DISCORD_TOKEN 不正確，請到 Developer Portal → Bot → Reset Token 取得新的。');
    else log.error('登入失敗', e);
    throw e;
  }
  return client;
}
