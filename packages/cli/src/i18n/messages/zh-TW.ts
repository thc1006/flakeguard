import { I18nMessages } from '../../types/index.js';

export const chineseMessages: I18nMessages = {
  welcome: {
    title: '歡迎使用 FlakeGuard 設置精靈！',
    description: '這個互動式精靈將引導您設置 FlakeGuard，\n一個全面的測試不穩定性檢測和管理系統。\n\n我們將幫助您配置：',
    confirmProceed: '準備開始設置嗎？'
  },

  common: {
    dryRunMode: '運行在試運行模式 - 不會進行任何更改',
    cancelled: '用戶取消設置',
    yes: '是',
    no: '否',
    continue: '繼續',
    skip: '跳過',
    back: '返回',
    next: '下一步',
    done: '完成',
    error: '錯誤',
    warning: '警告',
    info: '資訊'
  },

  validation: {
    checking: '驗證系統先決條件...',
    completed: '先決條件驗證完成',
    failed: '先決條件驗證失敗',
    skipped: '驗證已跳過',
    results: '驗證結果',
    criticalFailures: '檢測到關鍵驗證失敗',
    continueAnyway: '仍要繼續設置？（不建議）',
    aborted: '因驗證失敗而中止設置',
    invalidPort: '端口必須在 1024 到 65535 之間',
    
    node: {
      valid: 'Node.js {{version}} - 正常',
      invalid: '找到 Node.js {{current}}，需要 {{required}}',
      error: '檢查 Node.js 版本失敗',
      suggestion1: '從 https://nodejs.org 安裝 Node.js 20 或更高版本',
      suggestion2: '使用 Node.js 版本管理器如 nvm'
    },
    
    packageManager: {
      pnpm: 'pnpm {{version}} - 正常（推薦）',
      npm: 'npm {{version}} - 正常',
      notFound: '未找到合適的包管理器',
      error: '檢查包管理器失敗',
      pnpmRecommended: '建議安裝 pnpm 以獲得更好的性能',
      installPnpm: '安裝 pnpm：npm install -g pnpm',
      installNpm: '更新 npm：npm install -g npm@latest'
    },
    
    docker: {
      valid: 'Docker {{dockerVersion}} + Compose {{composeVersion}} - 正常',
      missingCompose: '找到 Docker 但缺少 Docker Compose',
      notFound: '未找到 Docker 或 Docker 未運行',
      error: '檢查 Docker 失敗',
      installDocker: '從 https://docker.com 安裝 Docker Desktop',
      installCompose: '安裝 Docker Compose 插件',
      startDocker: '啟動 Docker Desktop 服務'
    },
    
    system: {
      gitOk: 'Git - 正常',
      gitMissing: 'Git - 缺失',
      httpClientOk: 'HTTP 客戶端（curl/wget）- 正常',
      httpClientMissing: 'HTTP 客戶端（curl/wget）- 缺失',
      allValid: '所有系統依賴項可用',
      someInvalid: '部分系統依賴項缺失',
      error: '檢查系統依賴項失敗'
    },
    
    ports: {
      allAvailable: '所有必需端口都可用',
      someUnavailable: '端口 {{ports}} 當前正在使用中',
      changeConfig: '在設置中更改端口配置',
      stopServices: '停止使用這些端口的服務'
    },
    
    permissions: {
      valid: '文件系統權限 - 正常',
      invalid: '文件系統權限不足',
      checkOwnership: '檢查文件/目錄所有權和權限',
      runAsAdmin: '嘗試以管理員/root 身份運行'
    },
    
    network: {
      valid: '網絡連接 - 正常',
      issues: '檢測到網絡連接問題',
      error: '測試網絡連接失敗',
      checkFirewall: '檢查防火牆設置',
      checkProxy: '檢查代理配置'
    }
  },

  environment: {
    title: '環境配置',
    nodeEnv: 'Node 環境（development/production/staging/test）：',
    port: 'API 服務器端口：',
    host: 'API 服務器主機：',
    corsOrigin: 'CORS 允許的來源：'
  },

  database: {
    title: '數據庫設置',
    description: 'FlakeGuard 需要 PostgreSQL 和 Redis 來進行數據存儲和緩存。',
    selectType: '您希望如何設置數據庫？',
    useDocker: '使用 Docker 容器（開發環境推薦）',
    useExisting: '連接到現有數據庫服務器',
    useCloud: '使用雲數據庫服務',
    
    dockerSetup: 'Docker 數據庫設置',
    startContainers: '現在啟動數據庫容器？',
    startingContainers: '正在啟動數據庫容器...',
    containersStarted: '數據庫容器啟動成功',
    containersFailed: '數據庫容器啟動失敗',
    
    postgresHost: 'PostgreSQL 主機：',
    postgresPort: 'PostgreSQL 端口：',
    postgresDatabase: '數據庫名稱：',
    postgresUsername: '用戶名：',
    postgresPassword: '密碼：',
    
    redisHost: 'Redis 主機：',
    redisPort: 'Redis 端口：',
    redisPassword: 'Redis 密碼（如無請留空）：',
    
    existingSetup: '現有數據庫設置',
    postgresUrl: 'PostgreSQL 連接 URL：',
    redisUrl: 'Redis 連接 URL：',
    invalidPostgresUrl: '無效的 PostgreSQL URL（必須以 postgresql:// 開頭）',
    invalidRedisUrl: '無效的 Redis URL（必須以 redis:// 開頭）',
    
    cloudSetup: '雲數據庫設置',
    selectProvider: '選擇您的雲服務提供商：',
    cloudInstructions: '請創建 {{provider}} 數據庫並提供連接詳細信息。',
    cloudPostgresUrl: '雲 PostgreSQL URL：',
    cloudRedisUrl: '雲 Redis URL：',
    
    testingConnections: '測試數據庫連接...',
    testingRedis: '測試 Redis 連接...',
    connectionsSuccessful: '數據庫連接成功',
    connectionsFailed: '數據庫連接失敗',
    connectionError: '連接錯誤',
    continueWithoutConnection: '在沒有成功連接測試的情況下繼續？',
    setupAborted: '數據庫設置已中止',
    
    creatingDatabase: '創建數據庫表...',
    databaseCreated: '數據庫表創建成功',
    databaseCreationFailed: '創建數據庫表失敗',
    
    seedingAdmin: '創建管理員用戶...',
    adminEmail: '管理員用戶郵箱：',
    adminName: '管理員用戶全名：',
    adminPassword: '管理員用戶密碼：',
    invalidEmail: '請輸入有效的郵箱地址',
    passwordTooShort: '密碼必須至少 8 個字符',
    adminUserCreated: '管理員用戶創建成功',
    adminUserFailed: '創建管理員用戶失敗',
    adminCredentials: '管理員登錄憑證',
    email: '郵箱',
    password: '密碼'
  },

  github: {
    title: 'GitHub 集成設置',
    description: 'FlakeGuard 與 GitHub 集成以分析來自 GitHub Actions 的測試結果並在拉取請求上提供自動反饋。',
    confirmSetup: '設置 GitHub 集成？',
    skipped: 'GitHub 集成已跳過',
    
    hasExistingApp: '您已經為 FlakeGuard 擁有 GitHub 應用程序嗎？',
    
    creationGuide: 'GitHub 應用程序創建指南',
    step1: '前往 GitHub 設置 > 開發者設置 > GitHub 應用程序',
    step2: '點擊「新建 GitHub 應用程序」',
    step3: '填寫應用詳情（名稱、描述、主頁 URL）',
    step4: '設置 webhook URL 為您的 FlakeGuard API 端點',
    step5: '配置權限和事件（見下方）',
    
    requiredPermissions: '必需權限：',
    webhookEvents: '必需 Webhook 事件：',
    
    openBrowserPrompt: '在瀏覽器中打開 GitHub 應用創建頁面？',
    browserOpened: '瀏覽器已打開 - 請創建您的 GitHub 應用程序',
    manualUrl: '手動 URL',
    pressEnterToContinue: '創建 GitHub 應用程序後按 Enter 鍵...',
    
    configureApp: '配置 GitHub 應用程序',
    existingApp: '配置現有 GitHub 應用程序',
    
    enterAppId: 'GitHub 應用程序 ID：',
    enterClientId: 'GitHub 應用程序客戶端 ID：',
    enterClientSecret: 'GitHub 應用程序客戶端密鑰：',
    enterWebhookSecret: 'Webhook 密鑰：',
    
    invalidAppId: '應用程序 ID 必須是數字',
    invalidClientId: '客戶端 ID 格式無效',
    invalidClientSecret: '客戶端密鑰格式無效',
    invalidWebhookSecret: 'Webhook 密鑰必須至少 16 個字符',
    
    selectKeyMethod: '您希望如何提供私鑰？',
    keyFromFile: '從文件加載',
    keyPasteContent: '粘貼內容',
    
    enterKeyPath: '私鑰文件路徑（.pem）：',
    pastePrivateKey: '粘貼私鑰內容：',
    
    invalidKeyFile: '文件不包含有效的私鑰',
    keyFileNotFound: '未找到私鑰文件',
    invalidPrivateKey: '私鑰格式無效',
    
    validating: '驗證 GitHub 應用程序配置...',
    validationSuccessful: 'GitHub 應用程序配置驗證成功',
    validationFailed: 'GitHub 應用程序驗證失敗',
    validationError: '驗證錯誤',
    continueWithoutValidation: '在沒有驗證的情況下繼續？',
    setupAborted: 'GitHub 設置已中止',
    
    appConfigured: 'GitHub 應用程序配置成功',
    appId: '應用程序 ID',
    clientId: '客戶端 ID',
    
    webhookConfiguration: 'Webhook 配置',
    webhookUrl: 'Webhook URL',
    updateWebhookInstructions: '更新您的 GitHub 應用程序 webhook URL：',
    webhookStep1: '前往您的 GitHub 應用程序設置',
    webhookStep2: '更新 webhook URL 為上述值',
    webhookStep3: '確保 webhook 密鑰與您的配置匹配',
    webhookStep4: '保存更改',
    
    testingWebhook: '測試 webhook 連接...',
    webhookTestSuccessful: 'Webhook 測試成功',
    webhookTestFailed: 'Webhook 測試失敗'
  },

  slack: {
    title: 'Slack 集成設置',
    description: 'FlakeGuard 可以通過 Slack 發送通知並提供交互式命令。',
    confirmSetup: '設置 Slack 集成？',
    skipped: 'Slack 集成已跳過',
    
    hasExistingApp: '您已經為 FlakeGuard 擁有 Slack 應用程序嗎？',
    
    creationGuide: 'Slack 應用程序創建指南',
    step1: '前往 https://api.slack.com/apps',
    step2: '點擊「創建新應用程序」>「從頭開始」',
    step3: '輸入應用名稱並選擇工作空間',
    step4: '配置 OAuth 作用域（見下方）',
    step5: '將應用安裝到工作空間並複製令牌',
    
    requiredScopes: '必需的 OAuth 作用域：',
    eventSubscriptions: '事件訂閱：',
    
    openBrowserPrompt: '在瀏覽器中打開 Slack 應用創建頁面？',
    browserOpened: '瀏覽器已打開 - 請創建您的 Slack 應用程序',
    manualUrl: '手動 URL',
    pressEnterToContinue: '創建 Slack 應用程序後按 Enter 鍵...',
    
    configureApp: '配置 Slack 應用程序',
    existingApp: '配置現有 Slack 應用程序',
    
    enterBotToken: '機器人用戶 OAuth 令牌（xoxb-...）：',
    enterSigningSecret: '簽名密鑰：',
    enterAppToken: '應用級令牌（xapp-...）：',
    enterPort: 'Slack 服務端口：',
    
    invalidBotToken: '機器人令牌必須以「xoxb-」開頭',
    invalidSigningSecret: '簽名密鑰必須是 32 個字符',
    invalidAppToken: '應用令牌必須以「xapp-」開頭',
    invalidPort: '端口必須在 1024 到 65535 之間',
    
    validating: '驗證 Slack 應用程序配置...',
    validationSuccessful: 'Slack 應用程序配置驗證成功',
    validationFailed: 'Slack 應用程序驗證失敗',
    validationError: '驗證錯誤',
    continueWithoutValidation: '在沒有驗證的情況下繼續？',
    setupAborted: 'Slack 設置已中止',
    
    appConfigured: 'Slack 應用程序配置成功',
    teamName: '團隊',
    botName: '機器人名稱',
    botId: '機器人 ID',
    
    eventConfiguration: '事件訂閱配置',
    eventUrl: '請求 URL',
    updateEventInstructions: '更新您的 Slack 應用程序事件訂閱：',
    eventStep1: '前往您的 Slack 應用程序設置',
    eventStep2: '導航到「事件訂閱」',
    eventStep3: '設置請求 URL 為上述值',
    eventStep4: '訂閱必需的機器人事件',
    
    testingSlashCommand: '測試斜杠命令...',
    slashCommandTestSuccessful: '斜杠命令測試成功',
    slashCommandTestFailed: '斜杠命令測試失敗',
    
    slashCommandSetup: '斜杠命令設置',
    slashCommandInstructions: '在您的 Slack 應用程序中配置這些斜杠命令：',
    commandStep1: '前往應用設置中的「斜杠命令」',
    commandStep2: '使用上面顯示的 URL 創建每個命令',
    commandStep3: '設置適當的描述和使用提示',
    commandStep4: '保存並在需要時重新安裝應用程序'
  },

  config: {
    title: '配置生成',
    saved: '配置已保存到',
    wouldBeSaved: '配置將保存到',
    dryRunPreview: '配置預覽（試運行）',
    permissionWarning: '警告：配置文件權限不安全',
    fileCreated: '配置文件已創建',
    backupCreated: '現有配置已備份到',
    
    unsupportedTemplateFormat: '不支持的模板格式（使用 .json 或 .yml）',
    templateLoadError: '從 {{path}} 加載模板失敗：{{error}}',
    
    validation: {
      missingRequired: '缺少必需字段：{{field}}',
      invalidDatabaseUrl: '無效的 DATABASE_URL 格式',
      invalidRedisUrl: '無效的 REDIS_URL 格式',
      invalidPort: '無效的 PORT 值',
      weakJwtSecret: 'JWT_SECRET 應該至少 32 個字符',
      weakApiKey: 'API_KEY 應該至少 16 個字符',
      missingGitHubConfig: 'GitHub webhook 已啟用但缺少 GitHub 配置',
      missingSlackConfig: 'Slack 應用已啟用但缺少 Slack 配置'
    }
  },

  health: {
    title: '系統健康檢查',
    
    database: {
      healthy: '數據庫連接健康',
      unhealthy: '數據庫連接失敗'
    },
    
    redis: {
      healthy: 'Redis 連接健康',
      unhealthy: 'Redis 連接失敗'
    },
    
    api: {
      healthy: 'API 端點響應正常',
      unhealthy: 'API 端點無響應',
      notRunning: 'API 服務未運行',
      startService: '啟動 FlakeGuard API 服務'
    },
    
    github: {
      healthy: 'GitHub 集成健康',
      unhealthy: '檢測到 GitHub 集成問題'
    },
    
    slack: {
      healthy: 'Slack 集成健康',
      unhealthy: '檢測到 Slack 集成問題'
    },
    
    system: {
      healthy: '系統資源健康',
      unhealthy: '系統處於壓力狀態',
      stressed: '系統資源處於壓力狀態',
      error: '檢查系統資源失敗'
    }
  },

  completion: {
    title: '設置完成！',
    message: '恭喜！FlakeGuard 已成功配置並準備使用。',
    nextSteps: '下一步：',
    step1: '啟動 FlakeGuard 服務：pnpm run dev',
    step2: '在您的代碼庫中安裝 GitHub 應用程序',
    step3: '配置 CI 管道以發送測試結果',
    step4: '訪問儀表板：http://localhost:3000',
    transcriptSaved: '設置記錄已保存到'
  }
};