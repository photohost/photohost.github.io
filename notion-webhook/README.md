# Notion 部落格發布通知

用 Cloudflare Workers 接收 Gmeek Sync 連線的 Webhook，驗證簽章後觸發此儲存庫的 Gmeek workflow。實際讀取與發布由 GitHub Actions 既有的 NOTION_TOKEN 完成。

## 寫作操作

| Status | 行為 |
| --- | --- |
| Draft / Ready | 保留草稿，不發布 |
| Published | 首次發布；成功之後，直接編輯內容不會更新網站 |
| repost | 重新匯出內容並更新原 Issue、原網址；部署成功後回到 Published |
| delete | 永久刪除對應 GitHub Issue，移除網站文章、列表、RSS 與目前的 Markdown 備份；保留 Notion 文章 |

以「同步結果」確認完成；部署失敗會保留原命令，等待下一次 Webhook、排程或手動同步重試。Published 核取方塊由程式填寫。

Slug 可留空，首次發布會以完整的 Notion 頁面 ID 自動產生唯一網址。已發布文章會沿用原本的 Slug；手動指定時不可與其他文章（包含曾刪除的文章）重複。

「日期」由程式自動填入本次發布的日期與時間（台北時間）。首次 Published 或每次 repost 都會產生新的發布時間，網站部署成功後才寫回 Notion；失敗重試沿用同一次發布時間，刪文保留原日期。此欄位不是預約發布設定，不需手動填寫。「最後同步」另外記錄部署完成或刪文完成的時間。

Notion 的 blog 表格依「日期」降冪排序（新到舊）。網站也使用同一個發布時間排序，因此成功 repost 的文章會回到較新的位置；Gmeek 原有置頂文章仍優先顯示。

delete 會刪除 Issue 及其討論，無法在 GitHub 還原。Git 先前的提交歷史不會被改寫。刪除成功後維持 delete，清空網站連結和 Issue 編號。若要重新建立文章，請複製為新的 Notion 頁面。

## 憑證

- GitHub repository secret `NOTION_TOKEN`：既有 Notion 連線權杖。
- GitHub repository secret `NOTION_DELETE_TOKEN`：由 photohost 建立的 fine-grained GitHub token，只選此儲存庫，Issues: Read and write。個人儲存庫只允許擁有者刪除 Issue。
- Worker secret `GITHUB_ACTIONS_TOKEN`：fine-grained GitHub token，只選此儲存庫，Actions: Read and write。
- Worker secret `NOTION_WEBHOOK_SECRET`：Notion 訂閱的 verification_token，用來驗證 HMAC。

可用同一個限此儲存庫的 token，賦予 Actions 與 Issues 讀寫權限，分別存入上述兩個位置。不要放在聊天、原始碼、Issue 或公開日誌。

## Cloudflare 接收服務

使用 Cloudflare Workers Free 即可，不需要升級 Notion。每次執行只驗證通知並呼叫 GitHub；未設定排程、資料庫或付費服務。

1. 安裝 Node.js 22+，在此目錄執行 `npm ci`、`npm run check`、`npm test`。
2. 執行 `npx wrangler login --device --browser=false --scopes account:read user:read workers_scripts:write workers_tail:read`，開啟顯示的網址並核准配對碼。
3. `wrangler.jsonc` 已指定接收服務名稱和帳號。首次執行 `node setup.mjs init`，在本機建立初始化金鑰及隨機接收路徑；私鑰和 `.env` 均不提交。
4. 執行 `npx wrangler deploy`，再執行 `npx wrangler secret bulk .env`，存入 `WEBHOOK_PATH_TOKEN` 和 `WEBHOOK_BOOTSTRAP_PUBLIC_KEY`。
5. 在 Cloudflare Worker → Settings → Variables and Secrets，新增 Secret `GITHUB_ACTIONS_TOKEN`；值是前述 GitHub Actions 讀寫權杖。
6. 訂閱網址為部署後的 `https://<worker>.<subdomain>.workers.dev/notion/<WEBHOOK_PATH_TOKEN>`。把完整網址填入 Notion 開發者後台 → Gmeek Sync → Webhooks；此連線須具有 blog 資料庫的存取權。請勿公開接收路徑。
7. 訂閱 `page.created`、`page.properties_updated`、`page.content_updated`。
8. 使用 Worker 私有日誌取得 `BOOTSTRAP_ENCRYPTED=...`，將該日誌存為本機暫存檔，再執行 `node setup.mjs capture <日誌檔>`。程式會用本機私鑰解密，把驗證碼寫入 `.env`，不印出明碼。
9. 再執行 `npx wrangler secret bulk .env`，設定 `NOTION_WEBHOOK_SECRET`。本人可在私有終端執行 `node setup.mjs show-code`，把驗證碼貼回 Notion 訂閱介面，完成驗證。
10. 將要更新的文章改成 repost，確認 GitHub 出現「Notion 自動發布」，網站成功後 Notion 回到 Published。

根目錄 `/health` 只回報服務存在；不能用它判斷 Notion 訂閱或 GitHub 權杖是否已設定完成。

接收端只接受此工作區、此 blog 資料庫的人員操作；程式的 bot 回寫不會形成循環。GitHub 接受觸發後才回覆 HTTP 200；失敗回覆 503，讓 Notion 重試。Webhook 不保證瞬間送達，原 GitHub 排程保留作為備援。

手動診斷：Actions → build Gmeek → Run workflow → notion-preview（僅預覽）或 notion-publish（執行命令）。

`src/index.ts` 保留原 Notion Workers 介面，只有 Notion Business／Enterprise 工作區才能使用；預設部署入口為 `src/cloudflare.ts` 編譯後的 `dist/cloudflare.js`。

參考：[Notion Webhooks](https://developers.notion.com/reference/webhooks)、[Cloudflare Workers 方案](https://developers.cloudflare.com/workers/platform/pricing/)、[GitHub 刪除 Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/deleting-an-issue)。



