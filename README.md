# 孔明 Kongming｜Discord 版數位員工

孔明是資策會數位轉型研究院的顧問協作型數位員工。把他加進 Discord 頻道，就能像跟正式同事一樣聊天交辦。他也會看頻道裡的對話，遇到符合職能的事會主動先把工作做好。

| 職能 | 孔明會交出來的東西 |
| --- | --- |
| ① 訪前準備 | 訪前資料包與 60 分鐘訪綱（Word） |
| ② 資料建檔 | 從公司簡介、型錄、名片照片辨識出欄位，建檔並列出缺漏 |
| ③ 訪後更新 | 從訪談筆記或逐字稿整理出訪談紀錄（Word），附數據、承諾事項與待辦 |
| ④ 流程銜接 | 案件狀態、缺漏資訊、後續事項，以及一段可直接轉傳的回報 |
| ⑤ 科專提案 | 科專媒合（26 項計畫）、POC 規劃與 KPI（Word）、提案簡報（PowerPoint）、可操作的產品 Demo（HTML，手機可開）、計畫短片（MP4，含字幕與配樂）、科專計畫書草稿（Word，附申請文件檢核表） |

## 分工

孔明的分工照《孔明》提案的「任務與治理」。

- **可協作執行**：例行數位工作由孔明直接做。
- **需要顧問確認**：重要資料異動（例如員工數 85 → 92）、進入下一個案件階段、要對外使用的產出，孔明都會附按鈕，請同事按下確認。
- **保留真人處理**：聯絡客戶、需求追問、專業判斷、最終決策（含科專送件與簽核）都留給同事，孔明不會代勞。

---

## 一、在 Discord 建立孔明（約 10 分鐘）

1. 到 <https://discord.com/developers/applications>，按 **New Application**，名稱填「孔明」。
2. 左側 **Bot**：
   - 按 **Reset Token** 複製 Token，等一下貼進 `.env` 的 `DISCORD_TOKEN`。Token 等同密碼，只放在伺服器上，不要貼到聊天室。
   - 打開 **MESSAGE CONTENT INTENT**。沒打開的話，孔明看不到頻道內容，也無法主動做事。
   - 頭像上傳 `assets/avatar.png`（孔明的照片），使用者名稱設成「孔明」。
3. 邀請孔明進伺服器。啟動後，記錄檔會印出一行「邀請連結」，用伺服器管理員帳號打開即可。也可以自己到 **OAuth2 → URL Generator** 勾選：
   - Scopes：`bot`、`applications.commands`
   - 權限：View Channels、Send Messages、Send Messages in Threads、Create Public Threads、Embed Links、Attach Files、Read Message History、Add Reactions、Use Application Commands
4. 在要讓孔明工作的頻道，確認他有「檢視頻道」與「傳送訊息」權限。

> 如果公司原本用 Hermes Agent 的機器人也在同一個伺服器，請替孔明另外建一個 Bot，Token 不要共用，否則兩邊會重複回覆。

## 二、在公司伺服器部署

需要一台 24 小時開機、可以連外網的 Linux 主機，並安裝 Docker 與 Docker Compose。

```bash
# 把這個資料夾放到伺服器上，例如 /opt/kongming-discord
cd /opt/kongming-discord
cp .env.example .env
nano .env          # 至少填 DISCORD_TOKEN 與 ANTHROPIC_API_KEY（或 OPENAI_* 那組）
docker compose up -d --build
docker compose logs -f     # 看到「孔明上線」就完成了
```

- **模型**：預設用 Claude API（`ANTHROPIC_API_KEY` 到 <https://console.anthropic.com> 申請）。要改用公司自架或其他 OpenAI 相容端點，就把 `KM_LLM_PROVIDER` 設成 `openai`，再填 `OPENAI_BASE_URL`、`OPENAI_API_KEY` 和 `KM_MODEL`。
- **對外網址（建議）**：設定 `PUBLIC_BASE_URL` 並用 Nginx 或 Caddy 加上 HTTPS 反向代理到 8787 埠。設好之後，同事在手機上點按鈕就能直接打開 Demo、播放影片；超過 Discord 上傳上限（預設 10 MB）的檔案也會改給連結。連結很長、無法猜到，但沒有登入機制，請只在公司內部使用。
- **資料**：案件、對話紀錄和產出的檔案都存在 `./state`，請定期備份。
- **更新**：改完程式後執行 `docker compose up -d --build`。

不想用 Docker 的話，需要 Node.js 20 以上、ffmpeg 和 Python 3（`pip install fonttools`）：

