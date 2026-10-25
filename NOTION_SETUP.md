# 從 Notion 發布到 Gmeek

適用儲存庫：`photohost/photohost.github.io`。

Notion 寫作 → 手動將 Status 設為 Published → 系統自動同步 GitHub Issue → 建置與部署網站 → 回寫同步結果與網站連結。

## 一次性設定

1. 合併本變更到 `main`。
2. 在 [Notion Developer portal](https://www.notion.so/developers) 的 Build → Internal connections 建立連線，名稱可用 `Gmeek Publisher`。只需要讀取內容與更新內容權限。可參考 [Notion 官方操作步驟](https://developers.notion.com/guides/get-started/internal-connections)。
3. 將 [blog 資料庫](https://www.notion.so/35d40a03f4e8809d899acb47bc3fe001) 加入該 connection 可存取的頁面。聊天中的 Notion 外掛授權和 Actions 使用的 token 是不同的。
4. 複製 connection 的 token，到 [GitHub Actions secrets](https://github.com/photohost/photohost.github.io/settings/secrets/actions) 建立名為 `NOTION_TOKEN` 的 Repository secret。不要把 token 寫進任何檔案、Issue、Notion 文章或聊天。
5. `GITHUB_TOKEN` 由 Actions 自動提供，不需要另外建立 GitHub PAT。確認儲存庫政策允許 workflow 寫入內容及 Issues；如果主分支有保護規則，需讓本 workflow 的產生檔提交符合該規則。

資料來源 ID 已填入 `notion-sync.json`：`35d40a03-f4e8-8094-bba3-000bd5f3aac3`。這是 data source ID，並非資料庫網址的 ID 或 `v=` 的檢視 ID。

## 日常寫作與自動發布

1. 在 Notion 新增一篇實際願意公開的文章，填寫 `Title`、至少一個 `Tags`，並在頁面內撰寫本文。
2. `日期` 是文章顯示日期，不是排程開關。可留空，留空時沿用 GitHub Issue 建立時間。
3. `Slug` 可填如 `my-first-post`；不含路徑或 `.html`。留空會產生穩定的 `notion-...` 代稱。
4. 寫作時保持 `Status = Draft`。完成並決定公開後，手動改為 `Published`。
5. 系統每 5 分鐘檢查一次（每小時第 2、7、12…57 分鐘），自動將新增或修改過的 Published 文章和圖片同步至公開 GitHub 儲存庫與網站。GitHub 排程可能延遲，另需網站建置時間，不保證 5 分鐘內上線。
6. 在 Notion 查看「同步結果」。出現「已成功發布至網站」，並填入「網站連結」與「最後同步」，代表這次部署已完成。

`Status = Published` 是你的公開發布指令，不是部署已完成的證明；成功與否看「同步結果」及「最後同步」。另一個 `Published` 核取方塊由程式在成功後勾選，不需要手動修改。

保持 Published 時，後續的標題、本文、圖片、標籤修改也會自動更新同一篇文章；沒有變更就不重複寫入 Issue 或部署。需要慢慢修改時，先改回 Draft，完成後再設為 Published。`Draft` 與舊的 `Ready` 狀態都不會自動發布。刪除、封存或改回 Draft 都不會下架已上線的文章；已開始部署的版本也不會因此自動撤回。

## 暫停自動發布與手動預覽

自動發布預設啟用，不需要再按 GitHub 的 Run workflow。要暫停整個資料庫的自動發布，可在 [Actions variables](https://github.com/photohost/photohost.github.io/settings/variables/actions) 新增 Repository variable：

| 名稱 | 值 |
| --- | --- |
| NOTION_SYNC_ENABLED | false |

設回 `true` 或移除該變數後恢復。此開關只控制排程發布，手動執行不受影響。原有台灣時間每日 00:00 的網站重建保留，該重建不讀取 Notion。

需要先檢查文章時，先暫停自動發布，再將測試文章設為 Published。前往 [Actions → build Gmeek](https://github.com/photohost/photohost.github.io/actions/workflows/Gmeek.yml)，按 Run workflow，選 `main` 與 `notion-preview`。下載 `notion-preview` artifact 裡的 Markdown 與 `plan.json`，其中 `needs_sync` 表示是否需要更新網站。預覽只讀取資料及下載圖片，不修改 GitHub Issues 或 Notion。Artifact 包含選取的文章，保留 7 天，存取權由 GitHub 決定。

手動選 `notion-publish` 可立即啟動同步，不必等待下一次排程。成功部署會保存內容版本記錄；若第一次啟用時已有舊版同步的文章，缺少部署記錄的文章會再部署一次，沿用原 Issue 與網址。

GitHub 排程可能延遲或漏跑，下一次會重新檢查。公開儲存庫長時間無活動也可能停用排程；若一直沒有同步，先到 Actions 檢查工作流程是否啟用。詳見 [GitHub 排程說明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。

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

- 發布前會先檢查所有 Published 文章；格式、重複網址或標籤有誤時，尚未發出文章更新，並盡可能在「同步結果」寫入檢查錯誤。修正內容後保持 Published，下一次會再試。若 token 或資料庫授權有誤，需到 Actions 查看錯誤。
- Issue 更新成功但部署失敗時，文章維持 Published，系統會重試。只有部署成功並完成回寫後才記錄已部署版本，避免失敗後被誤當成已上線。Issue 內的隱藏 Notion page 標記可避免重跑建立重複文章。
- `.notion-sync/state.json` 保存固定網址、Issue 對應和已部署版本，必須與程式一起保留；請勿手動刪除 Issue 內的 `notion-page` 標記。
- 中途被取消或網路斷線可能只完成部分步驟；不要手動重建 Issue，先重新執行。若 git push 被拒絕，檢查主分支保護規則或併發修改。
- 若建置期間又修改 Notion 文章，程式會保留你的新狀態；仍保持 Published 的新內容會在後續排程補上。
- 同步寫入的圖片與已公開 Issue 內容不會因為後續失敗而自動撤回。

## 驗證

本地測試：`python -m unittest discover -s tests -v`，不需要 token，模擬資料驗證草稿排除、預覽唯讀、重跑去重、已部署文章無變更時跳過、內容更新、失敗重試、舊網址和修改衝突。PR 也會執行相同測試。

已對照 Gmeek v2.25 的命名介面與 static 複製方式。`GMEEK_VERSION` 仍沿用原設定；如果上游改動命名介面，adapter 會停止並要求更新，不會猜測新介面。Notion REST 授權與 Hello World 文章預覽已驗證；正式上線結果以每次部署與回寫為準。

參考：[Notion data source API](https://developers.notion.com/reference/query-a-data-source)、[Notion file API](https://developers.notion.com/reference/file-object)、[GitHub workflow 觸發限制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[Gmeek](https://github.com/Meekdai/Gmeek)。
