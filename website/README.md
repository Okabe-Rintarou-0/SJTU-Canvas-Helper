# SJTU Canvas Helper — 官网

## 本地开发

```bash
yarn dev
```

## 构建

```bash
yarn build
```

## 部署

本项目使用 GitHub Actions 自动部署到 GitHub Pages。

**触发方式：**
- 推送 `website/**` 或 `.github/workflows/deploy-website.yml` 到 `main` 或 `release` 分支
- 或手动在 GitHub Actions 页面触发 `Deploy Website` workflow

**部署地址：** `https://okabe-rintarou-0.github.io/SJTU-Canvas-Helper/`

由于 GitHub Pages 在大陆地区偶尔可能不稳定，你也可以选择部署到其他平台：

### Vercel（推荐，国内速度快）

1. 在 [vercel.com](https://vercel.com) 导入该仓库
2. 设置：
   - **Framework**: Vite
   - **Root Directory**: `website`
   - **Build Command**: `yarn build`
   - **Output Directory**: `dist`

### Cloudflare Pages（国内速度快）

1. 在 [pages.cloudflare.com](https://pages.cloudflare.com) 连接该仓库
2. 设置：
   - **Framework**: Vite
   - **Root Directory**: `website`
   - **Build Command**: `yarn build`
   - **Output Directory**: `dist`
