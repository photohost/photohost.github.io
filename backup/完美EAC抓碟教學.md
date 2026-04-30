### 前言 
主要還是備份為主，網路上很多教學，以及R大幫忙。想統整一個完整又懶人的教學...
省的我每次安裝都要看一堆教學，有點麻煩...

> [!NOTE]
> 需先備妥以下材料：DVD/CD光碟機、CD

### 下載EAC
系統WIN11，V1.8抓出來常常報錯，降回版本V1.6([載點](https://www.npackd.org/p/de.exactaudiocopy.EAC/1.6))
官方最新V1.8也適用本篇文...成功與否就不確定了= =

### 安裝
1. 開始安裝時，取消勾選
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_14-14.51e40gkcb8.jpg)
因為後面他會跟你A錢

2. EAC執行後會跑出這個
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_14-17.99tbaadpbn.jpg)
取消勾選

3. 隨便放一張CD，盡量是熱門的

4. 會跳出這個
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_14-19.13lqjsf49y.jpg)
點Configure
> [!IMPORTANT]
> 此步驟很重要，如果CD放進去沒跳出來，那就換一張，直到有跳出來

5. 步驟四成功會出現這個
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_14-21.1sf03t4r16.jpg)
圖內的數據不一定跟我一模一樣，因為每個光碟機都不同，出來的數據也不同
不用理會，只要顯示成功即可

### 詳細設定

1. 匯入設定檔，我抓別人的= =
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_15-48.3yeepo0xa2.jpg)
[EACProfile (1).zip](https://github.com/user-attachments/files/17056205/EACProfile.1.zip)

2.照著以下圖設定
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_16-48.sywqscfeg.jpg)
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_16-48_1.41y0nfzx14.jpg)
> [!NOTE]
> 反灰的地方是正常，因為安裝的步驟4若成功，這邊就會反灰
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_16-48_2.8z6hhadotz.jpg)

![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_16-48_3.32hxa9x5va.jpg)
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_16-48_4.1aoyfddsz9.jpg)
> [!NOTE]
> 勾選勾對即可，其他不用管或是修改
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_16-48_5.51e40m2o6s.jpg)

> [!WARNING]
> 不是每次使用EAC都要重新設定！只要設定一次，之後往後抓碟直接抓就好

### 正式抓碟

1. 把你要抓的CD放入光碟機
2. CD如果是熱門的，很快就會有對應的標籤(專輯名、作曲者、曲目名稱...等等)
3. 若是冷門的，要自己一個一個慢慢輸入
4. 操作→測試並抓取鏡像及創建CUE目錄文件(未壓縮就是wav檔，已壓縮是flac)
5. 之後就自動開始跑了~
6. 完成後會有音樂檔、cue檔、log檔

### 處理CUE檔的亂碼

1.下載[Notepad++](https://notepad-plus-plus.org/downloads/)
2. 完成安裝後，對著cue檔案右鍵，以Notepad++開啟
3. 可以看到一堆亂碼(如果是非英文CD會更嚴重)
4. 先不要急著編輯，先轉萬國碼
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_21-24.3god1h1871.jpg)
5. 轉完後，開始更正亂碼內容，這邊就會花比較多時間...
6. 確認都修正完畢，直接儲存即可
7. 然後測試cue檔是否修正成功，直接用[fb2k](https://www.foobar2000.org)播cue檔看看，如果播放都沒有出現卡頓還是壞軌，恭喜成功

### 驗證是否完美抓碟(100% log)

1. 到github下載頁 https://github.com/doujincafe/hbcl/releases
2. 小白就用gui版，很熟悉者就下載最新的
![](https://github.com/photohost/picx-images-hosting/raw/master/20240919/2024-09-19_22-26.7w6s6qk982.jpg)
3. 下載後打開，直接把log檔案拖進去即可，會自動幫你檢測是否抓碟正確
4. 冷門CD通常會出現none of track are present in the database，很正常
5. 本篇文設置沒有裁切音檔(沒有一首一首)，會出現slected range，這不是抓碟失敗
6. 你的光碟機太冷門，有時候也會not found in darabase，這很正常不是失敗的意思

本文改寫自 https://zexwoo.blog/posts/tutorials/eac-ripping/