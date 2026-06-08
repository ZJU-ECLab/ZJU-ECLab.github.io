# ZJU-ECLab.github.io

浙江大学情绪和文化实验室文献汇编《东西情报》在线版。

访问地址：<https://zju-eclab.github.io>

## 结构

这是一个纯静态的数据驱动单页站点，**不为每期生成 HTML**。所有期刊共用同一套模板：

```
index.html            页面外壳（页眉 / 侧栏 / 页脚）
assets/style.css      主题样式（accent 色按每期 JSON 动态设置）
assets/app.js         前端逻辑（路由、首页、期刊视图、筛选）
data/manifest.json    全部期刊的索引（按年份分组，最新一期置顶）
data/issues/<期次>.json  每期的完整数据（含摘要）
.nojekyll             关闭 GitHub Pages 的 Jekyll 处理
```

路由（基于 URL hash）：

- `#/` — 首页，列出所有期刊
- `#/issue/<起始日期>_<结束日期>` — 某一期（如 `#/issue/2026-06-01_2026-06-07`）

## 数据从哪里来

数据由 [`ZJU-ECLab/ECLab-News`](https://github.com/ZJU-ECLab/ECLab-News) 流水线生成。
该仓库的 GitHub Actions 在每期生成后，会把新的 `issues/<期次>.json` 推送到本仓库的
`data/issues/`，并重建 `data/manifest.json`。无需手动编辑数据文件。

## 本地预览

```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 必须通过 HTTP 服务器访问（`app.js` 用 `fetch` 加载 JSON），直接双击打开 `index.html` 无法加载数据。

## 部署

仓库名为 `ZJU-ECLab.github.io`，是组织默认 Pages 站点。
在仓库 Settings → Pages 中将来源设为默认分支（`main`）根目录即可，
站点自动发布在 <https://zju-eclab.github.io>。
