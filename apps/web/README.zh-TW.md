# FlakeGuard 網頁儀表板

一個現代化、生產級的網頁儀表板，用於監控和管理儲存庫中的不穩定測試檢測。

## 🚀 功能特色

### 核心儀表板
- **儲存庫健康監控**：儲存庫健康狀態的視覺化指示器（優秀、良好、警告、危急）
- **不穩定測試檢測**：即時監控不穩定測試，提供信心分數和建議
- **失敗群組分析**：測試失敗模式的分組和視覺化
- **最近動作時間軸**：追蹤隔離決定、議題建立和測試重新執行

### 深度整合
- **GitHub 整合**：直接連結到 PR、檢查執行和儲存庫頁面
- **Slack 整合**：連結到討論串和通知
- **身份驗證**：GitHub OAuth 安全存取
- **國際化**：完整支援英文和繁體中文

### 現代化架構
- **Next.js 14**：最新的 App Router 和 React 伺服器組件
- **TypeScript**：完整類型安全，啟用嚴格模式
- **Tailwind CSS**：現代化、響應式設計系統
- **TanStack Query**：優化的数據取得，具備緩存和背景更新
- **即時更新**：自動數據刷新和即時通知

## 🛠️ 技術堆疊

- **框架**：Next.js 14 和 App Router
- **程式語言**：TypeScript 5.3+
- **樣式**：Tailwind CSS 和自定義設計系統
- **狀態管理**：TanStack Query (React Query)
- **身份驗證**：NextAuth.js 和 GitHub 提供者
- **國際化**：next-intl
- **UI 組件**：基於 Radix UI 模式的自定義組件庫
- **構建工具**：ESLint、Prettier、PostCSS
- **包管理器**：pnpm（工作區支援）

## 📚 快速開始

### 前置條件

- Node.js 20+
- pnpm 8+
- FlakeGuard API 運行中（參考 `../api`）

### 安裝

```bash
# 安裝依賴
pnpm install

# 複製環境配置
cp .env.example .env.local

# 配置環境變數
edit .env.local
```

### 環境配置

```bash
# API 配置
FLAKEGUARD_API_URL=http://localhost:3000

# NextAuth 配置
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=您的-nextauth-密鑰

# GitHub OAuth
GITHUB_CLIENT_ID=您的-github-oauth-客戶端編號
GITHUB_CLIENT_SECRET=您的-github-oauth-客戶端密鑰
```

### 開發

```bash
# 啟動開發伺服器
pnpm dev

# 執行類型檢查
pnpm typecheck

# 執行程式碼檢查
pnpm lint

# 執行測試
pnpm test
```

應用程式將在 `http://localhost:3001` 可用。

## 🎨 功能概述

### 儀表板
- 儲存庫健康概覽和視覺化指示器
- 主要不穩定測試和可執行建議
- 最近動作時間軸和深度連結
- 系統統計和趋勢

### 儲存庫管理
- 可搜尋的儲存庫清單和分頁
- 個別儲存庫詳情頁面
- 健康指標和不穩定性評分
- 測試歷史和失敗模式

### 動作追蹤
- FlakeGuard 所有動作的完整稽核記錄
- 按動作類型和狀態篩選
- 直接連結到 GitHub PR 和 Slack 串
- 即時狀態更新

### 國際化
- 完整的英文和繁體中文支援
- 語言切換並保留 URL
- 本地化日期/時間格式
- 針對臺灣用戶的文化適配

## 🚀 生產部署

### Docker

```bash
# 構建 Docker 鏡像
docker build -t flakeguard-web .

# 運行容器
docker run -p 3001:3001 \
  -e FLAKEGUARD_API_URL=https://api.flakeguard.com \
  -e NEXTAUTH_URL=https://dashboard.flakeguard.com \
  -e NEXTAUTH_SECRET=您的-生產-密鑰 \
  -e GITHUB_CLIENT_ID=您的-github-客戶端-id \
  -e GITHUB_CLIENT_SECRET=您的-github-客戶端-密鑰 \
  flakeguard-web
```

### GitHub OAuth 設定

1. 前往 GitHub 設定 > 開發者設定 > OAuth 應用
2. 建立新的 OAuth 應用：
   - **應用名稱**：FlakeGuard 儀表板
   - **主頁 URL**：`https://your-domain.com`
   - **授權回調 URL**：`https://your-domain.com/api/auth/callback/github`
3. 將客戶端 ID 和客戶端密鑰複製到環境變數

## 📁 專案結構

```
src/
├── app/                    # Next.js App Router
│   ├── [locale]/          # 國際化路由
│   │   ├── (dashboard)/   # 儀表板布局組
│   │   └── auth/          # 身份驗證頁面
│   └── api/               # API 路由
├── components/            # React 組件
│   ├── ui/               # 基本 UI 組件
│   ├── layout/           # 布局組件
│   ├── dashboard/        # 儀表板專用組件
│   └── auth/             # 身份驗證組件
├── hooks/                # 自定義 React hooks
├── lib/                  # 工具庫
└── types/                # TypeScript 類型定義
messages/                 # 國際化訊息
├── en.json              # 英文翻譯
└── zh-TW.json           # 繁體中文翻譯
```

## 🔒 安全性

- **身份驗證**：安全的 GitHub OAuth 流程
- **授權**：基於作業階段的存取控制
- **CSRF 保護**：內置 NextAuth.js 保護
- **XSS 防護**：React 內置清理
- **內容安全策略**：為生產配置

## 🤝 貢獻

1. **程式碼風格**：遵循 ESLint 和 Prettier 配置
2. **TypeScript**：維持嚴格類型安全
3. **測試**：為新組件和 hooks 編寫測試
4. **無障礙**：確保 WCAG 2.1 AA 符合性
5. **國際化**：為新字串新增翻譯

### 開發命令

```bash
# 開發
pnpm dev              # 啟動開發伺服器
pnpm build            # 為生產構建
pnpm start            # 啟動生產伺服器
pnpm lint             # 執行 ESLint
pnpm lint:fix         # 修復 ESLint 問題
pnpm typecheck        # 執行 TypeScript 檢查
pnpm test             # 執行測試套件
pnpm test:coverage    # 執行測試並帶有覆蓋率
```

## 📝 授權

此專案是 FlakeGuard monorepo 的一部分。請參閱根目錄的 LICENSE 檔案以獲取詳細信息。

---

**FlakeGuard 網頁儀表板** - 生產級不穩定測試監控和管理。
