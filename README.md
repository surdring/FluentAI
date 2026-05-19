# FluentAI

一个基于 Google Gemini AI 的实时英语口语练习应用，提供语音识别、语音合成和智能对话功能。

## 功能特性

- 🎤 **实时语音识别**: 捕获用户语音并实时转换为文本
- 🤖 **AI 对话**: 基于 Gemini AI 的智能英语导师
- 🔊 **语音合成**: 自然流畅的 AI 语音回复
- 📝 **实时转录**: 显示完整的对话历史
- 🎨 **现代化界面**: 玻璃态设计的深色主题界面
- ⚡ **低延迟**: 基于 Web Audio API 的高性能音频处理
- 📱 **移动端支持**: 支持手机浏览器访问（需 HTTPS）

## 技术栈

- **前端**: React 19.2.4 + TypeScript
- **构建工具**: Vite 6.2.0
- **样式**: TailwindCSS
- **AI 服务**: Google Gemini AI
- **音频处理**: Web Audio API

## 快速开始

### 环境要求

- Node.js (推荐 v18+)
- npm 或 yarn
- Google Gemini API 密钥

### 安装步骤

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd FluentAI
   ```

2. **进入 web 目录**
   ```bash
   cd web
   ```

3. **安装依赖**
   ```bash
   npm install
   ```

4. **配置环境变量**
   
   编辑 `web/.env.local` 文件，将 `PLACEHOLDER_API_KEY` 替换为你的 Gemini API 密钥：
   ```
   GEMINI_API_KEY=your_actual_api_key_here
   ```
   
   获取 API 密钥：https://makersuite.google.com/app/apikey

5. **启动开发服务器**
   ```bash
   npm run dev
   ```

6. **打开浏览器**
   
   访问 http://localhost:3000

## 使用说明

1. 点击麦克风按钮开始会话
2. 允许浏览器访问麦克风权限
3. 开始用英语与 AI 导师对话
4. AI 会实时纠正语法错误并提供学习建议
5. 点击"End Session"结束会话

## 项目结构

```
FluentAI/
├── README.md                 # 项目说明
└── web/
    ├── public/               # 静态资源
    │   └── favicon.ico     # 网站图标
    ├── .env.local            # 环境变量配置
    ├── .gitignore           # Git 忽略文件
    ├── index.html           # 主页面
    ├── index.tsx            # 主要应用代码
    ├── package.json         # 依赖配置
    ├── tsconfig.json        # TypeScript 配置
    └── vite.config.ts       # Vite 构建配置
```

## 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

## 移动端访问

手机浏览器访问麦克风需要 **HTTPS** 环境。

### 使用 ngrok 创建 HTTPS 隧道

1. **安装 ngrok**（已配置在 `vite.config.ts` 中支持 ngrok 域名）
   ```bash
   npm install -g ngrok
   ngrok config add-authtoken YOUR_AUTHTOKEN
   ```

2. **启动开发服务器**
   ```bash
   cd web && npm run dev
   ```

3. **启动 ngrok 隧道**
   ```bash
   ngrok http 3000
   ```

4. **手机访问**
   
   使用 ngrok 提供的 HTTPS 地址（如 `https://xxx.ngrok-free.app`）

### 手机权限设置

如果提示权限被拒绝：
- **iPhone**: 设置 → 隐私 → 麦克风 → 启用浏览器
- **Android**: 设置 → 应用 → 浏览器 → 权限 → 麦克风 → 允许

## 注意事项

- 需要有效的网络连接访问 Google Gemini API
- 麦克风权限是必需的
- 建议使用 Chrome 浏览器以获得最佳兼容性
- API 调用会产生费用，请注意使用量

## 许可证

MIT License