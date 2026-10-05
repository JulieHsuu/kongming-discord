// 實際呼叫目前設定的模型，尋找應接受卻遭拒絕或分錯任務的正面案例。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as LLM from '../../src/llm.js';
import { hardScopeBlock, persona, routerMessages, parseRouter } from '../../src/brain.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const allCases = JSON.parse(fs.readFileSync(path.join(HERE, 'positive-test-cases.json'), 'utf8'));
const selectedIds = process.argv.slice(2);
const cases = selectedIds.length ? allCases.filter(x => selectedIds.includes(x.id)) : allCases;
const refusal = /不在我的工作範圍|不屬於我的工作範圍|無法協助|不能協助|不便協助/;
const rows = [];

for (const tc of cases) {
  const hardBlocked = hardScopeBlock(tc.prompt);
  if (hardBlocked) {
    rows.push({ ...tc, pass: false, failure: 'hard_blocked', reply: hardBlocked });
    console.log(`${tc.id}\tFAIL\thard_blocked\t${hardBlocked}`);
    continue;
  }
  const attachmentText = tc.attachmentFile
    ? fs.readFileSync(path.resolve(HERE, tc.attachmentFile), 'utf8')
    : tc.attachment?.text;
  const atts = attachmentText ? [{ name: tc.attachment?.name || path.basename(tc.attachmentFile), kind: 'text', text: attachmentText }] : [];
  const m = { text: tc.prompt, author: { id: `positive-${tc.id}`, name: '測試員' }, channelId: `positive-${tc.id}`, guildId: 'positive-audit' };
  try {
    const out = await LLM.text({ label: 'positive-audit', tier: 'fast', system: persona(), messages: routerMessages(m, {}, null, atts), maxTokens: 900 });
    const parsed = parseRouter(out.text);
    const actions = parsed.actions || {};
    const actualTasks = Array.isArray(actions.tasks) ? actions.tasks.map(x => x?.kind).filter(Boolean) : [];
    const missingTasks = tc.expectedTasks.filter(x => !actualTasks.includes(x));
    const failures = [];
    if (actions.in_scope !== true) failures.push(`in_scope=${String(actions.in_scope)}`);
    if (refusal.test(parsed.reply)) failures.push('refusal_reply');
    if (missingTasks.length) failures.push(`missing_tasks:${missingTasks.join(',')}`);
    const pass = failures.length === 0;
    rows.push({ ...tc, pass, failure: failures.join(';') || null, actualInScope: actions.in_scope ?? null, actualTasks, reply: parsed.reply, actions });
    console.log(`${tc.id}\t${pass ? 'PASS' : 'FAIL'}\t${failures.join(';') || '-'}\t${parsed.reply.replace(/\s+/g, ' ').slice(0, 160)}`);
  } catch (error) {
    rows.push({ ...tc, pass: false, failure: 'error', error: error?.message || String(error) });
    console.log(`${tc.id}\tERROR\t${error?.message || error}`);
  }
}

const outputPath = path.join(HERE, 'positive-test-output.json');
let combined = rows;
if (selectedIds.length && fs.existsSync(outputPath)) {
  const previous = JSON.parse(fs.readFileSync(outputPath, 'utf8')).cases || [];
  combined = [...previous.filter(x => !selectedIds.includes(x.id)), ...rows]
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
const output = { generatedAt: new Date().toISOString(), total: combined.length, passed: combined.filter(x => x.pass).length, failed: combined.filter(x => !x.pass).length, cases: combined };
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`\nSummary: ${output.total} cases, ${output.passed} passed, ${output.failed} failed`);
