# Upstream

本项目基于：

- Repository: `AlexRosbach/LanLens`
- Tag: `v1.5.9`
- Commit: `b8fa87166ed39ff6f35305fbca6dec6ead7eda20`

上游完整源码以 Git submodule 的方式保存在 `upstream/`，并固定到上述 commit。

初始化：

```bash
git submodule update --init --recursive
```

这样可以同时做到：

1. 完整保留 LanLens 原始源码；
2. 不直接污染上游代码；
3. 自定义增强集中维护在 `enhancements/runtime/`；
4. 后续升级时可以清楚比较 upstream 版本差异。
