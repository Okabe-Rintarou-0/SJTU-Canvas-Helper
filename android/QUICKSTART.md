# 快速开始 - SJTU Canvas Helper Android

5 分钟快速上手指南

## 前置要求

✅ Android Studio Hedgehog (2023.1.1) 或更高版本  
✅ JDK 17  
✅ Android SDK 34  

## 步骤 1: 克隆项目

```bash
git clone https://github.com/xeonliu/SJTU-Canvas-Helper.git
cd SJTU-Canvas-Helper/android
```

## 步骤 2: 打开项目

1. 启动 Android Studio
2. 选择 **File → Open**
3. 导航到 `SJTU-Canvas-Helper/android` 目录
4. 点击 **OK**
5. 等待 Gradle 同步完成（首次可能需要几分钟）

## 步骤 3: 配置 SDK

确保已安装 Android SDK 34:

1. **Tools → SDK Manager**
2. 在 **SDK Platforms** 标签页，勾选 **Android 14.0 (API 34)**
3. 点击 **Apply** 并等待下载完成

## 步骤 4: 运行应用

### 使用模拟器

1. **Tools → Device Manager**
2. 点击 **Create Device**
3. 选择设备（推荐 Pixel 5 或 Pixel Tablet）
4. 选择系统镜像：**Android 14 (API 34)**
5. 点击 **Finish**
6. 启动模拟器
7. 点击运行按钮 ▶️ 或按 `Shift + F10`

### 使用真机

1. 在手机上启用开发者选项：
   - 设置 → 关于手机
   - 连续点击"版本号" 7 次
2. 启用 USB 调试：
   - 设置 → 系统 → 开发者选项
   - 开启"USB 调试"
3. 用 USB 连接电脑
4. 授权调试
5. 在 Android Studio 中选择设备
6. 点击运行 ▶️

## 步骤 5: 获取 Canvas Token

1. 浏览器访问 https://oc.sjtu.edu.cn
2. 登录你的账户
3. 点击左侧菜单 **Account → Settings**
4. 滚动到 **Approved Integrations**
5. 点击 **+ New Access Token**
6. 输入用途（如 "Mobile App"）
7. 点击 **Generate Token**
8. **复制** token（只显示一次！）

## 步骤 6: 在应用中登录

1. 应用启动后会显示登录界面
2. 粘贴刚才复制的 Canvas Token
3. 点击 **登录**
4. 成功！开始使用

## 常见问题

### Q: Gradle 同步失败

**A**: 尝试以下步骤：
```bash
# 1. 清理项目
./gradlew clean

# 2. 或在 Android Studio 中
Build → Clean Project
Build → Rebuild Project
```

### Q: 编译错误 "Cannot find symbol"

**A**: 确保使用 JDK 17:
```bash
File → Project Structure → SDK Location
检查 JDK location 指向 JDK 17
```

### Q: 应用闪退

**A**: 查看 Logcat:
```
View → Tool Windows → Logcat
筛选 "AndroidRuntime"
```

### Q: 网络请求失败

**A**: 检查：
1. 设备/模拟器有网络连接
2. Token 是否正确
3. Canvas 服务是否可访问

## 测试功能

### 登录
- [x] 输入 Canvas Token
- [x] 点击登录按钮
- [x] 验证跳转到课程列表

### 浏览课程
- [x] 查看课程卡片
- [x] 点击课程进入详情

### 作业管理
- [x] 查看作业列表
- [x] 点击上传按钮
- [x] 选择文件

### 设置
- [x] 修改主题
- [x] 更新 Token
- [x] 退出登录

## 调试技巧

### 查看网络请求

在 Logcat 中过滤 "OkHttp":
```
Tag: OkHttp
```

### 检查 Compose 布局

使用 Layout Inspector:
```
Tools → Layout Inspector
```

### 性能分析

使用 Android Profiler:
```
View → Tool Windows → Profiler
```

## 下一步

- 📖 阅读 [完整 README](README.md)
- 🏗️ 了解 [架构设计](ARCHITECTURE.md)
- 🤝 查看 [贡献指南](CONTRIBUTING.md)
- 💬 加入 [水源社区讨论](https://shuiyuan.sjtu.edu.cn/t/topic/245275)

## 构建 Release 版本

```bash
# 生成 Release APK
./gradlew assembleRelease

# APK 位置
app/build/outputs/apk/release/app-release.apk
```

**注意**: Release 版本需要配置签名密钥。

## 需要帮助？

- 🐛 提交 Issue: [GitHub Issues](https://github.com/xeonliu/SJTU-Canvas-Helper/issues)
- 💬 讨论区: [水源社区](https://shuiyuan.sjtu.edu.cn/t/topic/245275)
- 📧 联系维护者

---

**祝你使用愉快！** 🎉
