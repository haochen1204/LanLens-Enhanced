# LanLens Enhanced

基于 [AlexRosbach/LanLens](https://github.com/AlexRosbach/LanLens) **v1.5.9** 的增强版本，重点增强端口扫描后的服务资产维护、端口状态变化通知和中文通知体验。

> 上游基线：`AlexRosbach/LanLens v1.5.9`  
> 固定提交：`b8fa87166ed39ff6f35305fbca6dec6ead7eda20`

本仓库没有把原项目代码直接改乱，而是采用两层结构：

- `upstream/`：Git submodule，固定保存完整的 LanLens v1.5.9 源代码；
- `enhancements/runtime/`：我们新增的 Auto Services v5 增强代码。

这样可以同时保留 LanLens 原始源码，又能清楚看出我们到底修改了什么。

## 主要修改

### 1. 端口扫描结果自动创建 Service

原版 LanLens 的端口扫描和 Services 资产目录相对独立。本版本在端口扫描完成后，会把新发现的开放端口自动映射为 Service。

例如扫描发现：

```text
192.168.1.11:4369/TCP  epmd
192.168.1.11:61208/TCP unknown
192.168.1.11:65443/TCP https
```

会自动生成对应 Service，并根据端口和 nmap service name 推断：

- 服务名称
- 服务类型
- TCP / UDP
- HTTP / HTTPS URL
- 常见协议类型

已支持常见的 SSH、HTTP、HTTPS、DNS、RDP、SMB、FTP、MySQL、PostgreSQL、Redis、MongoDB、VNC、SNMP、NTP、EPMD、WinBox、WS-Discovery 等。

### 2. 不覆盖人工修改

自动发现 Service 后，可以继续人工修改：

- 名称
- 描述
- 分组
- URL
- 备注
- 登录提示等

后续端口扫描只维护端口状态和映射关系，**不会覆盖这些人工字段**。

### 3. TCP / UDP 分开跟踪

状态唯一键为：

```text
device_id + transport + port
```

因此：

```text
53/TCP
53/UDP
```

会被当作两个独立端点。

增强层新增独立状态表：

```text
lanlens_auto_service_status
```

不会修改 LanLens 原有数据表结构。

### 4. Service 在线 / 离线状态

Service 卡片会增加状态：

```text
● 在线
● 离线
● 未检测
```

显示规则：

- 在线：绿色
- 离线：红色
- 未检测：灰色

同时记录最近检查时间和最近开放时间。

### 5. 新端口通知

第一次发现以前没有跟踪过的开放端口时，新增通知，例如：

```text
发现新端口：192.168.1.11:61208/TCP（Glances）
```

端口保持开放不会每轮重复通知。

### 6. 端口离线通知

已跟踪端口从在线变成离线时新增通知，例如：

```text
端口离线：192.168.1.11:65443/TCP（SafeLine Health Check）
```

只有发生：

```text
在线 → 离线
```

时通知一次，持续离线不会刷屏。

端口重新开放时恢复在线状态，但不会重新当成“新端口”通知。

### 7. 避免误判高位端口离线

这是本版本端口状态逻辑里比较重要的一点。

对于明确范围扫描，例如：

```text
22,80,443,8000-9000
```

该范围内端口本轮没有开放，可以认为对应 TCP 端口已被明确扫描，因此允许更新为离线。

但是对于：

```text
top:1000
```

LanLens/nmap 只扫描常见端口集合，不能证明某个自定义高位端口真的被扫描过。

所以本版本不会因为 `top:N` 结果里没出现某个高位端口，就把它错误标成离线。

单端口扫描则只更新指定端口。

### 8. 中文通知正文

LanLens v1.5.9 原版虽然通知页面标签支持中文，但不少通知正文由后端直接生成英文。

本版本在中文模式下增加通知正文本地化，包括：

- 新设备发现
- IP 地址变化
- 主机名变化
- 设备上线
- 设备离线
- 设备归档/取消归档
- MAC 地址变化
- 未知 DHCP Server
- 新端口发现
- 端口离线

英文模式仍显示原始英文。

### 9. Services 排序优化

全局 Services 页面按照：

```text
数值 IP → 端口号 → TCP/UDP → 服务名称
```

排序。

例如会是：

```text
192.168.1.2:22
192.168.1.2:80
192.168.1.11:22
192.168.1.11:4369
192.168.1.11:61208
```

而不是按照字符串顺序把 `192.168.1.11` 排到 `192.168.1.2` 前面。

设备详情页中的 Services 主要按端口号排序。

## 后台端口扫描逻辑

例如把后台端口扫描周期设置成：

```text
360 分钟
```

并不是“每 360 分钟扫描一个 IP”。

LanLens v1.5.9 的逻辑是：

```text
每 360 分钟触发一轮扫描
        ↓
获取符合条件的设备
        ↓
按 Device ID 排序
        ↓
逐台执行端口扫描
        ↓
这一轮设备全部完成
```

后台任务只选择：

- 有 IP 地址的设备
- 未 Ignore 的设备
- 未归档设备
- 合法 IPv4
- 每轮最多 100 台

每轮内部目前是逐台执行，因此如果端口范围很大，排在后面的设备会较晚完成。

## 源码结构

```text
LanLens-Enhanced/
├── upstream/                   # 完整 LanLens v1.5.9 源码，Git submodule
│   ├── backend/
│   ├── frontend/
│   ├── nginx/
│   ├── scan-node/
│   ├── scripts/
│   └── Dockerfile
├── enhancements/
│   └── runtime/
│       ├── auto_services_extension.py
│       ├── auto_services_api.py
│       ├── lanlens-auto-services-ui-v5.js
│       └── patch_runtime.py
├── Dockerfile.enhanced
├── docker-compose.yml
├── .env.example
├── MODIFICATIONS.md
└── UPSTREAM.md
```

## 获取完整源码

推荐：

```bash
git clone --recurse-submodules https://github.com/haochen1204/LanLens-Enhanced.git
cd LanLens-Enhanced
```

如果已经普通 clone：

```bash
git submodule update --init --recursive
```

`upstream/` 会固定在 LanLens v1.5.9 对应提交，不会因为上游发布新版自动变化。

## Docker 构建

增强版直接使用 `upstream/` 中保存的 LanLens v1.5.9 源码构建，而不是只套一个现成镜像。

```bash
docker compose build --pull=false
```

启动：

```bash
docker compose up -d
```

如果已经有旧的 `lanlens` 容器：

```bash
docker rm -f lanlens 2>/dev/null || true
docker compose up -d
```

查看：

```bash
docker ps | grep lanlens
docker logs -f lanlens
```

## 默认部署参数

当前 `docker-compose.yml` 默认按照 fnOS 环境设置：

```text
Web:      8089
Backend:  18089
Timezone: Asia/Shanghai
Data:     /vol4/1000/应用数据/lanlens
```

可复制：

```bash
cp .env.example .env
```

再自行修改。

继续使用原来的 `/data` 数据目录，所以升级增强版不会主动删除已有：

- 设备
- Services
- 人工服务名称/描述
- 分组
- 扫描历史
- 通知

## 代码注入方式

`Dockerfile.enhanced` 首先从 `upstream/` 构建 LanLens v1.5.9，然后复制 `enhancements/runtime/` 中的增强文件。

`patch_runtime.py` 在镜像构建阶段对以下上游文件做最小化注入：

```text
backend/main.py
backend/routers/devices.py
backend/routers/services.py
frontend/dist/index.html
```

主要注入内容：

- 注册 `/api/services/auto-status`
- 端口扫描结束后执行 `sync_scan_result()`
- Service 排序
- 加载增强 UI JS

这种方式的目的，是让上游源码保持原样，便于后续升级和对比。

详细实现见 [MODIFICATIONS.md](./MODIFICATIONS.md)。

## 上游与许可证

本项目不是 LanLens 官方版本。

LanLens 原始源码、版权和许可证归原作者所有。`upstream/` 中完整保留上游 v1.5.9 的源码以及 `LICENSE`、`THIRD_PARTY_NOTICES.md` 等文件。

上游版本信息见 [UPSTREAM.md](./UPSTREAM.md)。
