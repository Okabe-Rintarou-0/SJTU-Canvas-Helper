# SJTU Canvas Helper - Android

这是 SJTU Canvas Helper 的 Android 版本，使用 Material You 设计系统 (Material 3) 和 Kotlin 开发。

## 功能特性

- ✅ **Material You 设计**: 采用最新的 Material 3 设计系统，支持动态主题色
- ✅ **自适应布局**: 针对手机和平板优化，平板使用 NavigationRail，手机使用 BottomNavigationBar
- ✅ **登录功能**: 使用 Canvas Token 进行身份验证
- ✅ **课程展示**: 以卡片形式展示课程列表
- ✅ **作业上传**: 支持选择文件并上传作业
- ✅ **视频播放**: 集成 ExoPlayer 播放课程视频
- ✅ **设置页面**: 管理账户、主题等设置

## 技术栈

- **语言**: Kotlin
- **UI框架**: Jetpack Compose
- **架构**: MVVM + Repository Pattern
- **依赖注入**: Hilt/Dagger
- **网络请求**: Retrofit + OkHttp
- **视频播放**: ExoPlayer (Media3)
- **异步处理**: Kotlin Coroutines
- **数据存储**: DataStore

## 项目结构

```
android/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── java/com/sjtu/canvas/helper/
│   │       │   ├── data/              # 数据层
│   │       │   │   ├── api/          # API接口定义
│   │       │   │   ├── model/        # 数据模型
│   │       │   │   └── repository/   # 仓库层
│   │       │   ├── di/               # 依赖注入模块
│   │       │   ├── ui/               # UI层
│   │       │   │   ├── navigation/   # 导航定义
│   │       │   │   ├── screens/      # 各个页面
│   │       │   │   └── theme/        # Material主题
│   │       │   ├── util/             # 工具类
│   │       │   ├── CanvasHelperApplication.kt
│   │       │   └── MainActivity.kt
│   │       ├── res/                  # 资源文件
│   │       └── AndroidManifest.xml
│   └── build.gradle.kts
├── build.gradle.kts
├── settings.gradle.kts
└── README.md
```

## 构建要求

- Android Studio Hedgehog (2023.1.1) 或更高版本
- JDK 17
- Android SDK 34
- Kotlin 1.9.20
- Gradle 8.2

## 构建步骤

1. 克隆仓库
```bash
git clone https://github.com/xeonliu/SJTU-Canvas-Helper.git
cd SJTU-Canvas-Helper/android
```

2. 在 Android Studio 中打开项目

3. 等待 Gradle 同步完成

4. 运行应用
   - 连接 Android 设备或启动模拟器
   - 点击运行按钮或使用快捷键 `Shift + F10`

## 配置

在使用应用前，需要配置 Canvas Token:

1. 登录 SJTU Canvas (https://oc.sjtu.edu.cn)
2. 进入 Account → Settings → Approved Integrations → New Access Token
3. 生成 Token 并复制
4. 在应用登录页面输入 Token

## 主要功能说明

### 登录
- 使用 Canvas Token 进行身份验证
- Token 安全存储在 DataStore 中

### 课程列表
- 展示所有激活的课程
- 以时间线卡片形式呈现
- 点击课程卡片进入详情

### 作业管理
- 查看所有作业及截止时间
- 上传文件提交作业
- 查看作业状态

### 视频播放
- 播放课程录播视频
- 支持播放控制
- 视频列表浏览

### 设置
- 修改 Canvas Token
- 切换主题（浅色/深色/跟随系统）
- 账户管理

## 适配说明

### 手机端
- 使用 BottomNavigationBar 进行导航
- 单列布局展示内容
- 优化触摸目标大小

### 平板端
- 使用 NavigationRail 侧边栏导航
- 双列或多列布局
- 充分利用大屏幕空间

## 注意事项

- 应用需要网络权限访问 Canvas API
- 上传文件需要存储权限（Android 13+使用媒体权限）
- Token 会安全存储在设备上，卸载应用后会清除

## 后续开发计划

- [ ] 添加文件下载功能
- [ ] 实现日历视图
- [ ] 支持消息通知
- [ ] 离线缓存功能
- [ ] 更多课程资源类型支持
- [ ] 单元测试和集成测试

## 开源协议

本项目采用 MIT 协议开源
