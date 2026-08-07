' start-hidden.vbs — 无窗口启动屏幕分析器（供开机自启调用）
' 用 WScript.Shell.Run 第二个参数 0 = 隐藏窗口，不闪黑窗

Set shell = CreateObject("WScript.Shell")
shell.Run """d:\worklocation\screen-analyzer2\start-app.cmd""", 0, False
