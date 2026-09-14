# 修改说明

本文档只描述 **LanLens-Enhanced 相对 LanLens v1.5.9 的新增/修改部分**。

## 基线

- Upstream: `AlexRosbach/LanLens`
- Tag: `v1.5.9`
- Commit: `b8fa87166ed39ff6f35305fbca6dec6ead7eda20`
- Enhancement: `Auto Services v5`

## 核心实现

### `enhancements/runtime/auto_services_extension.py`

主要负责端口扫描结果和 Service 的同步。

新增 `AutoServiceStatus` 模型，表名：

```text
lanlens_auto_service_status
```

唯一键：

```text
device_id + transport + port
```

记录：

- 对应 Service ID
- TCP/UDP
- 端口
- 当前在线状态
- 扫描识别出的服务名
- 首次发现时间
- 最近检查时间
- 最近开放时间

核心行为：

1. 新开放端口第一次发现时自动建立 Service。
2. 优先复用同设备同端口已有的人工 Service，避免重复条目。
3. 一旦映射到已有 Service，后续只维护端口状态，不覆盖用户编辑字段。
4. 根据 nmap service name / 常见端口推断 SSH、HTTP、HTTPS、RDP、SMB、MySQL、Redis 等类型。
5. Web 服务自动生成 URL。
6. TCP / UDP 分开记录。
7. 产生 `port_opened`、`port_offline` 通知。
8. 对明确扫描范围才执行离线判定，避免 `top:N` 未覆盖端口产生误报。

### `enhancements/runtime/auto_services_api.py`

增加：

```text
GET /api/services/auto-status
```

供前端读取自动发现 Service 的端口在线状态。

接口仍要求 LanLens 登录认证。

### `enhancements/runtime/patch_runtime.py`

构建镜像时对 v1.5.9 代码做最小化注入：

#### `backend/main.py`

注册 `auto_services_api` Router。

#### `backend/routers/devices.py`

在端口扫描完成后调用：

```python
sync_scan_result(...)
```

分别覆盖：

- 完整/范围端口扫描
- 单端口扫描

同时设备详情返回 Services 时按端口排序。

#### `backend/routers/services.py`

调整 Services API 排序：

- 单设备：端口 → TCP/UDP → 名称
- 全局：数值 IP → 端口 → TCP/UDP → 名称

#### `frontend/dist/index.html`

加载：

```text
/lanlens-auto-services-ui-v5.js
```

### `enhancements/runtime/lanlens-auto-services-ui-v5.js`

前端增强层主要做三件事：

1. Service 卡片显示在线/离线状态。
2. 全局 Services 页面把设备入口显示为 `IP:Port`。
3. 中文模式下翻译后端生成的英文通知正文，并为端口发现/端口离线使用不同颜色标签。

## Docker 结构调整

上游源码完整保留在 `upstream/` Git submodule，并固定到 LanLens v1.5.9 对应 commit。

新增：

```text
Dockerfile.enhanced
```

它直接使用 `upstream/` 中的 **LanLens v1.5.9 源代码**完成前端和后端构建，然后再注入增强层，不依赖运行时下载源码。

`docker-compose.yml` 默认使用：

```yaml
dockerfile: Dockerfile.enhanced
```

并继续使用 host network 与 `NET_ADMIN` / `NET_RAW` 权限，以保持 LanLens 网络扫描能力。

## 为什么使用独立增强层

没有直接大面积重写上游文件，主要是为了：

- 上游源码保持清晰可对照
- 以后升级 LanLens 时更容易判断冲突点
- 自定义逻辑集中在 `enhancements/runtime`
- 数据库改动只增加自己的表
- 发生问题时可以快速回退到原版 LanLens

## 已知兼容边界

`patch_runtime.py` 按 LanLens **v1.5.9** 的具体源码结构匹配并注入代码。

因此如果未来升级到其它 LanLens 版本，应先检查：

- `backend/main.py`
- `backend/routers/devices.py`
- `backend/routers/services.py`
- 前端构建产物结构

不要直接假定该 Patch 可以无修改跨版本使用。
