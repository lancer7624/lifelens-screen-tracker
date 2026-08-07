/**
 * storage.js — 文件存储管理
 *
 * 结构:
 *   screenshots/
 *     YYYY-MM/                        ← 月文件夹
 *       YYYY-MM-DD_HH.json           ← 小时文件（JSON 数组）
 *       YYYY-MM-DD_HH-mm-ss.png      ← 截屏图片
 *
 * JSON 记录格式:
 * {
 *   "date": "2026-07-31",
 *   "hour": "14",
 *   "entries": [
 *     {
 *       "timestamp": "2026-07-31T14:30:00.000+08:00",
 *       "image": "screenshots/2026-07/2026-07-31_14-30-00.png",
 *       "summary": "...",
 *       "detail": { "apps": [...], "activity": "...", "focus": "..." }
 *     }
 *   ]
 * }
 */

const fs = require('fs');
const path = require('path');

// 项目根目录（screenshots/ 的父目录）
const BASE_DIR = path.join(__dirname, '..', 'screenshots');

/**
 * 格式化时间戳的各部分
 */
function formatParts(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const sec = String(date.getSeconds()).padStart(2, '0');
  const monthKey = `${y}-${m}`;
  const dateStr = `${y}-${m}-${d}`;
  const timeStr = `${h}-${min}-${sec}`;
  const isoStr = `${y}-${m}-${d}T${h}:${min}:${sec}.000+08:00`;
  return { y, m, d, h, min, sec, monthKey, dateStr, timeStr, isoStr };
}

/**
 * 确保月文件夹存在，返回其绝对路径
 */
function ensureMonthDir(monthKey) {
  const dir = path.join(BASE_DIR, monthKey);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 读取小时 JSON 文件，不存在则返回空结构
 */
function readHourFile(monthDir, dateStr, hour) {
  const filename = `${dateStr}_${hour}.json`;
  const filepath = path.join(monthDir, filename);
  if (fs.existsSync(filepath)) {
    try {
      const raw = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      // 文件损坏则重建
    }
  }
  return { date: dateStr, hour, entries: [] };
}

/**
 * 写入小时 JSON 文件
 */
function writeHourFile(monthDir, data) {
  const filename = `${data.date}_${data.hour}.json`;
  const filepath = path.join(monthDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  return filepath;
}

/**
 * 保存一条截屏记录
 * @param {string} imagePath  相对于 screenshots/ 的图片路径
 * @param {string} summary    Ollama 生成的 5 句摘要
 * @param {object} detail     结构化分析 { apps, activity, focus }
 * @param {Date}   timestamp  截屏时间
 * @returns {{ monthDir, jsonPath, entry }}
 */
function saveRecord(imagePath, summary, detail, timestamp = new Date()) {
  const parts = formatParts(timestamp);
  const monthDir = ensureMonthDir(parts.monthKey);
  const data = readHourFile(monthDir, parts.dateStr, parts.h);

  const entry = {
    timestamp: parts.isoStr,
    image: imagePath,
    summary: summary,
    detail: detail,
  };

  data.entries.push(entry);
  const jsonPath = writeHourFile(monthDir, data);

  return { monthDir, jsonPath, entry, parts };
}

/**
 * 生成图片文件名和相对路径
 */
function imagePathFor(timestamp = new Date()) {
  const parts = formatParts(timestamp);
  const filename = `${parts.dateStr}_${parts.timeStr}.png`;
  return {
    filename,
    relPath: `${parts.monthKey}/${filename}`,
    absPath: path.join(BASE_DIR, parts.monthKey, filename),
  };
}

/**
 * 获取今天的截图数量
 */
function todayCount(date = new Date()) {
  const parts = formatParts(date);
  const monthDir = path.join(BASE_DIR, parts.monthKey);
  if (!fs.existsSync(monthDir)) return 0;

  const prefix = parts.dateStr;
  let count = 0;
  const files = fs.readdirSync(monthDir);
  for (const f of files) {
    if (f.startsWith(prefix) && f.endsWith('.png')) count++;
  }
  return count;
}

module.exports = { saveRecord, imagePathFor, todayCount, BASE_DIR };
