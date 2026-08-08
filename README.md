# LifeLens — 屏幕活动追踪器

每 20 秒自动截屏，AI 分析你正在做什么。支持桌面端 + 手机浏览器远程查看。

## 六个标签页

| 标签 | 功能 |
|------|------|
| **实时** | 截屏分析仪表盘 — 当前活动、AI 摘要、应用标签、运行日志 |
| **回顾** | 热力图(10分钟粒度) + 看板(饼图/柱状图/时间分布) + 日记(AI每日总结) |
| **对话** | Agentic 问答 — DeepSeek 自动搜索历史记录后回答 |
| **⚙ 设置** | 视觉引擎(Ollama/LM Studio/纯截图) + DeepSeek 提炼 + API Key |

## 功能

- **20秒自动截屏** — 静默截屏压缩存储(960px, ~80KB/张)
- **AI 活动识别** — Ollama qwen3-vl 看图 → DeepSeek V4 Flash 提炼，输出结构化 JSON
- **10 分钟汇总** — DeepSeek 二阶聚合：项目名、分类、详细描述(~1000字)、软件列表、待办
- **每日 AI 日记** — 从当天所有汇总生成：日记式总结、三件高光、待办、优化建议、温馨提示
- **活动热力图** — GitHub 风格，每格 = 10 分钟，颜色区分工作/学习/娱乐/社交，年月日三级联动
- **活动时间线** — 按项目/软件/日期/分类筛选，展开全文，纵向滚动
- **看板图表** — 饼图(活动占比) + 柱状图(软件排名/项目专注) + 24h 时间分布堆叠图
- **Agentic 问答** — 模型自动生成关键词 → 搜索历史记录 → 迭代 3 轮 → 回答
- **空闲检测** — 5 分钟无操作自动暂停截屏，回来恢复
- **数据清理** — 截图 >24h 自动删除，总存储上限 5GB
- **局域网手机访问** — 内置 HTTP:3456，同 WiFi 下手机浏览器直接看
- **三种视觉引擎** — Ollama / LM Studio / 纯截图模式
- **模型选择器** — DeepSeek V4 Flash / V4 / Chat / Reasoner 自由切换

## 更新日志

### v2.1 (2026-08-08)
- **修复** 端口占用弹窗 — server EADDRINUSE 错误处理 + 启动前清旧进程
- **修复** 网页版日记 — 改用直接读取静态 JSON 文件，移除有问题的 /api/diary 端点
- **修复** 项目专注图无法滚动 — 画布自适应高度 + 容器 max-height:500px 可滚动
- **修复** Ollama 0.32.x 兼容 — `num_predict` → `max_tokens`

### v2.0 (2026-08-08)
- **新增** 数据自动清理模块 (`modules/cleanup.js`) — 截图 >24h 删 + 5GB 上限
- **新增** 空闲检测 — powerMonitor 每 30s 检查，5min 无人自动暂停
- **新增** 标签栏重组 — 6 标签合并为 3 主标签(实时/回顾/对话) + 回顾子标签 + 设置齿轮
- **新增** 看板交互 — 饼图扇区可点击，自动钻取筛选时间线
- **新增** 看板统计卡片 — 总时段/活跃小时/主要活动/软件数
- **新增** 柱状图 tooltip — 鼠标悬停显示详情
- **新增** 网页版回顾标签 — renderer-web.js 同步日记/问答/子标签切换
- **改进** 截图压缩 — thumbnailSize 960px 宽，文件体积缩小 70%
- **改进** 图表可读性 — 字体 9→12-15px，时间分布画布 200→360px
- **改进** 分类映射 — 中文模型输出自动转 CSS 类名 (工作→work)
- **改进** 日期选择器 — 年/月/日三级联动替换 `<input type="date">`

### v1.0 (2026-08-07)
- **新增** 日记标签页 (`modules/diarist.js`) — 每日 AI 日记，二阶汇总生成
- **新增** 看板标签页 — Canvas 图表引擎(饼图/柱状图/时间分布)
- **新增** 问答标签页 (`modules/qa.js`) — Agentic 搜索，DeepSeek 驱动
- **新增** 设置引导 — 首次启动自动跳设置页，API Key 为空时提示
- **新增** 模型选择器 — 控制栏下拉切换 DeepSeek 模型
- **新增** 年月日三级联动日期选择器 — 热力图 + 时间线筛选
- **新增** 网页版独立 HTML — 桌面 LifeLens.html 双击即开
- **新增** 开机自启 — Windows 启动文件夹快捷方式 + VBS 隐藏启动
- **改进** UI 全面重写 — finesse 液态玻璃 + 暖调色板
- **改进** 热力图 — 一天一视图 + 年月日选择 + 时区 key 统一
- **改进** 分类 prompt — 明确视频/电影→娱乐，开发→工作
- **改进** JSON 解析 — 3 层策略 + 截断修复
- **修复** 时区 bug — 主进程/渲染进程 key 统一用本地时间格式
- **修复** 时间线默认筛选值 bug — placeholder option 用空 value

## 安装

```bash
git clone https://github.com/lancer7624/lifelens-screen-tracker.git
cd lifelens-screen-tracker
npm install
ollama pull qwen3-vl:4b          # 视觉模型
npm start
```

首次启动自动跳设置页。填 DeepSeek Key 或用纯截图模式。

## 手机查看

电脑启动后，同 WiFi 下打开 `http://你的电脑IP:3456`

## 文件结构

```
screen-analyzer2/
├── main.js              ← Electron 主进程 (窗口/菜单/IPC/定时器)
├── index.html           ← 仪表盘 UI
├── styles.css           ← finesse 液态玻璃样式
├── renderer.js          ← 桌面版渲染器 (6标签+图表引擎)
├── renderer-web.js      ← 网页版渲染器 (fetch API)
├── preload.js           ← IPC 桥接
├── start-app.cmd        ← Windows 启动脚本
├── start-hidden.vbs     ← 隐藏窗口启动 (开机自启用)
├── deepseek_config.json ← 配置文件 (API Key 等，不入 git)
├── package.json
└── modules/
    ├── analyzer.js      ← AI 分析 (Ollama/LM Studio/DeepSeek 三模式)
    ├── screenshot.js    ← 桌面截屏 (960px 压缩)
    ├── storage.js       ← 本地文件存储 (按月/时)
    ├── summarizer.js    ← 10 分钟结构化汇总
    ├── diarist.js       ← 每日 AI 日记
    ├── qa.js            ← Agentic 问答引擎
    ├── server.js        ← HTTP 局域网服务 (端口 3456)
    └── cleanup.js       ← 数据自动清理
```

## 技术栈

- Electron 28
- Ollama + qwen3-vl:4b 视觉模型
- DeepSeek V4 Flash API
- 原生 Node.js + Canvas 图表 (零前端框架依赖)

## License

MIT
