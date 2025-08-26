#!/bin/bash
# Fix database schema sync issues

set -e

echo "🔧 FlakeGuard Database Schema Fix Script"
echo "========================================"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the project root directory"
    exit 1
fi

# Set Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

echo "📦 Installing dependencies..."
pnpm install --prefer-offline

echo "🗄️ Setting up database..."
cd apps/api

echo "📋 Current migration status:"
pnpm exec prisma migrate status || echo "No migration status available (fresh database)"

echo "🔄 Running migrations..."
pnpm migrate:deploy

echo "🔄 Regenerating Prisma client..."
pnpm generate

echo "📊 Verifying database tables:"
pnpm exec prisma db execute --stdin << 'EOF'
SELECT 
    schemaname,
    tablename,
    tableowner 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
EOF

echo "✅ Database schema is now in sync!"
echo "🧪 You can now run: pnpm test"

cd ../..