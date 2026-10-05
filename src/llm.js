// 孔明的大腦：Claude API 或任何 OpenAI 相容端點（例如自架模型、Hermes 用的端點）
import Anthropic from '@anthropic-ai/sdk';
import { cfg } from './config.js';
import { parseJsonLoose, KmError, logger } from './util.js';
import { SCOPE_RULES, redact } from './guard.js';
import { AsyncLocalStorage } from 'node:async_hooks';
export const als = new AsyncLocalStorage();
let usageHook = null; export function onUsage(fn) { usageHook = fn; }

const log = logger('llm');
const modelFor = tier => tier === 'heavy' ? cfg.modelHeavy : tier === 'fast' ? cfg.modelFast : cfg.model;

let anthropic = null;
function anth() { if (!anthropic) anthropic = new Anthropic({ apiKey: cfg.anthropicKey, maxRetries: 2 }); return anthropic; }

async function callAnthropic({ system, messages, tier, maxTokens, images, signal, webSearch }) {
  const msgs = messages.map(m => ({ role: m.role, content: m.content }));
  if (images && images.length) {
    const last = msgs[msgs.length - 1];
    last.content = [...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.base64 } })), { type: 'text', text: String(last.content) }];
  }
  const body = { model: modelFor(tier), max_tokens: maxTokens, system, messages: msgs };
  if (webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: webSearch === true ? 6 : webSearch }];
  const stream = anth().messages.stream(body, { signal });
  const msg = await stream.finalMessage();
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const sources = [];
  for (const b of msg.content) { if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url && !sources.some(s => s.url === r.url)) sources.push({ title: r.title || r.url, url: r.url }); }
  if (webSearch) return { text, truncated: msg.stop_reason === 'max_tokens', usage: msg.usage, sources };
  return { text, truncated: msg.stop_reason === 'max_tokens', usage: msg.usage };
}

async function callOpenAI({ system, messages, tier, maxTokens, images, signal, base, key, model }) {
  const msgs = [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))];
  if (images && images.length) {
    const last = msgs[msgs.length - 1];
    last.content = [{ type: 'text', text: String(last.content) }, ...images.map(im => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.base64}` } }))];
  }
  const r = await fetch(`${base || cfg.openaiBase}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', ...((key ?? cfg.openaiKey) ? { authorization: `Bearer ${key ?? cfg.openaiKey}` } : {}) },
    body: JSON.stringify({ model: model || modelFor(tier), messages: msgs, max_tokens: maxTokens, temperature: 0.4 }),
  });
  if (!r.ok) throw new Error(`模型端點回應 ${r.status}：${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const ch = j.choices && j.choices[0];
  return { text: (ch && ch.message && ch.message.content) || '', truncated: ch && ch.finish_reason === 'length', usage: j.usage };
}

let impl = null; // 測試時可替換
export function setLLM(fake) { impl = fake; }

/** 一般文字回覆 */
export async function text(o) {
  const args = { tier: 'default', maxTokens: 4000, ...o };
  args.system = cfg.strictScope ? `${args.system || ''}\n\n${SCOPE_RULES}` : (args.system || '');
  args.messages = args.messages.map(m => ({ ...m, content: redact(m.content).text }));
  const t0 = Date.now();
  try {
    const ctx = als.getStore() || {};
    if (ctx.private) {
      if (!cfg.privateBase) throw new KmError('這是機密案件，內容不能送到外部模型；請管理員設定自架模型（KM_PRIVATE_LLM_BASE）後再交辦。');
      args.webSearch = false; Object.assign(args, { base: cfg.privateBase, key: cfg.privateKey, model: cfg.privateModel || undefined });
    }
    const r = impl ? await impl.text(args) : ((ctx.private || cfg.llmProvider === 'openai') ? await callOpenAI(args) : await callAnthropic(args));
    try { usageHook && usageHook({ label: args.label, tier: args.tier, usage: r.usage, userId: ctx.userId, private: !!ctx.private }); } catch (e) {}
    log.info(`${args.label || 'call'} ${modelFor(args.tier)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${r.text.length} 字${r.truncated ? '（截斷）' : ''}`);
    return r;
  } catch (e) {
    if (e && e.km) throw e;
    if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) throw new KmError('已停止。');
    log.error(args.label || 'call', e && e.message);
    const s = e && (e.status || e.statusCode);
    if (s === 401 || s === 403) throw new KmError('模型金鑰無效或沒有權限，請管理員檢查 ANTHROPIC_API_KEY／OPENAI_API_KEY。');
    if (s === 429) throw new KmError('模型呼叫太頻繁或已達用量上限，請稍後再交辦。');
    if (s === 529 || s === 503) throw new KmError('模型服務暫時忙碌，請稍後再試。');
    throw new KmError('連線到模型時出了問題，請稍後再試。');
  }
}

/** 要求只回 JSON，寬鬆解析 */
export async function json(o) {
  const r = await text({ maxTokens: 8000, ...o, system: (o.system || '') + '\n你的回覆會被程式解析：只輸出一個 JSON 值，不要加任何說明文字。' });
  const v = parseJsonLoose(r.text);
  if (v === undefined) throw new KmError(r.truncated ? '內容太長被截斷，請縮小範圍再交辦一次。' : '回覆格式不完整，請再交辦一次。');
  return v;
}

export const canWebSearch = () => cfg.llmProvider === 'anthropic' && cfg.webSearch && !(als.getStore() || {}).private;
