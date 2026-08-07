# LifeLens — 屏幕活动追踪器

每 20 秒自动截屏，AI 分析你正在做什么。支持桌面端 + 手机浏览器远程查看。

## 功能

- **自动截屏分析** — 每 20 秒截屏，AI 识别活动（编程/娱乐/社交/学习）
- **10 分钟结构化汇总** — 项目名、分类、详细描述、软件列表、待办提醒
- **活动热力图** — GitHub 风格，每个格子 = 10 分钟，颜色区分活动类型
- **活动时间线** — 按项目/软件/日期筛选，纵向无限滚动加载
- **局域网手机访问** — 内置 HTTP 服务，手机扫一眼就知道今天干了啥
- **三种视觉引擎** — Ollama / LM Studio / 纯截图模式，你想用哪个用哪个
- **DeepSeek 提炼** — 视觉模型看图 → DeepSeek 提炼结构化输出（可选）

## 架构

```
截屏 → 视觉模型看图 → DeepSeek 提炼 → 本地存储 → 仪表盘
  ↑                     ↑
  Ollama 本地           DeepSeek API (可选)
  或 LM Studio
```

## 安装

```bash
# 1. 克隆
git clone https://github.com/lancer7624/lifelens-screen-tracker.git
cd lifelens-screen-tracker

# 2. 安装依赖
npm install

# 3. 安装 Ollama + 视觉模型
# 下载 Ollama: https://ollama.com
ollama pull qwen3-vl:4b

# 4. (可选) 获取 DeepSeek API Key
# https://platform.deepseek.com/api_keys

# 5. 启动
npm start
```

首次启动会自动跳设置页。填好 DeepSeek Key 或直接切到「纯截图」模式就能用。

## 手机查看

电脑启动后，在同 WiFi 下打开 `http://你的电脑IP:3456` 即可查看完整仪表盘。

## 文件结构

```
screen-analyzer2/
├── main.js              ← Electron 主进程
├── index.html           ← 仪表盘 UI
├── styles.css           ← 样式
├── renderer.js          ← 桌面版渲染器
├── renderer-web.js      ← 网页版渲染器
├── preload.js           ← IPC 桥接
├── start-app.cmd        ← Windows 启动脚本
├── deepseek_config.json ← 配置文件 (API Key 等)
└── modules/
    ├── analyzer.js      ← AI 分析 (Ollama/LM Studio/DeepSeek)
    ├── screenshot.js    ← 桌面截屏
    ├── storage.js       ← 本地文件存储
    ├── summarizer.js    ← 10 分钟汇总
    └── server.js        ← HTTP 局域网服务
```

## 技术栈

- Electron 28
- Ollama + qwen3-vl:4b 视觉模型
- DeepSeek V4 Flash API
- 原生 Node.js (零前端框架)

## License

MIT
