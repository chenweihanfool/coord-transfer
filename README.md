# 坐標轉換工具

把國土測繪中心坐標轉換程式（`transfer/t.exe`，原始碼 TRANSFN1.FOR）包成**免安裝的 HTML 單一檔案**。
雙擊 `docs/坐標轉換工具.html`，用 Chrome 或 Edge 開啟即可使用，不需要網路。

- 線上版／下載：https://chenweihanfool.github.io/coord-transfer/
- 更新來源（已內建於程式）：https://chenweihanfool.github.io/coord-transfer/latest.json

## 功能
- **轉換**：單點、多點（CSV／TXT／INP，會自動判斷欄位）、整段（NECEXE `.COA`）
- **方向**：TWD67 → TWD97、TWD97 → TWD67
  - 反向擬合：把兩組坐標對調後重新解算，跟用原程式手動對調欄位的結果相同
  - 迭代反解：直接反解正算模型，正算與反算的結果互為反函數
- **模型**：6 參數仿射或 4 參數 Helmert，可選擇是否加上最小二乘配置；預設照事務所的作法（6 參數加配置）
- **輸出**：成果 CSV／TXT／COA、可列印的轉換報告，以及原程式格式的 ZIP（`.inp .out AFFINE6.OUT resid.ne interp.in interp.out chkdist.00x`），可以拿 t.exe 重跑核對
- **參數管理**：新增、停用、修改控制點，殘差即時更新；儲存時建立版本並可還原；可匯入／匯出 `.inp` 和 JSON 參數檔（含轉換係數與配置權重）
- **版本與更新**：可由更新網址或新版檔案覆寫本檔；也可以產生內含目前參數庫的新 HTML，直接分享給同事

## 段籍圖
`sections.json` 的 `boundaries` 指向苑裡（`../KC02/KC02`）、通霄（`../KC03/KC03`）段籍圖 shapefile。
注意：.prj 雖標示 TWD97，實際坐標是各段的**地籍坐標系**（346～380 等段為 TWD67，381～390、1100、1112 等段兩組坐標相同），因此分布圖與地段判斷一律使用 .inp 的第一組坐標（TWD67 側）。
建置時由 `shpread.py` 讀入（不需 GIS 套件），簡化至 1 m 後內嵌，用於：
- 所有分布圖的底圖（地籍坐標），所選參數組的適用地段以灰底標示
- 參數管理的「地段細分分析」：各段的段內／鄰近控制點數、涵蓋率、單獨解算精度、補點方位與建議
- 轉換時判斷點位所在地段，並提醒是否選錯參數組

## 正確性
`python build.py` 會順便產生 `tests/test.html`，用參數資料夾中 23 組歷次解算成果，
逐字比對本工具與 t.exe 產生的 `.out`、`AFFINE6.OUT`、`resid.ne`、`interp.out`。目前 23 組全部一致。

> 「與原程式逐位相容」開關（預設開啟）會照 t.exe 的作法，把中間檔取到 mm 再做配置，並使用原程式的求逆演算法。

## 發佈新版（維護者）
1. 修改 `src/`（engine.js 是演算法、app.js 是介面、template.html 是版面），或在 `sections.json` 調整內建參數組
2. 更新 `src/version.json`：把 `version` 加 1，並在 `changelog` 最前面加上這版的說明
3. 執行 `python build.py`，產生 `docs/` 下的 `坐標轉換工具.html`、`index.html`、`latest.json`
4. 用瀏覽器開啟 `tests/test.html`，確認全部 PASS
5. `git commit` 並 `git push`；GitHub Pages 會自動發佈 `docs/`，各使用者開啟時（每日一次）會偵測到新版並可一鍵更新

## 自訂參數存放位置
自訂參數存在瀏覽器的 localStorage，所以更新程式檔後仍然保留。
換電腦或換瀏覽器前，請先在「版本與更新」頁按「匯出自訂資料備份」；或按「產生含目前參數庫的 HTML」，把參數直接寫進 HTML。
