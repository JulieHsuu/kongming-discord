import { isSyntheticCase } from './domain.js';
import { KmError } from './util.js';

export const POC_RULES = `補助只能列為候選，資格、適配性與年度須知待確認。4–8 週僅為建議時程，承接單位與人力未確認；不得承諾資策會執行。訓練集用於訓練，驗證集用於調參，凍結的獨立測試集只用於最終驗收；不得用測試集選型、調參或補強模型，看過測試結果再調整須另備獨立測試集。虛構案件的所有建檔數字均為虛構測試資料，不得寫成可能或企業已查證。預算與設備費不是完整POC成本，未列明差額不代表可用或核定經費。`;

export function hasTestLeakage(text) {
  // Evaluate each clause separately: a prohibition must not hide a later unsafe instruction.
  return String(text).split(/[。；，,\n]/).some(clause => {
    const match = /(?:使用|利用|依據|根據|以|用)[^。；，,\n]{0,20}測試集[^。；，,\n]{0,25}(?:調參|調整模型|模型調整|選型|訓練模型)/.exec(clause);
    if (match) {
      const prefix = clause.slice(0, match.index);
      if (/(?:不得|不可|禁止|避免|不應|不能|不再|不)\s*$/.test(prefix)) return false;
      if (/(?:不得|不可|禁止|避免|不應|不能|不再|不用於|不參與)/.test(match[0])) return false;
      return true;
    }
    return /測試集(?:用於|拿來|供)[^。；，,\n]{0,15}(?:調參|調整模型|模型調整|選型|訓練模型)/.test(clause);
  });
}

export function protectPoc(d, c) {
  if (!d || !d.title) throw new KmError('POC 規劃格式不完整，請再試一次。');
  const synthetic = isSyntheticCase(c);
  function walk(v) {
    if (typeof v === 'string') {
      if (hasTestLeakage(v)) throw new KmError('POC 草稿將測試集用於模型調整，已停止交付；請重新產生。');
      return v.replace(/(?:建議)?技術團隊（承接單位待確認）|資策會/g, '技術團隊（待確認）').replace(synthetic ? /可能是測試資料|可能為測試資料/g : /$^/g, '已標示為虛構測試資料');
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  }
  const result = walk(d);
  for (const k of result.kpi || []) {
    if (/良品誤報率/.test(k.name || '')) k.basis = '被 AI 誤判為瑕疵的良品件數÷有效測試集良品總件數×100%；僅因低信心而送人工複核的良品不計入誤報，另列人工複核率。';
    if (/人工複核率/.test(k.name || '')) k.basis = '送交人工複核的件數÷全部檢測件數×100%；分列低信心、疑似瑕疵及不可判讀原因，與良品誤報率分開計算。';
    if (/(?:召回率|誤報率|正確率|複核率|可判讀率)/.test(k.name || '')) k.unit = '%';
    if (/推論時間/.test(k.name || '') && !/^(?:毫秒|秒)\/件$/.test(k.unit || '')) k.unit = '毫秒/件';
  }
  result.planning_notes = [
    '本文件為建議規劃；時程、負責人、人力及實際承接單位均待確認，不構成執行承諾。',
    '資料分為訓練集、驗證集及獨立測試集。調參僅使用驗證集；凍結測試集只供最終驗收，看過測試結果再調整須另備獨立測試集。',
    ...(synthetic ? ['本案建檔數字均為虛構測試資料，不作為對外企業事實依據。'] : []),
  ];
  const fact = (c.facts || []).find(f => /設備合計/.test(f.label || ''));
  const match = String(fact?.value || '').match(/([\d,.]+)\s*萬(?:元)?/);
  const budget = c.profile?.budget;
  if (match && typeof budget === 'number') {
    const equipment = Number(match[1].replace(/,/g, ''));
    const delta = Math.round((budget - equipment) * 100) / 100;
    result.cost_estimate = `${result.cost_estimate || ''}\n總預算 ${budget} 萬元，表列設備 ${equipment} 萬元，差額 ${delta} 萬元${delta >= 0 ? '用途尚未列明' : '，設備費超出總預算，須核對'}；不代表可用或核定經費，亦不可將設備費視為完整 POC 成本。${synthetic ? '上述金額均為虛構測試資料。' : ''}`;
  }
  return result;
}
