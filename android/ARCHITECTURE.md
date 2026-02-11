# SJTU Canvas Helper Android - 架构文档

## 架构概览

本项目采用现代化的 Android 应用架构，遵循 Google 推荐的最佳实践。

```
┌─────────────────────────────────────────────────────────┐
│                     UI Layer (Compose)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  Login   │  │ Courses  │  │Assignment│  │Settings │ │
│  │  Screen  │  │  Screen  │  │  Screen  │  │ Screen  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
├───────┼─────────────┼──────────────┼──────────────┼─────┤
│       │             │              │              │      │
│  ┌────▼─────────────▼──────────────▼──────────────▼───┐ │
│  │              ViewModels (MVVM)                      │ │
│  │  - CoursesViewModel                                 │ │
│  │  - AssignmentsViewModel                             │ │
│  │  - State Management with StateFlow                  │ │
│  └────────────────────┬────────────────────────────────┘ │
├────────────────────────┼─────────────────────────────────┤
│                        │                                  │
│  ┌────────────────────▼────────────────────────────────┐ │
│  │            Repository Layer                          │ │
│  │  - CanvasRepository                                  │ │
│  │  - Data abstraction and caching                      │ │
│  └────────────────────┬────────────────────────────────┘ │
├────────────────────────┼─────────────────────────────────┤
│                        │                                  │
│  ┌────────────────────▼────────────────────────────────┐ │
│  │              Data Sources                            │ │
│  │  ┌──────────────┐        ┌──────────────┐           │ │
│  │  │ Remote (API) │        │Local (Cache) │           │ │
│  │  │  - Retrofit  │        │  - DataStore │           │ │
│  │  │  - OkHttp    │        │              │           │ │
│  │  └──────────────┘        └──────────────┘           │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 层级说明

### 1. UI Layer (Jetpack Compose)

**职责**: 显示数据和处理用户交互

**组件**:
- **Screens**: 完整的页面组件
  - `LoginScreen`: 用户登录界面
  - `CoursesScreen`: 课程列表展示
  - `AssignmentsScreen`: 作业管理
  - `VideosScreen`: 视频播放
  - `SettingsScreen`: 设置管理

- **UI 组件**:
  - Material 3 组件（Card, Button, TextField 等）
  - 自适应导航（NavigationRail/BottomNavigation）
  - 自定义 Composables

**特点**:
- 声明式 UI
- 状态提升
- 单向数据流

### 2. ViewModel Layer

**职责**: 处理业务逻辑和管理 UI 状态

**组件**:
- `CoursesViewModel`: 管理课程数据和状态
- `AssignmentsViewModel`: 处理作业相关逻辑
- 使用 StateFlow 暴露状态

**状态管理示例**:
```kotlin
sealed class CoursesUiState {
    object Loading : CoursesUiState()
    data class Success(val courses: List<Course>) : CoursesUiState()
    data class Error(val message: String) : CoursesUiState()
}
```

**生命周期**:
- ViewModel 存活于配置变更（如屏幕旋转）
- 自动清理资源

### 3. Repository Layer

**职责**: 统一数据访问接口，协调多个数据源

**组件**:
- `CanvasRepository`: Canvas API 数据访问
- 错误处理和重试逻辑
- 数据转换和映射

**优势**:
- 单一数据源真相（Single Source of Truth）
- 离线支持（可扩展）
- 易于测试

### 4. Data Sources

#### Remote Data Source (网络)
- **Retrofit**: HTTP 客户端
- **OkHttp**: 网络层实现
- **Interceptors**: 认证、日志等

#### Local Data Source (本地)
- **DataStore**: 轻量级数据存储
- **SharedPreferences**: 配置管理
- 可扩展：Room 数据库用于缓存

## 依赖注入 (Hilt/Dagger)

使用 Hilt 进行依赖注入，提供松耦合和可测试性。

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun provideCanvasApi(): CanvasApi { ... }
    
    @Provides
    @Singleton
    fun provideRepository(api: CanvasApi): CanvasRepository { ... }
}
```

## Material You 设计

### 动态颜色
- Android 12+ 支持从壁纸提取颜色
- 自动适应亮暗主题
- 完整的 Material 3 调色板

### 自适应布局

**手机 (< 600dp)**:
```
┌──────────────┐
│   TopBar     │
├──────────────┤
│              │
│   Content    │
│              │
├──────────────┤
│BottomNavBar  │
└──────────────┘
```

**平板 (≥ 600dp)**:
```
┌────┬─────────────┐
│Nav │   TopBar    │
│Rail├─────────────┤
│    │             │
│    │   Content   │
│    │             │
└────┴─────────────┘
```

## 数据流

### 获取课程列表流程
```
1. User Action (Tap Refresh)
        ↓
2. Screen triggers ViewModel
        ↓
3. ViewModel calls Repository
        ↓
4. Repository fetches from API
        ↓
5. Response transformed to Model
        ↓
6. State updated (StateFlow)
        ↓
7. UI recomposes automatically
```

### 上传作业流程
```
1. User selects file
        ↓
2. ViewModel validates file
        ↓
3. Show upload progress
        ↓
4. Repository uploads via API
        ↓
5. Update UI with result
```

## 安全性

### Token 管理
- 使用 DataStore 加密存储
- 不在日志中暴露
- HTTPS 加密传输

### 网络安全
- 强制 HTTPS
- Certificate pinning（可选）
- 网络安全配置

## 性能优化

### Compose 优化
- 使用 `remember` 避免重组
- `LazyColumn` 虚拟化长列表
- `derivedStateOf` 减少计算

### 网络优化
- OkHttp 连接池
- 响应缓存
- 请求去重

### 内存优化
- 图片加载使用 Coil
- ViewModel 作用域管理
- 避免内存泄漏

## 测试策略

### 单元测试
- ViewModel 逻辑测试
- Repository 数据转换测试
- 工具类函数测试

### UI 测试
- Compose UI 测试
- 用户流程测试
- 截图测试

### 集成测试
- API 集成测试
- 端到端流程测试

## 扩展性

### 添加新功能
1. 在 `data/model` 添加数据模型
2. 在 `data/api` 定义 API 接口
3. 在 `data/repository` 实现仓库方法
4. 创建对应的 ViewModel
5. 实现 Compose UI Screen
6. 添加到导航图

### 添加新的数据源
1. 创建新的 data source 接口
2. 在 Repository 中整合
3. 更新依赖注入模块

## 最佳实践

### 代码组织
- 按功能分包，不按层级
- 保持文件小而专注
- 使用有意义的命名

### 状态管理
- 单向数据流
- 不可变状态对象
- 状态提升到合适的层级

### 错误处理
- 使用 Result 类型
- 友好的错误提示
- 日志记录

### 异步处理
- Kotlin Coroutines
- 正确的调度器使用
- 异常处理

## 工具和资源

- **Android Studio**: 官方 IDE
- **Material Theme Builder**: 主题设计工具
- **Layout Inspector**: UI 调试
- **Profiler**: 性能分析

## 参考资料

- [Android 应用架构指南](https://developer.android.com/topic/architecture)
- [Jetpack Compose 文档](https://developer.android.com/jetpack/compose)
- [Material Design 3](https://m3.material.io/)
- [Kotlin 协程指南](https://kotlinlang.org/docs/coroutines-guide.html)
