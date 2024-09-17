擔心哪天有些網站直接倒了
我就會忘記怎麼用= =

直接備份下來就是了

相同編碼格式來說
-

1. 先開一個資料夾，裡面先丟[ffmpeg.exe](https://www.ffmpeg.org/download.html)，以及你要串接的影片檔們
2. 先把你的影片檔們改成 01.mp4、02.mp4、03.mp4...以此類推
3. 建立新的文字檔.txt
4. 裡面輸入，看多少個影片檔，就列多少個

> file "01.mp4"
> file "02.mp4"
> file "03.mp4"

5. 該.txt文字檔儲存，檔名為`list.txt`
6. 在該檔案夾內，右鍵>在終端開啟(我電腦是win11，非win11者開啟CMD操作)
7. 輸入`ffmpeg -f concat -i list.txt -y -c copy output.mp4`


不同編碼...目前沒遇到這狀況
我就不寫下來備份了

[該篇來源在此](https://annkuoq.github.io/blog/2021-05-08-how-to-combine-videos-using-ffmpeg/)