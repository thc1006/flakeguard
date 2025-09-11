
# ⚠️ FlakeGuard Test Analysis Summary

**Generated:** 2025-09-10T18:10:35.860Z
**Commit:** `a1b2c3d4`
**Run ID:** 12345
**Status:** YELLOW

## 📊 Test Metrics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Tests** | 150 | 100% |
| **Passed** | 135 | 90.0% |
| **Failed** | 8 | 5.3% |
| **Flaky Candidates** | 6 | 4.0% |
| **Quarantined** | 3 | 2.0% |

## 🎯 Top Flaky Tests (by Impact)

| Test | File | Frequency | Volatility | Last Seen |
|------|------|-----------|------------|------------|
| `should handle concurrent connections` | [`src/database/connection.test.ts`](/src/database/connection.test.ts#L33) | 15x | 🔴 90% | 2025/1/11 |
| `should handle payment timeout` | [`src/payment/payment.test.ts`](/src/payment/payment.test.ts#L25) | 12x | 🟡 75% | 2025/1/11 |
| `should handle JWT token validation` | [`src/auth/auth.test.ts`](/src/auth/auth.test.ts#L14) | 8x | 🔴 85% | 2025/1/11 |

## 🔒 Quarantine Status

### Active Quarantines (7)

| Test | Owner | Days Remaining | Priority | Reason |
|------|-------|----------------|----------|--------|
| `auth::Authentication Service › should validate JWT token::src/auth/auth.test.ts` | @auth-team | 🟢 14d | 🟠 high | Test exhibits timing-dependent behavior in CI environment |
| `payment::Payment Processing › should handle payment timeout::src/payment/payment.test.ts` | @payments-team | 🟢 12d | 🟡 medium | Network timeout issues with external payment gateway in test environment |
| `sample-tests::should handle concurrent requests::user.test.ts` | @infrastructure-team | 🟡 7d | 🟡 medium | Timeout issues due to resource contention in CI environment |
| `sample-tests::should rollback failed transaction::db.test.ts` | @database-team | 🟢 10d | 🟠 high | Database connection instability in test environment |
| `db::Database Connection Pool › should handle concurrent connections::src/db/pool.test.ts` | @database-team | 🟢 14d | 🟡 medium | Connection pool timeout issues in CI environment |
| `payment::Payment Service › should process payment::src/payment/payment.test.ts` | @payments-team | 🟢 14d | 🟡 medium | Network timeout with payment gateway |
| `auth::login::timeout` | @auth-team | 🟢 14d | 🔴 critical | Network timeouts during authentication |

## 🖥️ Environment Analysis

| Environment | OS | Node | Arch | Failure Rate | Tests |
|-------------|----|----- |------|--------------|-------|
| ubuntu-latest | ubuntu-latest | 20.x | x64 | 🟢 2.0% | 3/150 |

## 💡 Recommendations

- 🎯 **Focus on 3 high-volatility flakes** - these impact CI reliability most

---
*FlakeGuard v1.0.0 - Automated flaky test detection and quarantine management*
