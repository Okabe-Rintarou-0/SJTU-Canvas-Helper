# 贡献指南

感谢您对 SJTU Canvas Helper 的兴趣！以下是一些参与开发的指引。

## 开发环境

请先参考 [README.md](./README.md#开发指南) 完成 Rust 和 Node.js 环境安装。

## 本地开发

```shell
# 安装依赖
yarn install

# 启动 Tauri 开发模式
yarn tauri dev

# 或者通过 make
make dev
```

## 代码规范

### 前端

项目使用 TypeScript 严格模式，并配置了 ESLint：

```shell
# 检查代码
yarn lint

# 自动修复
yarn lint:fix

# 类型检查
yarn typecheck
```

### 后端 (Rust)

```shell
# 使用 make
make lint
make test

# 或直接
cd src-tauri && cargo clippy --workspace --all-targets --all-features
cd src-tauri && cargo test
```

## 提交代码

项目使用 [Husky](https://typicode.github.io/husky/) + [lint-staged](https://github.com/lint-staged/lint-staged) 在提交前自动检查并修复暂存代码。

**Commit Message 格式**：请保持简洁，使用英文或中文均可。

## 版本升级

```shell
make version <new_version>
# 例如：make version 3.1.0
```

这会自动更新 `package.json`、`Cargo.toml`、`tauri.conf.json`、`website/` 中的版本号。

## Pull Request

1. 确保代码通过 lint 和类型检查
2. 如果涉及新功能，请尽量补充说明
3. PR 将自动触发 CI 运行 Rust 测试和 lint
