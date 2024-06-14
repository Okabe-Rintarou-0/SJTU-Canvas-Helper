# SJTU Canvas Helper

![](./images/logo.png)

**还在为下载一堆学生上传的压缩包而苦恼吗？**

SJTU Canvas 小帮手，帮助您更便捷地使用交大 Canvas。基于 [Tauri](https://tauri.app/) 开发。
参与讨论：[水源社区](https://shuiyuan.sjtu.edu.cn/t/topic/245275)。

![](images/arch.png)

<div align="center">
  <img align="center" src="https://img.shields.io/badge/rust-1.75-blue" alt="">
  <img align="center" src="https://img.shields.io/github/stars/Okabe-Rintarou-0/SJTU-Canvas-Helper" /> 
  <img align="center" src="https://img.shields.io/github/v/release/Okabe-Rintarou-0/SJTU-Canvas-Helper?include_prereleases" /> 
  <img align="center" src="https://img.shields.io/github/downloads/Okabe-Rintarou-0/SJTU-Canvas-Helper/total" />
</div>

## 安装指南

您只需要前往 [Release](https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/releases) 正确安装一次即可，后续如果主版本更新，您可以自动拉取更新，无需重复下载安装。

如果您使用的是 Windows 系统，建议下载 `.msi` 安装包，以支持自动更新功能。

![](./images/installation.png)

您还可以使用免安装便携版：SJTU.Canvas.Helper_v_x.x.x_x64_portable.zip(Windows 用户)。

在您安装完毕后，请前往设置页面填写您的 `Canvas Token` 以及您的文件下载保存目录。

![](./images/settings.png)

MacOS 遇到打不开的问题，请看：[在 Mac 上安全地打开 App](https://support.apple.com/zh-cn/102445)。如果显示已损坏，请尝试执行以下命令：
```shell
cd /Applications 
sudo xattr -r -d com.apple.quarantine /Applications/SJTU\ Canvas\ Helper.app SJTU\ Canvas\ Helper.app
```

## 致谢

感谢以下用户为本仓库做出的贡献：

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/creeper12356" style="display:inline-block;width:80px">
        <img src="https://github.com/creeper12356.png" width="64px;" alt="creeper12356"/><br/>
        <sub><b>creeper12356</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/pangbo13" style="display:inline-block;width:80px">
        <img src="https://github.com/pangbo13.png" width="64px;" alt="pangbo13"/><br/>
        <sub><b>pangbo13</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/wytili" style="display:inline-block;width:80px">
        <img src="https://github.com/wytili.png" width="64px;" alt="wytili"/><br/>
        <sub><b>wytili</b></sub>
      </a>
    </td>
  </tr>
</table>

## Main Features
+ [x] 文件下载 / 预览(免下载) / PDF & PPTX 混合合并(免下载)
+ [x] 一键上传[交大云盘（新）](https://pan.sjtu.edu.cn/)
+ [x] DDL 日历 
+ [x] 人员名单导出
+ [x] 查看/提交作业
+ [x] 批改作业/修改作业 DDL
+ [x] 视频下载/播放
+ [x] 自动更新 

### 文件下载/预览

类似 macOS quick look，按下空格打开预览，再次按下空格关闭预览。

https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/assets/58595459/7f05cabc-7bf9-4f58-91ea-f3efed151733

**支持预览主流压缩文件（7z, zip, rar...）**

![](./images/file.png)

### 文件一键上传交大云盘

![](./images/jbox.png)

### 课程录屏播放/下载

![](./images/video.png)

### 查看课程作业

![](./images/assignment.png)

### 学生提交作业查看/批改/修改 DDL
  
输入合法的分数，然后按下回车；如果想撤回分数，则清空输入框，再次按下回车。

![](./images/submission.png)

## 开发指南

+ 下载 [Rust](https://www.rust-lang.org/tools/install)。Rust 快速学习：[Rust语言圣经(Rust Course)](https://course.rs/about-book.html)。
+ 下载 [NodeJS](https://nodejs.org/en/download/current)，自带 `npm` 和 `yarn` 包管理器。
+ 启动项目：
  ```shell
  yarn tauri dev
  ```
+ Tauri 使用的是 Chrome 内核，所以你可以把它当成一个浏览器来 debug。MacOS 可以按下 `⌘command + ⌥option + i` 查看控制台；Windows 则为 `ctrl + shift + i `。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Okabe-Rintarou-0/SJTU-Canvas-Helper&type=Date)](https://star-history.com/#Okabe-Rintarou-0/SJTU-Canvas-Helper&Date)
