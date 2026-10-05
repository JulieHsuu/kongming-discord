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
import { startSchedule } from './schedule.js';
import * as gov from './governance.js';
import { guildAllowed, channelAllowed, userAllowed, userIsAdmin, userIsManager } from './guard.js';
// 只給本人看的指令回覆（個人資料、待辦、團隊看板、成效）
const EPHEMERAL = new Set(['me', 'mydata', 'todo', 'pipeline', 'prefs', 'team', 'metrics', 'health', 'secret', 'kbdel']);

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
  p.allowedMentions = o.mentions && o.mentions.length ? { users: o.mentions } : { parse: [] };
  return p;
}
const ownText = o => [o.content, ...(o.embeds || []).map(e => `${e.title || ''} ${e.description || ''}`)].filter(Boolean).join('\n');

export function makeIO(channel, client) {
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

const opt = (o, name, zh, desc, req = false) => o.setName(name).setDescription(desc).setNameLocalizations({ 'zh-TW': zh }).setRequired(req);
const ONOFF = [{ name: '開', value: 'on' }, { name: '關', value: 'off' }];
/** 兩個指令：/孔明（每位同事日常用）、/孔明管理（管理員與主管）。Discord 每個指令的文字總長上限 4000 字，所以拆開。 */
export function commandDefs() {
  const main = new SlashCommandBuilder().setName('kongming').setDescription('孔明：顧問協作型數位員工').setNameLocalizations({ 'zh-TW': '孔明' })
    .addSubcommand(s => s.setName('help').setDescription('孔明會做什麼、怎麼交辦').setNameLocalizations({ 'zh-TW': '說明' }))
    .addSubcommand(s => s.setName('guide').setDescription('新同事導覽：三分鐘學會跟孔明共事').setNameLocalizations({ 'zh-TW': '新人導覽' }))
    .addSubcommand(s => s.setName('cases').setDescription('列出案件').setNameLocalizations({ 'zh-TW': '案件' }))
    .addSubcommand(s => s.setName('use').setDescription('切換這個頻道的案件').setNameLocalizations({ 'zh-TW': '切換' }).addStringOption(o => opt(o, 'name', '企業', '企業名稱', true)))
    .addSubcommand(s => s.setName('status').setDescription('目前案件的狀態、時間軸與待辦').setNameLocalizations({ 'zh-TW': '狀態' }))
    .addSubcommand(s => s.setName('todo').setDescription('我的待辦（跨案件）').setNameLocalizations({ 'zh-TW': '待辦' }).addStringOption(o => opt(o, 'name', '完成', '完成的待辦編號，例如 2')))
    .addSubcommand(s => s.setName('scout').setDescription('商機專欄：推薦可以去提案的廠商或單位').setNameLocalizations({ 'zh-TW': '商機' }).addStringOption(o => opt(o, 'name', '方向', '指定方向或對象，例如「食品業」「工業局」')))
    .addSubcommand(s => s.setName('pipeline').setDescription('我採用的商機推進到哪裡').setNameLocalizations({ 'zh-TW': '商機追蹤' }))
    .addSubcommand(s => s.setName('me').setDescription('我的工作輪廓、角色與每日推薦').setNameLocalizations({ 'zh-TW': '我的方向' })
      .addStringOption(o => opt(o, 'name', '方向', '想推的方向、專長產業、負責地區'))
      .addStringOption(o => opt(o, 'subscribe', '訂閱', '每天收到專屬商機推薦').addChoices(...ONOFF))
      .addStringOption(o => opt(o, 'deliver', '送達', '推薦送到哪裡').addChoices({ name: '私訊', value: 'dm' }, { name: '商機頻道', value: 'channel' }))
      .addStringOption(o => opt(o, 'role', '角色', '孔明依角色調整回答').addChoices({ name: '新人', value: '新人' }, { name: '資深顧問', value: '資深' }, { name: '主管', value: '主管' }, { name: '技術專家', value: '專家' }))
      .addStringOption(o => opt(o, 'coach', '新手', '產出附說明與自我檢核').addChoices(...ONOFF)))
    .addSubcommand(s => s.setName('mydata').setDescription('孔明記了我哪些資料（匯出或刪除）').setNameLocalizations({ 'zh-TW': '我的資料' })
      .addStringOption(o => opt(o, 'forget', '刪除', '輸入 all 刪除孔明記的我的資料')))
    .addSubcommand(s => s.setName('check').setDescription('查院內有沒有人在跑這個客戶').setNameLocalizations({ 'zh-TW': '查客戶' }).addStringOption(o => opt(o, 'name', '名稱', '企業或單位名稱', true)))
    .addSubcommand(s => s.setName('experts').setDescription('院內誰會這個：找協作單位').setNameLocalizations({ 'zh-TW': '找專家' }).addStringOption(o => opt(o, 'name', '關鍵字', '技術或議題，例如「影像辨識」「碳盤查」', true)))
    .addSubcommand(s => s.setName('kb').setDescription('院內知識庫：SOP、規範、範本').setNameLocalizations({ 'zh-TW': '知識庫' }).addStringOption(o => opt(o, 'name', '關鍵字', '查詢關鍵字（不填則列出文件）')))
    .addSubcommand(s => s.setName('library').setDescription('團隊案例').setNameLocalizations({ 'zh-TW': '案例' }).addStringOption(o => opt(o, 'name', '關鍵字', '產業、計畫、痛點')))
    .addSubcommand(s => s.setName('today').setDescription('今日提醒：拜訪、待辦、科專截止').setNameLocalizations({ 'zh-TW': '今日' }))
    .addSubcommand(s => s.setName('prefs').setDescription('孔明記得的工作偏好').setNameLocalizations({ 'zh-TW': '偏好' }).addStringOption(o => opt(o, 'forget', '忘記', '要忘記的編號，例如 2 或 t1')))
    .toJSON();
  const admin = new SlashCommandBuilder().setName('kongming-admin').setDescription('孔明管理：主管與管理員').setNameLocalizations({ 'zh-TW': '孔明管理' })
    .addSubcommand(s => s.setName('team').setDescription('團隊看板：每個人的案件、待辦、逾期').setNameLocalizations({ 'zh-TW': '團隊' }))
    .addSubcommand(s => s.setName('metrics').setDescription('孔明成效與模型用量').setNameLocalizations({ 'zh-TW': '成效' }).addStringOption(o => opt(o, 'name', '天數', '統計天數，預設 30')))
    .addSubcommand(s => s.setName('health').setDescription('運作狀況：進行中工作、錯誤').setNameLocalizations({ 'zh-TW': '狀況' }))
    .addSubcommand(s => s.setName('mode').setDescription('這個頻道要不要讓孔明主動做事').setNameLocalizations({ 'zh-TW': '模式' })
      .addStringOption(o => opt(o, 'mode', '模式', 'auto 主動做／ask 先問／off 不主動', true).addChoices({ name: 'auto：主動把工作做好', value: 'auto' }, { name: 'ask：先問再做', value: 'ask' }, { name: 'off：被叫到才工作', value: 'off' })))
    .addSubcommand(s => s.setName('secret').setDescription('這個案件設為機密（只用自架模型）').setNameLocalizations({ 'zh-TW': '機密' }).addStringOption(o => opt(o, 'mode', '設定', '開或關').addChoices(...ONOFF)))
    .addSubcommand(s => s.setName('kbdel').setDescription('從知識庫移除文件').setNameLocalizations({ 'zh-TW': '知識庫移除' }).addStringOption(o => opt(o, 'name', '文件', '文件名稱', true)))
    .addSubcommand(s => s.setName('kill').setDescription('全院緊急停止孔明').setNameLocalizations({ 'zh-TW': '緊急停止' }).addStringOption(o => opt(o, 'name', '原因', '原因')))
    .addSubcommand(s => s.setName('resume').setDescription('解除緊急停止').setNameLocalizations({ 'zh-TW': '恢復' }))
    .toJSON();
  return [main, admin];
}
export const commandDef = () => commandDefs()[0];
/** Discord 計算上限用的字數（名稱、說明、在地化、選項值） */
export function commandChars(def) {
  let n = 0; const add = o => { n += String(o.name || '').length + String(o.description || '').length + Object.values(o.name_localizations || {}).join('').length + Object.values(o.description_localizations || {}).join('').length; for (const c of o.choices || []) n += String(c.name).length + String(c.value).length; for (const x of o.options || []) add(x); };
  add(def); return n;
}

export async function startDiscord() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message],
  });
  const allowed = gid => guildAllowed(gid);
  // 私訊：必須是允許伺服器裡、具備身分組的成員
  async function rolesOf(userId, guildId) {
    const gids = guildId ? [guildId] : (cfg.guildIds.length ? cfg.guildIds : [...client.guilds.cache.keys()]);
    for (const gid of gids) { const g = client.guilds.cache.get(gid); if (!g || !guildAllowed(gid)) continue; const mem = await g.members.fetch(userId).catch(() => null); if (mem) return [...mem.roles.cache.keys()]; }
    return null;
  }
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  const register = async g => { if (!allowed(g.id)) return; try { await rest.put(Routes.applicationGuildCommands(client.application.id, g.id), { body: commandDefs() }); } catch (e) { log.warn(`指令註冊失敗 ${g.name}`, e.message); } };

  client.once(Events.ClientReady, async c => {
    log.info(`孔明上線：${c.user.tag}，在 ${c.guilds.cache.size} 個伺服器`);
    log.info(`邀請連結：https://discord.com/oauth2/authorize?client_id=${c.application.id}&scope=bot%20applications.commands&permissions=${PERMS}`);
    c.user.setPresence({ activities: [{ type: ActivityType.Custom, name: 'custom', state: '顧問協作型數位員工・@我交辦工作' }], status: 'online' });
    if (cfg.setAvatar) { try { await c.user.setAvatar(fs.readFileSync(path.join(ROOT, 'assets', 'avatar.png'))); log.info('已更新頭像'); } catch (e) { log.warn('頭像更新失敗', e.message); } }
    for (const g of c.guilds.cache.values()) await register(g);
    const getIOx = async id => { const ch = await c.channels.fetch(id).catch(() => null); return ch && ch.isTextBased() ? makeIO(ch, client) : null; };
    gov.onAlert(async text => { if (!cfg.adminChannel) return; const io = await getIOx(cfg.adminChannel); if (io) await io.post({ content: text }); });
    const n = await brain.resumeAfterRestart(getIOx).catch(() => 0);
    if (cfg.adminChannel) { const io = await getIOx(cfg.adminChannel); if (io) await io.post({ content: `✅ 孔明已上線${n ? `，有 ${n} 項中斷的工作已詢問是否重做` : ''}。` }).catch(() => {}); }
    startSchedule({ getIO: async id => { const ch = await c.channels.fetch(id).catch(() => null); return ch && ch.isTextBased() ? makeIO(ch, client) : null; }, runPrep: (caseId, io) => brain.runPrepFor(caseId, io), runScout: (io, forUser) => brain.runScoutFor(io, { guildId: cfg.guildIds[0] || null, forUser }), getDM: async uid => { const u = await c.users.fetch(uid).catch(() => null); const dm = u && await u.createDM().catch(() => null); return dm ? makeIO(dm, client) : null; } });
  });
  client.on(Events.GuildCreate, g => register(g));
  client.on(Events.ShardDisconnect, (ev, id) => log.warn(`Discord 連線中斷（shard ${id}），自動重連中`));
  client.on(Events.ShardReconnecting, id => log.info(`重新連線 Discord（shard ${id}）`));
  client.on(Events.ShardResume, id => log.info(`Discord 已恢復連線（shard ${id}）`));
  client.on(Events.Error, e => gov.alert('Discord 用戶端錯誤', e && e.message));

  client.on(Events.MessageCreate, async msg => {
    try {
      if (msg.author.bot || msg.system) return;
      if (!allowed(msg.guildId)) return;
      const me = client.user, ch = msg.channel;
      const isThread = typeof ch.isThread === 'function' && ch.isThread();
      if (!channelAllowed(msg.channelId, isThread ? ch.parentId : null)) return;
      const roles = msg.member ? [...msg.member.roles.cache.keys()] : await rolesOf(msg.author.id, msg.guildId);
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
        allowed: !!roles && userAllowed(roles), admin: !!roles && userIsAdmin(roles),
      };
      await brain.onMessage(m, makeIO(ch, client));
    } catch (e) { log.error('message', e); }
  });

  client.on(Events.InteractionCreate, async it => {
    try {
      if (it.isButton() && it.customId.startsWith('km:')) {
        const roles = it.member ? [...it.member.roles.cache.keys()] : await rolesOf(it.user.id, it.guildId);
        const user = { id: it.user.id, name: (it.member && it.member.displayName) || it.user.globalName || it.user.username, allowed: !!roles && userAllowed(roles), admin: !!roles && userIsAdmin(roles) };
        const r = await brain.onButton(it.customId, user, makeIO(it.channel, client));
        if (r.clearButtons) {
          // 已處理的按鈕拿掉，但保留連結按鈕（打開 Demo、播放影片、下載大檔）
          const links = (it.message.components || []).flatMap(row => row.components || []).filter(b => b.style === ButtonStyle.Link && b.url).map(b => ({ label: b.label, url: b.url }));
          await it.update({ content: cut(`${it.message.content || ''}\n${r.text}`, 2000), components: rows([...links, ...(r.buttons || [])]) });
        }
        else await it.reply({ content: r.text, flags: MessageFlags.Ephemeral });
        return;
      }
      if (it.isChatInputCommand() && (it.commandName === 'kongming' || it.commandName === 'kongming-admin')) {
        const sub = it.options.getSubcommand();
        const roles = it.member ? [...it.member.roles.cache.keys()] : await rolesOf(it.user.id, it.guildId);
        const r = brain.onCommand(sub, { name: it.options.getString('name'), mode: it.options.getString('mode'), forget: it.options.getString('forget'), subscribe: it.options.getString('subscribe'), deliver: it.options.getString('deliver'), coach: it.options.getString('coach'), role: it.options.getString('role') }, { channelId: it.channelId, guildId: it.guildId, userId: it.user.id, userName: (it.member && it.member.displayName) || it.user.username, io: makeIO(it.channel, client), allowed: !!roles && userAllowed(roles), admin: !!roles && userIsAdmin(roles), manager: !!roles && userIsManager(roles) });
        const o = typeof r === 'string' ? { content: r, ephemeral: EPHEMERAL.has(sub) } : (r || { content: '—' });
        await it.reply({ content: cut(o.content, 2000), files: (o.files || []).map(f => new AttachmentBuilder(f.buffer, { name: f.name })), allowedMentions: { parse: [] }, ...(o.ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
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
