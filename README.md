# 充电台账

一个用于记录每日充电**电量 / 金额**的网页台账，支持上传充电桩「账单结算」截图自动识别填入。
纯静态页面，无需服务器，可直接部署到 **GitHub Pages**。

## 功能

- 多台账：按公司 / 车牌分别建表（对应 Excel 中每个单位一张表）
- 按月台账：日期 1–31，每天最多 5 次充电，每次记录电量与金额
- 自动汇总：当日合计、本月总电量 / 总金额 / 充电次数
- 电价换算：输入电量后未填金额时，按台账电价自动计算
- 图片识别：上传账单截图，浏览器本地识别并提取电量、金额、日期、状态
- 导出：导出 Excel（沿用原台账格式，每个台账一张工作表）、导出 CSV
- 备份 / 恢复：导出、导入 JSON 数据文件

## 使用

直接双击打开 `index.html` 即可使用；也可部署到 GitHub Pages 后把网址发给同事。
数据保存在浏览器本地（localStorage），**不上传服务器**，请定期使用右上角菜单的「备份数据」。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个 **Public** 仓库，例如 `charging-ledger`。
2. 在本项目目录执行：

   ```bash
   git init
   git add .
   git commit -m "feat: 充电台账"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/charging-ledger.git
   git push -u origin main
   ```

3. 打开仓库 **Settings → Pages**：
   - **Source** 选择 `Deploy from a branch`
   - **Branch** 选择 `main`，目录选择 `/ (root)`，点击 **Save**
4. 等待约 1 分钟，访问 `https://<你的用户名>.github.io/charging-ledger/`

> 手机浏览器可「添加到主屏幕」，像 App 一样使用。

## 目录结构

```
index.html          页面结构
css/style.css       样式
js/store.js         数据层（本地存储，接口已预留可替换为云端）
js/ocr.js           图片识别与字段解析（Tesseract.js）
js/export.js        Excel / CSV 导出、JSON 备份恢复
js/app.js           界面与交互
```

## 说明

- 图片识别依赖 CDN 上的 Tesseract.js 与中文语言包，**首次识别需要联网**下载模型，之后会缓存。
- Excel 导出依赖 CDN 上的 SheetJS。
- 数据仅存于当前浏览器，换设备 / 清缓存不会同步；需要多人共享同一份数据时，可将 `js/store.js` 的读写替换为云端数据库（如 Supabase），其余界面无需改动。