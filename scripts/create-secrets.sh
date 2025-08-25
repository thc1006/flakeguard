#!/bin/bash

# FlakeGuard Secret Management Script
# Generates secure secrets for production deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
SECRETS_DIR="${SECRETS_DIR:-./secrets}"
ENVIRONMENT="${ENVIRONMENT:-production}"
FORCE="${FORCE:-false}"

# Helper functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $*${NC}" >&2
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $*${NC}" >&2
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*${NC}" >&2
    exit 1
}

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Generate secure secrets for FlakeGuard deployment.

OPTIONS:
    -e, --environment ENVIRONMENT    Set environment (default: production)
    -d, --secrets-dir DIRECTORY      Set secrets directory (default: ./secrets)
    -f, --force                      Overwrite existing secrets
    -h, --help                       Show this help message

EXAMPLES:
    # Generate production secrets
    $0

    # Generate development secrets
    $0 --environment development

    # Force regenerate all secrets
    $0 --force

    # Use custom secrets directory
    $0 --secrets-dir /etc/flakeguard/secrets

EOF
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -d|--secrets-dir)
            SECRETS_DIR="$2"
            shift 2
            ;;
        -f|--force)
            FORCE="true"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
    error "Environment must be one of: development, staging, production"
fi

log "Creating secrets for environment: $ENVIRONMENT"
log "Secrets directory: $SECRETS_DIR"

# Create secrets directory
mkdir -p "$SECRETS_DIR"

# Function to generate random string
generate_random() {
    local length=${1:-32}
    openssl rand -base64 $((length * 3 / 4)) | tr -d '\n'
}

# Function to generate JWT secret
generate_jwt_secret() {
    openssl rand -base64 64 | tr -d '\n'
}

# Function to generate API key
generate_api_key() {
    openssl rand -hex 16 | tr -d '\n'
}

# Function to generate webhook secret
generate_webhook_secret() {
    openssl rand -base64 32 | tr -d '\n'
}

# Function to generate encryption key
generate_encryption_key() {
    openssl rand -base64 32 | tr -d '\n'
}

# Function to create secret file
create_secret() {
    local name="$1"
    local value="$2"
    local description="$3"
    local file="$SECRETS_DIR/${name}"
    
    if [[ -f "$file" && "$FORCE" != "true" ]]; then
        warn "Secret $name already exists, skipping (use --force to overwrite)"
        return 0
    fi
    
    echo -n "$value" > "$file"
    chmod 600 "$file"
    log "Created secret: $name ($description)"
}

# Function to create env file template
create_env_template() {
    local env_file="$SECRETS_DIR/.env.${ENVIRONMENT}"
    
    if [[ -f "$env_file" && "$FORCE" != "true" ]]; then
        warn "Environment file $env_file already exists, skipping (use --force to overwrite)"
        return 0
    fi
    
    cat > "$env_file" << EOF
# FlakeGuard Environment Configuration
# Environment: $ENVIRONMENT
# Generated: $(date -u +'%Y-%m-%d %H:%M:%S UTC')

# Application Settings
NODE_ENV=$ENVIRONMENT
LOG_LEVEL=${ENVIRONMENT == "production" && echo "info" || echo "debug"}
VERSION=latest

# Database Configuration
DATABASE_URL=postgresql://flakeguard:PASSWORD@localhost:5432/flakeguard
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=REDIS_PASSWORD_FROM_SECRETS

# Security Configuration (Use Docker secrets in production)
JWT_SECRET_FILE=/run/secrets/jwt_secret
API_KEY_FILE=/run/secrets/api_key
WEBHOOK_SECRET_FILE=/run/secrets/webhook_secret
ENCRYPTION_KEY_FILE=/run/secrets/encryption_key

# GitHub Integration
GITHUB_APP_ID=YOUR_GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/github_private_key
GITHUB_WEBHOOK_SECRET_FILE=/run/secrets/github_webhook_secret
GITHUB_CLIENT_ID=YOUR_GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET_FILE=/run/secrets/github_client_secret

# Slack Integration (Optional)
SLACK_BOT_TOKEN_FILE=/run/secrets/slack_bot_token
SLACK_SIGNING_SECRET_FILE=/run/secrets/slack_signing_secret

# Web Configuration
NEXTAUTH_SECRET_FILE=/run/secrets/nextauth_secret
NEXTAUTH_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://api.your-domain.com

# Monitoring & Observability
PROMETHEUS_ENABLED=true
SENTRY_DSN=YOUR_SENTRY_DSN
ANALYTICS_ID=YOUR_ANALYTICS_ID

# Database Passwords (for Docker Compose)
POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password
REDIS_PASSWORD_FILE=/run/secrets/redis_password
GRAFANA_ADMIN_PASSWORD_FILE=/run/secrets/grafana_admin_password

EOF

    chmod 600 "$env_file"
    log "Created environment template: $env_file"
}

