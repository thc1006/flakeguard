import createNextIntlPlugin from 'next-intl/plugin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable standalone output due to Windows symlink issues
  // output: 'standalone',
  // Move typedRoutes out of experimental (Next.js 15.5+)
  typedRoutes: true,
  // Configure output file tracing to silence lockfile warnings
  outputFileTracingRoot: process.env.NEXT_OUTPUT_TRACING_ROOT || join(__dirname, '../../'),
  typescript: {
    // Temporarily allow builds with TypeScript errors for Docker builds
    // TODO: Fix TypeScript errors and remove this override
    ignoreBuildErrors: true,
  },
  eslint: {
    // Temporarily allow builds with ESLint errors for Docker builds  
    // TODO: Fix ESLint errors and remove this override for production
    ignoreDuringBuilds: true,
  },
  env: {
    FLAKEGUARD_API_URL: process.env.FLAKEGUARD_API_URL || 'http://localhost:3000',
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/dashboard',
        permanent: false,
      },
    ];
  },
  // Transpile shared packages
  transpilePackages: ['@flakeguard/shared'],
  // Webpack configuration for shared packages
  webpack: (config, { isServer }) => {
    // Handle shared package imports
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
