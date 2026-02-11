# 贡献指南 - Android 版本

感谢您对 SJTU Canvas Helper Android 版本的贡献！

## 开发环境设置

### 必需工具
1. **Android Studio**: Hedgehog (2023.1.1) 或更高版本
2. **JDK**: 版本 17
3. **Android SDK**: API Level 34
4. **Kotlin**: 1.9.20

### 首次设置步骤

1. 克隆仓库
```bash
git clone https://github.com/xeonliu/SJTU-Canvas-Helper.git
cd SJTU-Canvas-Helper/android
```

2. 打开 Android Studio
   - File → Open
   - 选择 `android` 目录
   - 等待 Gradle 同步完成

3. 配置 SDK
   - Tools → SDK Manager
   - 确保安装了 Android 14.0 (API 34)

## 代码规范

### Kotlin 编码风格
- 遵循 [Kotlin 官方编码规范](https://kotlinlang.org/docs/coding-conventions.html)
- 使用 4 空格缩进
- 最大行长度：120 字符
- 使用有意义的变量和函数名

### Jetpack Compose 最佳实践
- 使用 `remember` 和 `rememberSaveable` 管理状态
- 遵循单向数据流原则
- 保持 Composable 函数小而专注
- 使用 `LaunchedEffect` 处理副作用

### 架构规范
- **MVVM 模式**: ViewModel 处理业务逻辑，View 负责 UI
- **Repository 模式**: 数据层抽象
- **单一职责原则**: 每个类只负责一件事

## 提交规范

### Commit Message 格式
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type 类型**:
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具相关

**示例**:
```
feat(login): 添加生物识别登录支持

- 集成 BiometricPrompt API
- 添加设置选项
- 更新安全文档

Closes #123
```

## Pull Request 流程

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### PR 检查清单
- [ ] 代码遵循项目规范
- [ ] 添加了必要的注释
- [ ] 更新了相关文档
- [ ] 通过了所有测试
- [ ] 没有引入新的警告
- [ ] UI 在手机和平板上都能正常显示

## 测试

### 运行测试
```bash
./gradlew test
```

### UI 测试
```bash
./gradlew connectedAndroidTest
```

### 代码覆盖率
```bash
./gradlew jacocoTestReport
```

## 构建

### Debug 版本
```bash
./gradlew assembleDebug
```

### Release 版本
```bash
./gradlew assembleRelease
```

## 常见问题

### Gradle 同步失败
1. 检查网络连接
2. 清理项目: Build → Clean Project
3. 刷新依赖: File → Invalidate Caches / Restart

### 编译错误
1. 确保使用正确的 JDK 版本
2. 检查 Kotlin 插件版本
3. 删除 `.gradle` 目录并重新同步

## 获取帮助

- 查看 [Android README](README.md)
- 提交 Issue
- 加入讨论: [水源社区](https://shuiyuan.sjtu.edu.cn/t/topic/245275)

## 许可证

本项目采用 MIT 许可证。详见 [LICENSE](../LICENSE) 文件。
