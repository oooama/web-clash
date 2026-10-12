# WebFlClash

本地 mihomo（Clash.Meta）Web 控制台。后端 Express，前端零构建原生 ES Modules。

## 快速开始

```
start.bat                 # 启动控制台 + 核心，并打开系统代理
start.bat --no-proxy      # 只启动，不碰系统代理
open-web.bat              # 同上，并自动打开浏览器
stop.bat                  # 停止核心 + 控制台，关闭系统代理
```

首次运行前需要 `bin/mihomo-run.exe`（本仓库不包含二进制）：

1. 从 https://github.com/MetaCubeX/mihomo/releases 下载 `mihomo-windows-amd64-*.zip`
2. 解压出 `mihomo.exe`，重命名为 `mihomo-run.exe` 放入 `bin/`

`data/geoip.dat` 与 `data/geosite.dat` 同样按需放入（规则里用到 GEOIP 时必需）。

## 端口

| 端口 | 用途 |
| --- | --- |
| 7891 | Web 控制台（仅绑定 127.0.0.1） |
| 7890 | 混合代理端口（HTTP + SOCKS5，mihomo `mixed-port`） |
| 9090 | mihomo external controller（仅 127.0.0.1） |

## 目录

```
server.js                  进程入口：目录、监听、定时器、致命错误处理
server/
  constants.js             端口与路径的唯一定义
  app.js                   Express 装配、WebSocket、/api 转发、SPA fallback
  lib/
    atomic.js              原子写（临时文件 + rename）与按路径串行队列
    config.js              defaultConfig() / 读写 config.yaml
    core.js                核心进程生命周期（PID 文件，不误杀）
    exec.js                execFile 封装（不经过 cmd.exe）
    meta.js                profile-meta.json 的读写与并发保护
    mihomo.js              controller 探测与日志流（含看门狗）
    paths.js               订阅文件名净化与路径约束
    security.js            请求来源校验（Host / Origin / 自定义头）
    subscription*.js       订阅下载与分享链接解析
    system-proxy.js        Windows 系统代理开关
  routes/                  status / system / logs / config / profiles
  services/auto-update.js  订阅定时刷新
public/
  index.html               页面骨架（仅结构 + 内联样式）
  css/                     样式，按 tokens/base/layout/components/pages 拆分
  js/                      前端 ES Modules（路由、API、组件、页面）
test/                      node:test 单元测试
check.js                   静态检查（语法 / 模块解析 / 结构不变量）
```

## 开发

```
npm install
npm run check     # 语法、模块解析、结构不变量
npm test          # 单元测试
npm start         # 启动控制台
```

无需构建步骤：`public/` 就是可直接托管的产物。

## 安全模型

控制台只绑定 `127.0.0.1`，但这挡不住浏览器——任何网页都能向 `http://127.0.0.1:7891/api/...`
发出「简单请求」。因此 `/api` 与 WebSocket 握手都经过 `server/lib/security.js` 校验：

1. `Host` 必须是 `127.0.0.1:7891` / `localhost:7891`（挡 DNS rebinding）
2. 若带 `Origin`/`Referer`，必须等于控制台自身来源（挡跨站请求）
3. 写操作（POST/PUT/PATCH/DELETE）必须带 `X-Console-Request` 头

第 3 条是关键：跨站请求无法自定义请求头（会触发预检，而本服务不响应预检）。
前端 `public/js/api.js` 会自动带上该头。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 启动报 `Port 7891 is already in use` | 已有控制台在跑：先 `stop.bat` |
| 页面能开但数据为空 | 核心没起：确认 `bin/mihomo-run.exe` 存在，或在界面点右下角按钮启动 |
| 日志页长期为空 | 核心未运行；日志流有看门狗，核心起来后会自动接上 |
| 订阅添加失败并提示 Cloudflare | 订阅站有防护，改用「粘贴 YAML」方式导入 |
| 想确认跨站是否被拦 | 控制台 stderr 会打印 `[security] rejected ...` |

## 已知限制

- 仅支持 Windows（系统代理开关与 `tasklist` 依赖 Windows 命令）
- 无鉴权密码：依赖「只监听本机 + 来源校验」这一模型，不适合暴露到局域网或公网
- 无打包压缩：前端按模块原样加载
