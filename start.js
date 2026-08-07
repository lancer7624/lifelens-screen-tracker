/**
 * start.js — Electron 启动入口
 *
 * 严格确保 ELECTRON_RUN_AS_NODE 未设置，防止 Electron 退化。
 * 用法: node start.js  或  electron start.js
 */

// 强制删除这个会导致 Electron 以 Node.js 模式运行的环境变量
delete process.env.ELECTRON_RUN_AS_NODE;

// 如果以 Node.js 运行，则启动 Electron 子进程
if (!process.versions.electron) {
  const { spawn } = require('child_process');
  const path = require('path');

  // 找 electron 二进制
  const electronBin = process.env.ELECTRON_BIN
    || 'd:\\worklocation\\electron-bin\\electron.exe';

  const child = spawn(electronBin, [path.join(__dirname, 'start.js')], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    shell: true,
  });

  child.on('exit', (code) => process.exit(code));
} else {
  // 在 Electron 环境中，加载真正的 main.js
  require('./main.js');
}
