# LanLens Enhanced

基于 [AlexRosbach/LanLens](https://github.com/AlexRosbach/LanLens) **v1.5.9** 的增强版本。

本仓库完整保留 LanLens v1.5.9 的上游源码，同时将我们实际使用的 **Auto Services v5** 增强层独立放在 `enhancements/runtime/` 中。这样既能直接查看原版代码，也能明确看到本项目到底修改了什么。

> 上游基线：LanLens v1.5.9 / commit `b8fa87166ed39ff6f35305fbca6dec6ead7eda20`

## 我们增加了什么

### 1. 端口扫描结果自动生成 Service

原版 LanLens 的端口扫描结果与 Services 目录是两个相对独立的功能。本版本会在端口扫描完成后，把新发现的开放端口自动映射成 Service。

例如扫描发现：

```text
192.168.1.11:4369/TCP  epmd
192.168.1.11:61208/TCP unknown
192.168.1.11:65443/TCP https
```

Services 中会自动建立对应条目，并根据常见协议推断名称、类型、协议和 URL。

自动创建后，用户仍然可以手工修改：

- 服务名称
- 描述
- 分组
- URL
- 备注
- 账号提示等字段

**后续扫描不会覆盖这些人工修改。**

### 2. TCP / UDP 独立跟踪

同一端口的 TCP 与 UDP 状态分别记录。例如 `53/TCP` 与 `53/UDP` 不会被当成同一个服务状态。

增强层使用独立表：

```text
lanlens_auto_service_status
```

不修改 LanLens 原有数据表结构，已有数据库可以继续使用。

### 3. Service 在线 / 离线状态

扫描到端口开放时显示：

```text
● 在线
```

明确扫描到端口关闭后显示：

```text
● 离线
```

状态颜色：

- 在线：绿色
- 离线：红色
- 未检测：灰色

### 4. 新端口与端口离线通知

新增端口时生成通知：

```text
发现新端口：192.168.1.11:61208/TCP（Glances）
```

已跟踪端口由在线变成离线时生成：

```text
端口离线：192.168.1.11:65443/TCP（SafeLine Health Check）
```

通知采用状态切换逻辑：

- 第一次发现开放端口：通知一次
- 持续在线：不重复通知
- 在线 → 离线：通知一次
- 持续离线：不重复通知
- 离线 → 再次在线：恢复在线状态，不再次当成“新端口”刷通知

同时避免一个重要误判：`top:N` 扫描没有覆盖到的高位端口，不会因为本轮未出现就被错误判定为离线。

### 5. 中文模式下通知正文中文化

LanLens v1.5.9 原版通知标签支持 i18n，但不少后端生成的通知正文仍然是英文。

本版本在中文模式下对常见通知进行中文展示，包括：

- 新设备发现
- IP 地址变化
- 主机名变化
- 设备上线 / 离线
- 归档状态变化
- MAC 变化
- 未知 DHCP Server
- 新端口发现
- 端口离线

英文模式保持原文。

### 6. Services 排序优化

全局 Services 页面按以下顺序排序：

```text
IP 数值顺序 → 端口号 → TCP/UDP → 服务名称
```

例如：

```text
192.168.1.2:22
192.168.1.2:80
192.168.1.11:22
192.168.1.11:4369
192.168.1.11:61208
```

而不是按字符串导致 `192.168.1.11` 排在 `192.168.1.2` 前面。

单设备详情页中的 Services 则主要按端口号排序。

## 端口状态判断逻辑

增强代码不会简单地把“本轮扫描结果中没出现”理解成离线。

对于明确指定的扫描范围，例如：

```text
22,80,443,8000-9000
```

只有处在该范围内、且本次确认没有开放的已跟踪端口，才会被更新为离线。

对于：

```text
top:1000
```

由于无法证明未返回的自定义高端口真的被覆盖扫描，因此不会批量把其它端口标记为离线。

单端口扫描只更新该端口。

## LanLens 后台端口扫描调度逻辑

例如设置后台端口扫描间隔为 `360` 分钟，并不是每 360 分钟只扫描一个 IP。

实际逻辑是：

```text
每 360 分钟启动一轮任务
        ↓
读取符合条件的设备
        ↓
按 Device ID 排序
        ↓
依次扫描每个合法 IPv4
```

参与后台扫描的设备必须满足：

- 有 IP 地址
- 未被 Ignore
- 未归档
- 是合法 IPv4
- 每轮最多 100 台设备

每轮内部是逐台执行，因此端口范围很大时，排在后面的设备会晚一些完成。

## 目录结构

```text
LanLens-Enhanced/
├── backend/                    # LanLens v1.5.9 原始后端源码
├── frontend/                   # LanLens v1.5.9 原始前端源码
├── nginx/                      # LanLens 原始 Nginx 配置
├── scripts/                    # LanLens 原始脚本
├── Dockerfile                  # LanLens v1.5.9 原始 Dockerfile
├── Dockerfile.enhanced         # 本项目增强版构建文件
├── docker-compose.yml          # 增强版启动文件
├── enhancements/
│   └── runtime/
│       ├── auto_services_extension.py
│       ├── auto_services_api.py
│       ├── lanlens-auto-services-ui-v5.js
│       └── patch_runtime.py
├── MODIFICATIONS.md            # 详细修改说明
└── UPSTREAM_README.md          # 上游项目原 README
```

## Docker 构建和启动

默认数据目录按当前 fnOS 环境设置为：

```text
/vol4/1000/应用数据/lanlens
```

构建：

```bash
docker compose build --pull=false
```

启动：

```bash
docker compose up -d
```

如果已有旧容器：

```bash
docker rm -f lanlens 2>/dev/null || true
docker compose up -d
```

查看日志：

```bash
docker logs -f lanlens
```

默认 Web 端口：

```text
8089
```

默认 Backend 端口：

```text
18089
```

可以复制 `.env.example` 为 `.env` 修改端口和数据目录。

## 数据升级说明

增强版继续使用 LanLens 原数据目录 `/data`，不会主动删除原来的：

- 设备
- Services
- 服务名称和说明
- 服务分组
- 扫描历史
- 通知

Auto Services 使用自己的 `lanlens_auto_service_status` 表保存端口状态。

## 与原版的关系

本项目不是 LanLens 官方版本。

上游项目及其原始源码、版权和许可证归原作者所有。仓库保留原项目的 `LICENSE`、`THIRD_PARTY_NOTICES.md` 等文件；本项目只在上游 v1.5.9 基础上维护本地增强功能。

详细代码改动见 [MODIFICATIONS.md](./MODIFICATIONS.md)。