# Function to create Docker secrets
create_docker_secrets() {
    if ! command -v docker &> /dev/null; then
        warn "Docker not found, skipping Docker secret creation"
        return 0
    fi
    
    log "Creating Docker secrets..."
    
    local secrets=(
        "jwt_secret:flakeguard_jwt_secret"
        "api_key:flakeguard_api_key"
        "webhook_secret:flakeguard_webhook_secret"
        "encryption_key:flakeguard_encryption_key"
        "nextauth_secret:flakeguard_nextauth_secret"
        "postgres_password:flakeguard_postgres_password"
        "redis_password:flakeguard_redis_password"
        "grafana_admin_password:flakeguard_grafana_admin_password"
    )
    
    for secret_pair in "${secrets[@]}"; do
        local file_name="${secret_pair%:*}"
        local secret_name="${secret_pair#*:}"
        local file_path="$SECRETS_DIR/$file_name"
        
        if [[ -f "$file_path" ]]; then
            # Remove existing secret if it exists
            docker secret rm "$secret_name" 2>/dev/null || true
            
            # Create new secret
            if docker secret create "$secret_name" "$file_path" > /dev/null 2>&1; then
                log "Created Docker secret: $secret_name"
            else
                warn "Failed to create Docker secret: $secret_name"
            fi
        fi
    done
}

