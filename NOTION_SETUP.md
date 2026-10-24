# 從 Notion 發布到 Gmeek

適用儲存庫：`photohost/photohost.github.io`。

Notion 寫作 → Status 設為 Ready → 同步 GitHub Issue → 建置與部署網站 → 回寫 Published 與網站連結。

## 一次性設定

1. 合併本變更到 `main`。
2. 在 [Notion Developer portal](https://www.notion.so/developers) 的 Build → Internal connections 建立連線，名稱可用 `Gmeek Publisher`。只需要讀取內容與更新內容權限。可參考 [Notion 官方操作步驟](https://developers.notion.com/guides/get-started/internal-connections)。
3. 將 [blog 資料庫](https://www.notion.so/35d40a03f4e8809d899acb47bc3fe001) 加入該 connection 可存取的頁面。聊天中的 Notion 外掛授權和 Actions 使用的 token 是不同的。
4. 複製 connection 的 token，到 [GitHub Actions secrets](https://github.com/photohost/photohost.github.io/settings/secrets/actions) 建立名為 `NOTION_TOKEN` 的 Repository secret。不要把 token 寫進任何檔案、Issue、Notion 文章或聊天。
5. `GITHUB_TOKEN` 由 Actions 自動提供，不需要另外建立 GitHub PAT。確認儲存庫政策允許 workflow 寫入內容及 Issues；如果主分支有保護規則，需讓本 workflow 的產生檔提交符合該規則。

資料來源 ID 已填入 `notion-sync.json`：`35d40a03-f4e8-8094-bba3-000bd5f3aac3`。這是 data source ID，並非資料庫網址的 ID 或 `v=` 的檢視 ID。

## 第一次測試與發布

1. 在 Notion 新增一篇實際願意公開的文章，填寫 `Title`、至少一個 `Tags`，並在頁面內撰寫本文。
2. `日期` 是文章顯示日期，不是排程開關。可留空，留空時沿用 GitHub Issue 建立時間。
3. `Slug` 可填如 `my-first-post`；不含路徑或 `.html`。留空會產生穩定的 `notion-...` 代稱。
4. 設定 `Status = Ready`。
5. 前往 [Actions → build Gmeek](https://github.com/photohost/photohost.github.io/actions/workflows/Gmeek.yml)，按 Run workflow，選 `main` 與 `notion-preview`。
6. 查看執行結果，下載 `notion-preview` artifact 裡的 Markdown 與 `plan.json`。預覽會讀取資料及下載圖片，但不修改 GitHub Issues 或 Notion；有未支援格式時會停止。Artifact 包含待發布文章，保留 7 天，存取權由 GitHub 決定。
7. 確認後再次執行，選 `notion-publish`。此步會將 Ready 文章與圖片寫入公開儲存庫／Issue，並更新網站。
8. 等待 Deploy blog 和 Report deployment to Notion 成功。此時 Notion 才會出現 `Published`、網站連結和最後同步時間。

Notion 的 `Published` 核取方塊由程式在成功後填寫；日常操作只需要修改 `Status`。重新編輯已發布文章後，再改成 `Ready` 即會更新同一個 Issue。`Draft` 和 `Published` 不會被主動匯出。刪除、封存或改回 Draft 都不會下架網站文章。

## 選擇是否啟用每小時檢查

首次手動發布確認後，可在 [Actions variables](https://github.com/photohost/photohost.github.io/settings/variables/actions) 新增 Repository variable：

| 名稱 | 值 |
| --- | --- |
| NOTION_SYNC_ENABLED | true |

啟用後每小時第 17 分鐘檢查 Ready 文章；GitHub 排程可能延遲。未設定或設為 `false` 時，新增的每小時排程不會執行發布。原有台灣時間每日 00:00 的網站重建保留，該重建不讀取 Notion。

## 圖片與格式

- Notion 上傳的圖片／附件在同步時下載到 `static/notion-assets/`，以檔案內容雜湊命名，建置後可從網站永久網址存取，不再依賴 Notion 一小時的下載連結。
- 外部圖片保留原網址，因此仍取決於原圖片服務。單一下載附件限 20 MiB；支援 PNG、JPEG、GIF、WebP、AVIF、PDF、MP4、MP3、OGG。
- 支援段落、標題、粗體、斜體、刪除線、底線、清單、待辦、引用、callout、程式碼、公式、圖片、表格、toggle、分隔線與網址。
- 多欄轉成依序排列，embed 轉成連結；Notion 目錄省略，沿用網站既有目錄。
- 子資料庫、子頁面、同步區塊、提及等尚未支援的內容會阻止發布，不會默默丟掉內容。顏色等 Notion 專屬樣式不保留。
- 內文需適合 GitHub Issue，本程式限制 UTF-8 60,000 bytes。不能有相同標題產生相同備份檔名的文章。

## 舊文章

本次先提供新文章發布；不會自動搬移或覆寫 199 篇舊文章。

若要讓 Notion 接管一篇舊文，先把完整內文複製進 Notion，並填正確的 `Issue 編號`。`Slug` 先留空，程式會從 `blogBase.json` 找出既有網址代稱；原文末尾的 Gmeek 自訂參數也會保留，日期欄位可另行更新 timestamp。以 preview 比對完整內文後再 publish。文章一旦綁定 Issue，編號和固定網址不可任意更換。日後可另外進行整批匯入。

## 失敗與重跑

- 發布前會先檢查所有 Ready 文章；格式、欄位、重複網址或標籤有誤時，尚未發出文章更新。
- Issue 更新成功但部署失敗時，文章仍是 Ready，可重跑。Issue 內的隱藏 Notion page 標記可避免重跑建立重複文章。
- `.notion-sync/state.json` 保存固定網址和 Issue 對應，必須與程式一起保留；請勿手動刪除 Issue 內的 `notion-page` 標記。
- 中途被取消或網路斷線可能只完成部分步驟；不要手動重建 Issue，先重新執行。若 git push 被拒絕，檢查主分支保護規則或併發修改。
- 若建置期間又修改 Notion 文章，程式會保留你的新狀態；將需要發布的內容設為 Ready 後重跑。
- 同步寫入的圖片與已公開 Issue 內容不會因為後續失敗而自動撤回。

## 驗證

本地測試：`python -m unittest discover -s tests -v`，不需要 token，模擬資料驗證草稿排除、預覽唯讀、重跑去重、舊網址、失敗狀態和修改衝突。PR 也會執行相同測試。

已對照 Gmeek v2.25 的命名介面與 static 複製方式。`GMEEK_VERSION` 仍沿用原設定；如果上游改動命名介面，adapter 會停止並要求更新，不會猜測新介面。實際 Notion REST 授權與 GitHub Pages 部署仍需完成上述預覽和首次發布測試。

參考：[Notion data source API](https://developers.notion.com/reference/query-a-data-source)、[Notion file API](https://developers.notion.com/reference/file-object)、[GitHub workflow 觸發限制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[Gmeek](https://github.com/Meekdai/Gmeek)。
