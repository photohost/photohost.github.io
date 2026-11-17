# 映畫鑑賞票根牆（第一版）

這是獨立於 Notion 和 Gmeek 建置的觀影頁。公開頁直接讀取已發布票根；管理員頁可上傳圖片、保存草稿、發布及編輯。票根只呈現電影圖片、中文片名、原文片名、評分和日期。原文片名可留空；其他四項在發布時必填。

## 結構

- `public/`：公開票根牆、私人編輯頁與票根樣式。
- `src/worker.js`：讀寫 API、圖片上傳、Cloudflare Access JWT 驗證。
- `schema.sql`：D1 資料表。
- D1 存欄位與狀態，R2 存壓縮後的 WebP/JPEG/PNG 圖片。

草稿不出現在公開頁。修改已發布的票根並再按「發布票根」會立即更新公開資料；按「取消發布並存為草稿」會從公開頁隱藏。公開讀取不使用 Notion，也不觸發 GitHub Pages 重新部署。

## 部署前設定

1. 在選定的 Cloudflare 帳號建立 D1 資料庫及 R2 bucket。將 `wrangler.example.jsonc` 複製為 `wrangler.jsonc`，填入 D1 ID。`wrangler.jsonc` 已被 Git 忽略，因其中包含個人帳號設定。
2. 在 Cloudflare Zero Trust 建立只允許作者登入的 Access 應用程式，保護 `/admin`、`/admin.html` 和 `/api/admin/*`。將團隊網域、應用程式 AUD 和作者電郵填入 `wrangler.jsonc`。Worker 也會驗證簽章、發行者、AUD 與電郵；設定缺失時管理功能會拒絕存取。
3. 執行 `npm ci`、`npx wrangler d1 execute harunoji-ticket-wall --remote --file=./schema.sql`、`npx wrangler deploy`。在 DNS 設定獨立觀影頁網域後，再把主網站的觀影連結指向它。
4. 先測草稿、發布、重新編輯、取消發布和手機版，再切換主網站入口。

Cloudflare Access 應用程式必須真的在邊緣保護管理路徑。僅有 Worker 裡的 `ADMIN_EMAIL` 設定不會替使用者提供登入畫面。

## 本機開發

複製範例設定並填入本機用 D1 ID 後：

```text
npm ci
npx wrangler d1 execute harunoji-ticket-wall --local --file=./schema.sql
npx wrangler dev --local
npm test
```

本機沒有 Access JWT 時，`/admin` 會回應 401；這是預期的保護行為。單元測試用本機簽發的測試 JWT 驗證草稿、發布與編輯流程。

## 從目前觀影頁搬遷

目前的 Notion 同步與舊觀影頁先保持運作。切換前需一次性匯出完整日期、評分、片名和海報，匯入 D1/R2，逐筆核對數量與圖片；現有頁面把中外文片名放在同一欄，匯入時不能可靠地自動切分，需人工檢查。完成核對後，再停用 `.github/workflows/watch.yml` 的排程和 Notion 專用資料來源。這一步尚未執行，避免未驗證資料就取代現有觀影頁。
