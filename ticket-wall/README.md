# 映畫鑑賞票根牆（第一版）

這是獨立於 Notion 和 Gmeek 建置的觀影頁。公開頁直接讀取已發布票根；管理員頁可上傳圖片、保存草稿、發布及編輯。票根只呈現電影圖片、中文片名、原文片名、評分和日期。原文片名可留空；其他四項在發布時必填。

目前測試網址：[公開票根牆](https://harunoji-ticket-wall.anishare.workers.dev/)；[作者編輯頁](https://harunoji-ticket-wall.anishare.workers.dev/admin)。後者由 Cloudflare Access 限定作者信箱並寄送一次性驗證碼。正式入口尚未切換，舊觀影頁繼續運作。

## 結構

- `public/`：公開票根牆、私人編輯頁與票根樣式。
- `src/worker.js`：讀寫 API、圖片上傳、Cloudflare Access JWT 驗證。
- `schema.sql`：D1 資料表。
- D1 存欄位與狀態，R2 存壓縮後的 WebP/JPEG/PNG 圖片。

草稿不出現在公開頁。修改已發布的票根並再按「發布票根」會立即更新公開資料；按「取消發布並存為草稿」會從公開頁隱藏。公開讀取不使用 Notion，也不觸發 GitHub Pages 重新部署。

草稿圖片由受保護的管理路徑讀取；公開圖片路徑只提供已發布票根使用的圖片。已公開的圖片可能在瀏覽器或 CDN 快取中短暫保留，因此取消發布不等於立即撤銷曾公開的圖片檔案。

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

已一次性匯入 85 筆已看完的觀影紀錄和海報。舊資料的中外文片名共用同一欄，匯入時分出可辨識的原文片名，並保留單一片名。公開資料核對通過，85 張圖片與搬遷來源逐張相符。

已確認作者能登入票根編輯頁。草稿、發布及編輯通過本機測試，正式編輯頁的儲存操作仍待實測。主站入口切換列在同一份變更中供檢視。切換後，舊觀影頁可作為備份，再停用 `.github/workflows/watch.yml` 的排程。
