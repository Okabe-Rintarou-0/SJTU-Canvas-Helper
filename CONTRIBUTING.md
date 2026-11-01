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

发布前，请在 `src/lib/change_logs.json` 顶部添加对应版本的更新内容（`version`、`date`、`items`），并保留已有条目。此文件同时用于应用内更新日志和更新后的成功提示；后者会展示上次运行版本之后、当前版本及之前的累计内容。

`items` 支持行内 Markdown：`**重点文字**` 加粗、`*斜体*`、行内代码（反引号包裹）、`[链接文字](https://example.com)` 和 Markdown 换行（行尾两个空格后换行，在 JSON 中用 `\n` 表示换行）。例如 `"**视频中心全面升级**：支持多小节播放、导出与 AI 总结。"`。两处日志使用相同的格式化显示，HTML 和图片不会渲染。

更新内容随应用一起打包，无需修改更新清单或发布流程。应用在本机记录上次运行的版本，仅在版本升高后的首次启动展示成功提示；首次安装或没有版本记录时只建立基线，同版本重启或降级不会误报更新成功。旧版没有保存此记录，因此首次升级到支持此功能的版本时也只建立基线。找不到当前版本日志时，提示会提供发布说明链接。

## Pull Request

1. 确保代码通过 lint 和类型检查
2. 如果涉及新功能，请尽量补充说明
3. PR 将自动触发 CI 运行 Rust 测试和 lint