# Function to create Kubernetes secrets
create_kubernetes_secrets() {
    if ! command -v kubectl &> /dev/null; then
        warn "kubectl not found, skipping Kubernetes secret creation"
        return 0
    fi
    
    log "Creating Kubernetes secrets..."
    
    # Check if namespace exists
    local namespace="flakeguard"
    if ! kubectl get namespace "$namespace" > /dev/null 2>&1; then
        log "Creating namespace: $namespace"
        kubectl create namespace "$namespace"
    fi
    
    # Create generic secret with all application secrets
    local secret_files=()
    local secrets=(
        "jwt_secret"
        "api_key"
        "webhook_secret"
        "encryption_key"
        "nextauth_secret"
        "postgres_password"
        "redis_password"
        "grafana_admin_password"
    )
    
    for secret in "${secrets[@]}"; do
        local file_path="$SECRETS_DIR/$secret"
        if [[ -f "$file_path" ]]; then
            secret_files+=("--from-file=${secret}=${file_path}")
        fi
    done
    
    if [[ ${#secret_files[@]} -gt 0 ]]; then
        # Remove existing secret if it exists
        kubectl delete secret flakeguard-secrets -n "$namespace" 2>/dev/null || true
        
        # Create new secret
        if kubectl create secret generic flakeguard-secrets -n "$namespace" "${secret_files[@]}" > /dev/null 2>&1; then
            log "Created Kubernetes secret: flakeguard-secrets"
        else
            warn "Failed to create Kubernetes secret"
        fi
    fi
}

# Main function
main() {
    log "Starting FlakeGuard secret generation..."
    
    # Generate application secrets
    log "Generating application secrets..."
    create_secret "jwt_secret" "$(generate_jwt_secret)" "JWT signing secret"
    create_secret "api_key" "$(generate_api_key)" "API key for service authentication"
    create_secret "webhook_secret" "$(generate_webhook_secret)" "Webhook signature secret"
    create_secret "encryption_key" "$(generate_encryption_key)" "Data encryption key"
    create_secret "nextauth_secret" "$(generate_random 32)" "NextAuth.js secret"
    
    # Generate database secrets
    log "Generating database secrets..."
    create_secret "postgres_password" "$(generate_random 24)" "PostgreSQL password"
    create_secret "redis_password" "$(generate_random 24)" "Redis password"
    create_secret "grafana_admin_password" "$(generate_random 16)" "Grafana admin password"
    
    # Create environment template
    log "Creating environment template..."
    create_env_template
    
    # Create deployment-specific secrets
    case "$ENVIRONMENT" in
        development)
            log "Development environment: Creating local secrets only"
            ;;
        staging|production)
            log "Creating Docker secrets..."
            create_docker_secrets
            
            log "Creating Kubernetes secrets..."
            create_kubernetes_secrets
            ;;
    esac
    
    # Create secret summary
    log "Creating secret summary..."
    cat > "$SECRETS_DIR/README.md" << EOF
# FlakeGuard Secrets

Generated on: $(date -u +'%Y-%m-%d %H:%M:%S UTC')
Environment: $ENVIRONMENT

## Security Guidelines

1. **Never commit secrets to version control**
2. **Rotate secrets regularly (every 90 days recommended)**
3. **Use different secrets for each environment**
4. **Store production secrets in secure secret management systems**

## File Descriptions

- \`jwt_secret\` - JWT token signing secret (64 bytes base64)
- \`api_key\` - API authentication key (32 hex characters)
- \`webhook_secret\` - Webhook signature verification secret (32 bytes base64)
- \`encryption_key\` - Data encryption key (32 bytes base64)
- \`nextauth_secret\` - NextAuth.js session secret (32 bytes base64)
- \`postgres_password\` - PostgreSQL database password (24 bytes base64)
- \`redis_password\` - Redis cache password (24 bytes base64)
- \`grafana_admin_password\` - Grafana admin user password (16 bytes base64)

## Usage with Docker Compose

\`\`\`bash
# Secrets are automatically loaded from this directory
docker-compose -f docker-compose.prod.yml up -d
\`\`\`

## Usage with Kubernetes

\`\`\`bash
# Secrets are created as Kubernetes secrets
kubectl get secrets -n flakeguard
kubectl describe secret flakeguard-secrets -n flakeguard
\`\`\`

## Rotation

To rotate secrets, run:

\`\`\`bash
./scripts/create-secrets.sh --force
\`\`\`

## External Secrets (Manual Setup Required)

The following secrets must be configured manually:

- GitHub App private key (\`github_private_key\`)
- GitHub webhook secret (\`github_webhook_secret\`)
- GitHub client secret (\`github_client_secret\`)
- Slack bot token (\`slack_bot_token\`)
- Slack signing secret (\`slack_signing_secret\`)

See deployment documentation for setup instructions.
EOF
    
    # Set secure permissions on secrets directory
    chmod 700 "$SECRETS_DIR"
    find "$SECRETS_DIR" -type f -exec chmod 600 {} \;
    
    log "Secret generation completed successfully!"
    echo
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Review the generated .env template: $SECRETS_DIR/.env.$ENVIRONMENT"
    echo "2. Configure external secrets (GitHub App, Slack) manually"
    echo "3. Update deployment configuration with your settings"
    echo "4. Test the deployment: docker-compose -f docker-compose.prod.yml up -d"
    echo
    echo -e "${YELLOW}Security reminder:${NC}"
    echo "- Keep secrets secure and never commit them to version control"
    echo "- Rotate secrets regularly (recommended: every 90 days)"
    echo "- Use different secrets for each environment"
    echo
    log "For more information, see: docs/DEPLOYMENT.md"
}

# Run main function
main "$@"