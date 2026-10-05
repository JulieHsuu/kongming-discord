# Positive Scope Test Report

## Summary

- Model endpoint: `litellm.iii-ei-stack.com`
- Model: `openai/gpt-5.6`
- Total cases: 26
- Passed: 24
- Failed: 2
- Failure type: deterministic false-negative scope block

This audit checks for false negatives: requests that belong to Kongming's documented consulting role but are rejected, classified out of scope, or routed to the wrong task.

## Coverage

The test set covers all primary task types, consulting questions, user preferences, decisions, assignments, multi-task requests, the sample `capabilities.csv` attachment, and work-related translation boundaries.

All original 24 positive cases passed, including prep, ingest, debrief, status, program matching, POC, deck, demo, video, proposal, research, ROI, scouting, closeout, industry questions, profile updates, preferences, assignments, decisions, expert matching, sample attachment reading, and multi-task routing.

## False negatives

### P25 — SBIR case abstract translation

- Input: `請把宏聯精密 SBIR 計畫書的中文摘要翻成英文，供這個案件送件使用。`
- Expected: accepted as work directly related to an active consulting/proposal case.
- Actual: blocked before the Router model with `翻譯不在我的工作範圍`.
- Failure: `hard_blocked`.

### P26 — Customer proposal translation

- Input: `請把這份 AI 瑕疵檢測客戶提案的一頁內容翻成英文。`
- Attachment: proposal content describing Honglian Precision's six-week AI visual-inspection proof of concept.
- Expected: accepted as work directly related to a customer proposal.
- Actual: blocked before the Router model with `翻譯不在我的工作範圍`.
- Failure: `hard_blocked`.

## Root cause

The deterministic translation rule in `hardScopeBlock()` blocks every request containing translation keywords. The policy only excludes translations unrelated to consulting cases, so the implementation is broader than the documented scope.

## Recommended correction

Keep blocking general translation requests, but allow translation when the same request or attachment clearly concerns a customer case, proposal, government program application, interview record, POC, deck, or other documented Kongming work product.

## Resolution

The deterministic rule was narrowed after this audit. Translation remains blocked by default, while requests containing substantive consulting artifacts or topics—such as SBIR/SIIR, government programs, project proposals, POC, KPI, ROI, AI, defect inspection, technical solutions, interview records, or case data—are allowed through to the Router. The two false-negative cases now pass the pre-model scope check.
