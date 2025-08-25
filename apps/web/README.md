# FlakeGuard Web Dashboard

A modern, production-ready web dashboard for monitoring and managing flaky test detection across your repositories.

## 🚀 Features

### Core Dashboard
- **Repository Health Monitoring**: Visual indicators for repository health status (Excellent, Good, Warning, Critical)
- **Flaky Test Detection**: Real-time monitoring of flaky tests with confidence scores and recommendations
- **Failure Cluster Analysis**: Grouping and visualization of test failure patterns
- **Recent Actions Timeline**: Track quarantine decisions, issue creation, and test reruns

### Deep Integration
- **GitHub Integration**: Direct links to PRs, check runs, and repository pages
- **Slack Integration**: Links to discussion threads and notifications
- **Authentication**: GitHub OAuth for secure access
- **Internationalization**: Full support for English and Traditional Chinese (中文繁體)

### Modern Architecture
- **Next.js 14**: Latest App Router with React Server Components
- **TypeScript**: Full type safety with strict mode enabled
- **Tailwind CSS**: Modern, responsive design system
- **TanStack Query**: Optimized data fetching with caching and background updates
- **Real-time Updates**: Automatic data refresh and live notifications

## 🛠️ Technology Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript 5.3+
- **Styling**: Tailwind CSS with custom design system
- **State Management**: TanStack Query (React Query)
- **Authentication**: NextAuth.js with GitHub provider
- **Internationalization**: next-intl
- **UI Components**: Custom component library based on Radix UI patterns
- **Build Tools**: ESLint, Prettier, PostCSS
- **Package Manager**: pnpm (workspace support)

## 📚 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- FlakeGuard API running (see `../api`)

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment configuration
cp .env.example .env.local

# Configure your environment variables
edit .env.local
```

### Environment Configuration

```bash
# API Configuration
FLAKEGUARD_API_URL=http://localhost:3000

# NextAuth Configuration
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=your-nextauth-secret-key

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-oauth-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-client-secret
```

### Development

```bash
# Start development server
pnpm dev

# Run type checking
pnpm typecheck

# Run linting
pnpm lint

# Run tests
pnpm test
```

The application will be available at `http://localhost:3001`.

## 🎨 Features Overview

### Dashboard
- Repository health overview with visual indicators
- Top flaky tests with actionable recommendations
- Recent actions timeline with deep links
- System-wide statistics and trends

### Repository Management
- Searchable repository list with pagination
- Individual repository detail pages
- Health metrics and flakiness scoring
- Test history and failure patterns

### Action Tracking
- Complete audit log of all FlakeGuard actions
- Filterable by action type and status
- Direct links to GitHub PRs and Slack threads
- Real-time status updates

### Internationalization
- Full English and Traditional Chinese support
- Language switching with URL preservation
- Localized date/time formatting
- Cultural adaptation for Taiwanese users

## 🚀 Production Deployment

### Docker

```bash
# Build the Docker image
docker build -t flakeguard-web .

# Run the container
docker run -p 3001:3001 \
  -e FLAKEGUARD_API_URL=https://api.flakeguard.com \
  -e NEXTAUTH_URL=https://dashboard.flakeguard.com \
  -e NEXTAUTH_SECRET=your-production-secret \
  -e GITHUB_CLIENT_ID=your-github-client-id \
  -e GITHUB_CLIENT_SECRET=your-github-client-secret \
  flakeguard-web
```

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `FLAKEGUARD_API_URL` | FlakeGuard API base URL | Yes | `http://localhost:3000` |
| `NEXTAUTH_URL` | NextAuth callback URL | Yes | `http://localhost:3001` |
| `NEXTAUTH_SECRET` | NextAuth encryption secret | Yes | - |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | Yes | - |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | Yes | - |
| `ENABLE_REALTIME_UPDATES` | Enable real-time data updates | No | `true` |
| `ENABLE_DARK_MODE` | Enable dark mode support | No | `true` |

### GitHub OAuth Setup

1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Create a new OAuth App with:
   - **Application name**: FlakeGuard Dashboard
   - **Homepage URL**: `https://your-domain.com`
   - **Authorization callback URL**: `https://your-domain.com/api/auth/callback/github`
3. Copy the Client ID and Client Secret to your environment variables

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── [locale]/          # Internationalized routes
│   │   ├── (dashboard)/   # Dashboard layout group
│   │   └── auth/          # Authentication pages
│   └── api/               # API routes
├── components/            # React components
│   ├── ui/               # Base UI components
│   ├── layout/           # Layout components
│   ├── dashboard/        # Dashboard-specific components
│   └── auth/             # Authentication components
├── hooks/                # Custom React hooks
├── lib/                  # Utility libraries
└── types/                # TypeScript type definitions
messages/                 # Internationalization messages
├── en.json              # English translations
└── zh-TW.json           # Traditional Chinese translations
```

## 📦 API Integration

The dashboard integrates with the FlakeGuard API through a type-safe client:

```typescript
// Example: Fetching repository data
import { useRepositories } from '@/hooks/use-repositories';

function RepositoryList() {
  const { data, isLoading, error } = useRepositories({
    limit: 10,
    search: 'react'
  });

  // Handle loading, error, and data states
}
```

### Available Hooks

- `useRepositories()` - Repository listing and search
- `useRepository(id)` - Individual repository details
- `useQuarantinePlan(repositoryId)` - Flaky test analysis
- `useTasks()` - Action history and status
- `useRecentActions()` - Recent activity feed

## 🌍 Internationalization

The application supports full internationalization with:

- **English (en)**: Default language
- **Traditional Chinese (zh-TW)**: Hyperlocal support for Taiwan

### Adding New Languages

1. Create a new message file: `messages/[locale].json`
2. Update `middleware.ts` to include the new locale
3. Add locale to `next.config.js` configuration

### Message Structure

```json
{
  "navigation": {
    "dashboard": "Dashboard",
    "repositories": "Repositories"
  },
  "dashboard": {
    "title": "FlakeGuard Dashboard",
    "subtitle": "Monitor and manage flaky tests"
  }
}
```

## 📊 Performance

- **Bundle Size**: Optimized for production with tree shaking
- **Loading Speed**: Server-side rendering with static optimization
- **Caching**: Intelligent data caching with TanStack Query
- **Real-time**: Efficient polling and background updates
- **Responsive**: Mobile-first design with progressive enhancement

## 🔒 Security

- **Authentication**: Secure GitHub OAuth flow
- **Authorization**: Session-based access control
- **CSRF Protection**: Built-in NextAuth.js protection
- **XSS Prevention**: React's built-in sanitization
- **Content Security Policy**: Configured for production

## 🤝 Contributing

1. **Code Style**: Follow ESLint and Prettier configurations
2. **TypeScript**: Maintain strict type safety
3. **Testing**: Write tests for new components and hooks
4. **Accessibility**: Ensure WCAG 2.1 AA compliance
5. **Internationalization**: Add translations for new strings

### Development Commands

```bash
# Development
pnpm dev              # Start development server
pnpm build            # Build for production
pnpm start            # Start production server
pnpm lint             # Run ESLint
pnpm lint:fix         # Fix ESLint issues
pnpm typecheck        # Run TypeScript checks
pnpm test             # Run test suite
pnpm test:coverage    # Run tests with coverage
```

## 📝 License

This project is part of the FlakeGuard monorepo. See the root LICENSE file for details.

---

**FlakeGuard Web Dashboard** - Production-grade flaky test monitoring and management.
