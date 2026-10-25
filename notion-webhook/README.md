# Notion 部落格發布通知

用 Notion Workers 接收 Gmeek Publisher 連線的 Webhook，驗證簽章後觸發此儲存庫的 Gmeek workflow。實際讀取與發布由 GitHub Actions 既有的 NOTION_TOKEN 完成。

## 寫作操作

| Status | 行為 |
| --- | --- |
| Draft / Ready | 保留草稿，不發布 |
| Published | 首次發布；成功之後，直接編輯內容不會更新網站 |
| repost | 重新匯出內容並更新原 Issue、原網址；部署成功後回到 Published |
| delete | 永久刪除對應 GitHub Issue，移除網站文章、列表、RSS 與目前的 Markdown 備份；保留 Notion 文章 |

以「同步結果」確認完成；部署失敗會保留原命令，等待下一次 Webhook、排程或手動同步重試。Published 核取方塊由程式填寫。

delete 會刪除 Issue 及其討論，無法在 GitHub 還原。Git 先前的提交歷史不會被改寫。刪除成功後維持 delete，清空網站連結和 Issue 編號。若要重新建立文章，請複製為新的 Notion 頁面。

## 憑證

- GitHub repository secret `NOTION_TOKEN`：既有 Notion 連線權杖。
- GitHub repository secret `NOTION_DELETE_TOKEN`：由 photohost 建立的 fine-grained GitHub token，只選此儲存庫，Issues: Read and write。個人儲存庫只允許擁有者刪除 Issue。
- Worker secret `GITHUB_ACTIONS_TOKEN`：fine-grained GitHub token，只選此儲存庫，Actions: Read and write。
- Worker secret `NOTION_WEBHOOK_SECRET`：Notion 訂閱的 verification_token，用來驗證 HMAC。

可用同一個限此儲存庫的 token，賦予 Actions 與 Issues 讀寫權限，分別存入上述兩個位置。不要放在聊天、原始碼、Issue 或公開日誌。

## 接收服務部署

需要 Node.js 22+ 和官方 Notion CLI `ntn` 0.23.1+；此專案使用 SDK 0.9.5。

1. 在此目錄執行 `npm ci`、`npm run check`、`npm test`。
2. 執行 `ntn login --no-browser`，由工作區擁有者在 Notion 核准登入。
3. 首次部署：`ntn workers deploy --name "Gmeek Publisher Webhook"`。後續執行 `ntn workers deploy`。
4. 執行 `node setup.mjs init`，將初始化公鑰寫入本機 `.env`，執行 `ntn workers env push`。
5. 將 `GITHUB_ACTIONS_TOKEN` 加入 Worker 的環境變數。`workers.json`、`.env`、初始化私鑰均已加入 Git 忽略規則。
6. 用 `ntn workers webhooks list` 取得 `publishBlog` 接收網址；網址包含秘密，勿公開。啟用此 webhook 的同步 verification。
7. 在 Notion 的 Gmeek Publisher 連線新增 Webhook 訂閱，填入接收網址，選擇 `page.created`、`page.properties_updated`、`page.content_updated`。
8. 將初始化那次 Worker 的日誌存到本機暫存檔，再執行 `node setup.mjs capture <日誌檔>`。程式只記錄 RSA 加密的驗證碼，解密後寫入 `.env`。
9. 執行 `ntn workers env push`，把 NOTION_WEBHOOK_SECRET 存入 Worker。本人可在私有終端執行 `node setup.mjs show-code`，把驗證碼填回 Notion 訂閱介面完成驗證。
10. 將一篇要更新的文章改成 repost，確認 GitHub 出現「Notion 自動發布」，且網站部署成功後 Notion 回到 Published。

Webhook 已驗證後，初始化請求會被拒絕。可以移除 Worker 的 WEBHOOK_BOOTSTRAP_PUBLIC_KEY。接收端只接受固定工作區、固定 blog 資料庫的人員操作；同步程式本身的 bot 回寫不會觸發循環。來源通知不保證瞬間送達，GitHub 排程保留作為備援。

手動診斷：Actions → build Gmeek → Run workflow → mode 選 notion-preview（僅預覽）或 notion-publish（執行命令）。

參考：[Notion Webhooks](https://developers.notion.com/reference/webhooks)、[Workers Webhooks](https://developers.notion.com/workers/guides/webhooks)、[GitHub 刪除 Issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/deleting-an-issue)。
