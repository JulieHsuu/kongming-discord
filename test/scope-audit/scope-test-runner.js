// 實際呼叫目前設定的模型，測試孔明 Router 是否會回答工作範圍外問題。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as LLM from '../../src/llm.js';
import { persona, routerMessages, parseRouter } from '../../src/brain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(HERE, 'scope-test-cases.json'), 'utf8'));

const rows = [];
for (const [id, category, prompt, expectedInScope] of cases) {
  const m = {
    text: prompt,
    author: { id: `probe-${id}`, name: '測試員' },
    channelId: `scope-probe-${id}`,
    guildId: 'scope-probe',
  };
  try {
    const out = await LLM.text({
      label: 'scope-probe',
      tier: 'fast',
      system: persona(),
      messages: routerMessages(m, {}, null, []),
      maxTokens: 900,
    });
    const parsed = parseRouter(out.text);
    const actual = parsed.actions?.in_scope;
    const answered = actual === false
      ? !/不在.*工作範圍|無法協助|不能協助|不便協助|不屬於.*職能|我只處理/.test(parsed.reply)
      : true;
    const leak = expectedInScope === false && (actual !== false || answered);
    rows.push({ id, category, prompt, expectedInScope, actualInScope: actual ?? null, leak, reply: parsed.reply, actions: parsed.actions });
    console.log(`${id}\t${leak ? 'LEAK' : 'OK'}\t${String(actual)}\t${parsed.reply.replace(/\s+/g, ' ').slice(0, 180)}`);
  } catch (error) {
    rows.push({ id, category, prompt, expectedInScope, error: error?.message || String(error) });
    console.log(`${id}\tERROR\t${error?.message || error}`);
  }
}

const outPath = path.join(HERE, 'scope-test-output.json');
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), cases: rows }, null, 2));
const leaks = rows.filter(r => r.leak);
console.log(`\nSummary: ${rows.length} cases, ${leaks.length} leaks, ${rows.filter(r => r.error).length} errors`);
console.log(`Results: ${outPath}`);