```bash
npm ci
sudo apt install fonts-noto-cjk fonts-noto-cjk-extra   # 只用來抽出繁體中文字型
npm run fonts
cp .env.example .env && nano .env
npm start
```

## 三、怎麼跟孔明一起工作

**直接找他**：@孔明、私訊他、訊息開頭寫「孔明，」，或在他開的討論串裡回覆都可以。用一句話交辦就好：

- 孔明，下週二要拜訪宏聯精密，先幫我準備訪綱
- （上傳公司簡介 PDF）孔明，幫我建檔
- 孔明，這是今天的訪談逐字稿，幫我整理
- 孔明，這家能提哪些科專？SBIR 什麼時候截止？
- 孔明，針對目檢漏檢的痛點做 POC 跟提案簡報
- 孔明，幫忙寫 SBIR Phase 1 計畫書草稿
- 孔明，做一個可以操作的 Demo、剪一支 90 秒的計畫短片
- 孔明，停（中斷目前的工作，30 分鐘內不主動做事）

**他會自己做事**：在觀察的頻道裡，只要對話停下約 1 分鐘，孔明就會判斷有沒有屬於他職能、做了會明顯幫上忙的工作。例如：

| 同事在聊…… | 孔明會…… |
| --- | --- |
| 「下週要去拜訪大成食品」 | 先把訪綱做好 |
| 「林協理說他們 6 個人目檢、常漏檢」 | 針對痛點做 POC 規劃 |
| 「那幫他們申請 SBIR 吧」 | 寫計畫書草稿，附申請文件檢核表 |
| 貼上會議紀錄、上傳逐字稿 | 整理成訪談紀錄並更新案件 |
| 「要做個影片給老闆看」 | 先問「要我做計畫短片嗎？」，按「好」才做 |

主動做的成果會放進討論串，不會洗版。閒聊、討論還沒有結論、資訊不足、剛做過的工作，他都不會插手。

**斜線指令**：`/孔明 說明`、`/孔明 案件`、`/孔明 切換`、`/孔明 狀態`、`/孔明 模式`。英文介面是 `/kongming help|cases|use|status|mode`。

- `/孔明 模式 auto`：符合職能時主動把工作做好（預設）
- `/孔明 模式 ask`：先問大家再做
- `/孔明 模式 off`：只在被叫到時工作

## 四、控制成本與打擾程度

| 設定 | 作用 |
| --- | --- |
| `KM_WATCH_CHANNELS` | 只觀察指定的頻道 |
| `KM_CONFIDENCE` | 判斷信心門檻，越高越保守（預設 0.72） |
| `KM_DAILY_PROACTIVE_LIMIT` | 每個伺服器每天最多主動做幾次（預設 15） |
| `KM_QUIET_HOURS` | 這段時間不主動做事，例如 `22-7` |
| `KM_AUTO_TASKS`／`KM_ASK_TASKS` | 哪些工作可以直接做、哪些要先問 |
| `KM_MODEL_FAST` | 判斷「要不要做」這一步用的便宜模型，呼叫最頻繁 |

## 五、資料與隱私

- 孔明觀察的頻道內容、上傳的檔案，會送到你設定的模型服務（Claude API 或自架端點）處理。請只讓他進可以這樣處理的頻道。如果不希望某個頻道被看，就把該頻道設成 `/孔明 模式 off`，或不要給他那個頻道的權限。
- 群組訊息對孔明來說是「資料」，不是指令。有人要他越過分工（例如代替顧問送件），他會婉拒。
- 錄音檔請先用既有的診斷工具（<https://ai-advisor-agent.datafabric.iii-ei-stack.com/>）轉成逐字稿，再交給孔明。

## 六、科專資料

`data/programs.json`、`data/kb.json`、`data/meta.json` 是 26 項計畫與科專共通知識，和網頁版「科專提案數位員工」用的是同一份。要更新的話，把新檔放進 `state/` 同名檔案即可，`state/` 的檔案會優先使用，重新啟動後生效。

## 七、測試

```bash
npm test     # 不連 Discord、不呼叫真模型，用假回覆跑完整流程，產出放在 test/out/
```

## 八、常見問題

- **「Used disallowed intents」**：到 Developer Portal 的 Bot 頁面打開 MESSAGE CONTENT INTENT。
- **孔明沒回應**：確認他在該頻道有讀寫權限；用 `docker compose logs -f` 看記錄。
- **斜線指令沒出現**：孔明啟動時會在每個伺服器註冊指令；在 Discord 按 Ctrl+R 重新整理。
- **影片傳不上來**：檔案超過 Discord 上限。請設定 `PUBLIC_BASE_URL` 改用連結，或請孔明做短一點的影片（例如 60 秒）。
