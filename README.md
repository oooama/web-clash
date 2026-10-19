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
| 7892 | 混合代理端口（HTTP + SOCKS5，mihomo `mixed-port`） |
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
    free-sources.js        免费源聚合（抓取 / 合并去重 / 两阶段测活）
    intranet.js            内网直连规则（私网 CIDR / 内网域名 DNS 策略）
    meta.js                profile-meta.json 的读写与并发保护
    mihomo.js              controller 探测与日志流（含看门狗）
    paths.js               订阅文件名净化与路径约束
    security.js            请求来源校验（Host / Origin / 自定义头）
    subscription*.js       订阅下载与分享链接解析
    system-proxy.js        Windows 系统代理开关
  routes/                  status / system / logs / config / profiles / free-sources
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

## 免费订阅聚合

配置页的「免费聚合」按钮（`POST /api/free-sources/refresh`）会抓取公开免费源、合并去重、
测活，生成 `profiles/free-aggregate.yaml`，并把它登记为一个带自动更新间隔的配置
（默认 2 小时，可在「编辑配置」里改）。源列表在 `data/free-sources.json`，首次运行自动
生成内置默认值，可手工增删；`raw.githubusercontent.com` 抓取失败时自动改走 `gh-proxy.com` 镜像。

聚合配置的 `Proxy` 组**默认指向 `Auto`（url-test，自动选最快可用节点）**，而不是 `DIRECT`：
选组以 `DIRECT` 开头会让被墙站点全部直连，看起来就像「一个节点都不能用」。仍可在代理页
手动选 `DIRECT` 或任意单节点。

### 节点失效时会自动切换吗

会，但有前提（均已实测）：

- **`Proxy` 指向 `Auto` 时才会自动切**。`Auto` 每 `interval`（默认 60 秒）重测所有成员，
  换到当前最快的存活节点；实测把死节点放进组里，会在下一轮检查时被换掉。
- **手动钉住某个单节点后不会自动切**。select 组是手动的，选中哪个就一直用哪个——这是
  mihomo 的设计，不是 bug。所以日常应保持 `Proxy = Auto`。
- **`lazy: false` 是必需的**。默认 `lazy: true` 在没有流量时跳过健康检查，节点半夜死掉
  也要等你下次上网才发现；实测 12 秒空闲内 `lazy: true` 只检查 1 次，`lazy: false` 检查 4 次。
- 切换延迟上限约为一个 `interval`（即最差约 60 秒失败后换掉）。

### 测活基准 URL 必须是真的被墙域名

`www.gstatic.com` 在国内可直连，用它当基准会把「能过测速但代理不了真实站点」的节点判为健康：
实测一个 CN 节点 gstatic 1195ms 通过、`www.google.com` 直接 ECONNRESET。因此测活与
`Auto` 的健康检查都用 `https://www.google.com/generate_204`。

测活分两阶段，因为 **TCP 连通不等于节点可用**：

1. TCP 粗筛（快）——剔除离线主机与关闭的端口。单独看它会严重高估：实测同一批 TCP 存活的
   节点经核心真实连接，`vmess 0/12`、`vless 0/12`、`ss 0/7` 全部失败（密钥过期、IP 被封、
   假端口都会照常接受 TCP），而 `http 7/12`、`socks5 2/2` 这类无需握手的协议才真的能用。
2. 真实握手测活——起一个**临时 mihomo 实例**（独立端口 + 独立临时目录）加载候选
   节点，让核心逐个实际连一次，只有连通的节点才写入配置。临时实例用完即删，不碰正在运行的核心。
   若临时实例启动失败或零节点通过，**保留原有配置并报错**，绝不把未验证节点当成已验证写入。

实测一轮：1192 个合并节点 → TCP 存活 389 → 真实可用 31。免费节点可用率就是这么低，
所以不测活的聚合结果基本不可用。

## 内网域名直连

公司内网域名常常「看起来是公网域名、实际解析到私网 IP」。开了代理后访问不了它，原因是两层叠加：

1. **fake-ip 模式**下浏览器连的是假 IP，传统的 `IP-CIDR,...,no-resolve` 规则匹配不到真实私网地址，
   流量落到 profile 自己的 `MATCH` → 被送到远程节点，而远程节点访问不了你的内网。
2. 核心默认用**公网 DNS**（如 `223.5.5.5`），对内网域名要么返回 NXDOMAIN、要么返回**错误的公网地址**；
   公司 DNS 才能解析 split-horizon 内网地址。

现在采用**自动识别**，不要求每个内网域名手动登记：

- 自动读取系统 DNS，把公司 DNS 放在核心 DNS 列表前面，公网 DNS 保留作 fallback；
- 把私网 CIDR 规则（`10/8`、`172.16/12`、`192.168/16` 等）放在 profile 的 `MATCH` 前，
  **去掉 `no-resolve`**；这样对任何未知域名，mihomo 会先解析，若得到私网 IP 就自动 DIRECT；
- 已知域名（当前 `mychery.com`、`exeedcars.com`）仍会额外进入 `nameserver-policy` 和 `fake-ip-filter`，作为快速、确定的路径；
- `data/intranet.json` 仍可手动添加特殊域名，但不再是必需步骤。

本机实测：没有为 `newcowin.com` 添加域名规则时，`dmstest.newcowin.com` 仍自动解析到 `10.60.2.217`，并命中
`IP-CIDR(10.0.0.0/8) -> DIRECT`。注意它的服务端口是 **8080**，不是 80，正确地址是
`http://dmstest.newcowin.com:8080/`；80 端口本身拒绝连接。


## 故障排查
| 现象 | 处理 |
| --- | --- |
| 启动报 `Port 7891 is already in use` | 已有控制台在跑：先 `stop.bat` |
| 页面能开但数据为空 | 核心没起：确认 `bin/mihomo-run.exe` 存在，或在界面点右下角按钮启动 |
| 日志页长期为空 | 核心未运行；日志流有看门狗，核心起来后会自动接上 |
| 订阅添加失败并提示 Cloudflare | 订阅站有防护，改用「粘贴 YAML」方式导入 |
| 想确认跨站是否被拦 | 控制台 stderr 会打印 `[security] rejected ...` |
| 免费聚合后节点很少 | 正常：免费节点真实可用率极低，测活会剔除绝大部分；可编辑 `data/free-sources.json` 换源重试 |
| 免费聚合抓不到源 | 公司网络会间歇拦截 `raw.githubusercontent.com`；已自动回退 `gh-proxy.com`，仍失败则稍后重试 |
| 免费聚合报「真实测活未完成」 | 临时核心没起来（多为端口/文件句柄竞争）；已保留原配置，稍后重试即可 |
| 代理开着但连不上内网 | 见上方「内网域名直连」；确认 `data/intranet.json` 里的域名与公司 DNS 正确 |
| 核心起不来、日志报 `listen udp ...: bind` | 混合端口被占用。若是**已退出进程**残留的僵尸 socket，杀进程无效，需重启系统（或临时改用其他端口，见 `server/constants.js` 的 `MIXED_PORT`） |

## 已知限制

- 仅支持 Windows（系统代理开关与 `tasklist` 依赖 Windows 命令）
- 无鉴权密码：依赖「只监听本机 + 来源校验」这一模型，不适合暴露到局域网或公网
- 无打包压缩：前端按模块原样加载
