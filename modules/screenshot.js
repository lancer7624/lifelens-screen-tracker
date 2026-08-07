/**
 * screenshot.js — 截屏模块
 *
 * 使用 Electron desktopCapturer 捕获主屏幕，
 * 保存 PNG 到 screenshots/YYYY-MM/ 目录。
 */

const { desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { imagePathFor } = require('./storage');

/**
 * 截取主屏幕，保存 PNG，返回图片信息
 * @returns {Promise<{absPath: string, relPath: string, timestamp: Date, size: number}>}
 */
async function capture() {
  const timestamp = new Date();

  // 获取主屏幕实际分辨率
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  // 获取屏幕源（使用实际分辨率）
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });

  if (sources.length === 0) {
    throw new Error('未找到屏幕源 — 请确认桌面环境可用');
  }

  // 取主屏幕（第一个）
  const primarySource = sources[0];
  const pngBuffer = primarySource.thumbnail.toPNG();

  if (!pngBuffer || pngBuffer.length === 0) {
    throw new Error('截屏返回空数据 — 重试中');
  }

  // 确定保存路径
  const { absPath, relPath } = imagePathFor(timestamp);

  // 确保目录存在
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 写入 PNG
  fs.writeFileSync(absPath, pngBuffer);

  return {
    absPath,
    relPath,
    timestamp,
    size: pngBuffer.length,
  };
}

module.exports = { capture };
