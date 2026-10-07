import assert from 'node:assert/strict';
import { cfg } from '../src/config.js';
import * as LLM from '../src/llm.js';
import { researchWeb, searchSources, filterResearchSources } from '../src/web-research.js';

cfg.llmProvider = 'openai'; cfg.webSearch = true; cfg.openaiSearchModel = 'search-test';
cfg.openaiBase = 'https://proxy.example/v1'; cfg.openaiKey = 'test'; cfg.model = 'writer-test';
const requests = [], usage = [];
LLM.onUsage(u => usage.push(u));
const cited = { choices: [{ finish_reason: 'stop', message: { content: '企業官網資料', annotations: [{ type: 'url_citation', url_citation: { title: '官方網站', url: 'https://company.example/?utm_source=search' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
let mode = 'ok';
globalThis.fetch = async (url, options) => {
  if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const body = JSON.parse(options.body); requests.push(body);
  if (body.model === 'search-test') {
    if (mode === 'error') return new Response('{}', { status: 403 });
    if (mode === 'uncited') return Response.json({ choices: [{ message: { content: '無法證明的內容' } }] });
    return Response.json(cited);
  }
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"summary":"研究結果"}' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
};
const sources = searchSources({ ...cited, citations: ['https://company.example/', 'javascript:alert(1)', 'https://user:pass@example.com'] });
assert.equal(sources.length, 1); assert.equal(sources[0].url, 'https://company.example/');
assert.ok(sources[0].accessedAt);
const result = await LLM.text({ label: 'research', webSearch: true, webQuery: '公開企業名稱', system: '整理資料', messages: [{ role: 'user', content: 'PRIVATE_CASE_NOT_FOR_SEARCH' }] });
assert.equal(requests.length, 2); assert.equal(requests[0].model, 'search-test');
assert.ok(!JSON.stringify(requests[0]).includes('PRIVATE_CASE_NOT_FOR_SEARCH'));
assert.ok(JSON.stringify(requests[1]).includes('企業官網資料'));
assert.equal(result.sources[0].url, 'https://company.example/');
assert.ok(usage.some(u => u.label === 'research-search'));
const data = filterResearchSources({ facts: [{ label: '已知', source: '已知資料' }, { label: '查得', source: 'https://company.example/?utm_source=x' }], news: [{ title: '編造來源', source: 'https://invented.example/' }], contacts: [{ who: '假窗口', source: '' }] }, sources);
assert.equal(data.facts.length, 2); assert.equal(data.news.length, 0); assert.equal(data.contacts.length, 0); assert.equal(data.verify.length, 2);
mode = 'error'; await assert.rejects(researchWeb('公司'), /403.*未完成即時查證/);
mode = 'uncited'; await assert.rejects(researchWeb('公司'), /沒有回傳.*來源/);
const aborted = new AbortController(); aborted.abort(); await assert.rejects(researchWeb('公司', { signal: aborted.signal }), /已停止/);
mode = 'ok'; cfg.privateBase = 'https://private.example/v1'; cfg.privateModel = 'private-test';
const before = requests.length;
await LLM.als.run({ private: true }, async () => {
  assert.equal(LLM.canWebSearch(), false);
  await LLM.text({ webSearch: true, webQuery: '不應搜尋', messages: [{ role: 'user', content: '機密案件' }] });
});
assert.equal(requests.length - before, 1); assert.equal(requests.at(-1).model, 'private-test');
cfg.webSearch = false; assert.equal(LLM.canWebSearch(), false);
console.log('PASS: 搜尋與整理分離、引用去重與校驗、搜尋用量、失敗提示、取消、機密案件禁止搜尋。');
