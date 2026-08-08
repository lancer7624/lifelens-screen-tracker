/**
 * screenshot.js — 截屏模块
 * 捕获主屏幕，缩小后存 PNG 以节省空间
 */
const { desktopCapturer, screen, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { imagePathFor } = require('./storage');

const MAX_WIDTH = 960; // scale down large screens, AI still readable

async function capture() {
  const timestamp = new Date();
  const primaryDisplay = screen.getPrimaryDisplay();
  let { width, height } = primaryDisplay.size;

  // Scale down for storage efficiency
  const scale = Math.min(1, MAX_WIDTH / width);
  if (scale < 1) { width = Math.round(width * scale); height = Math.round(height * scale); }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });

  if (sources.length === 0) throw new Error('未找到屏幕源');
  const img = sources[0].thumbnail;
  const pngBuffer = img.toPNG();
  if (!pngBuffer || pngBuffer.length === 0) throw new Error('截屏返回空数据');

  const { absPath, relPath } = imagePathFor(timestamp);
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absPath, pngBuffer);

  return { absPath, relPath, timestamp, size: pngBuffer.length };
}

module.exports = { capture };
