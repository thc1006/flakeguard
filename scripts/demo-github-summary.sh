#!/bin/bash

# GitHub Actions Step Summary Demo
# 
# This script demonstrates how FlakeGuard writes rich markdown summaries
# to $GITHUB_STEP_SUMMARY for display on the workflow run page.

echo "🎯 FlakeGuard GitHub Actions Step Summary Demo"
echo "=============================================="
echo ""

# Simulate FlakeGuard execution
echo "📋 Running FlakeGuard analysis..."
echo ""

# Check if we have a rich summary file
if [ -f ".flakeguard/out/report-rich-summary.md" ]; then
    echo "✅ Found rich markdown summary - writing to step summary"
    
    # In GitHub Actions, this would be:
    # cat .flakeguard/out/report-rich-summary.md >> $GITHUB_STEP_SUMMARY
    
    echo "Preview of summary that would appear on GitHub Actions run page:"
    echo "================================================================"
    cat .flakeguard/out/report-rich-summary.md
else
    echo "⚠️  No rich summary found - using fallback format"
    
    if [ -f ".flakeguard/out/report-rich.json" ]; then
        echo "## 🔍 FlakeGuard Test Analysis Summary"
        echo ""
        echo "| Metric | Value |"
        echo "|--------|-------|"
        
        total_tests=$(jq -r '.summary.totalTests // 0' .flakeguard/out/report-rich.json)
        failed_tests=$(jq -r '.summary.failedTests // 0' .flakeguard/out/report-rich.json)
        flaky_candidates=$(jq -r '.summary.flakyCandidates // 0' .flakeguard/out/report-rich.json)
        
        echo "| **Total Tests** | $total_tests |"
        echo "| **Failed Tests** | $failed_tests |"
        echo "| **Flaky Candidates** | $flaky_candidates |"
        echo ""
        
        if [ "$failed_tests" -gt "0" ]; then
            echo "### Recent Test Failures"
            jq -r '.failures[] | "- **\(.name)** in `\(.file // "unknown"):\(.line // "?")` - \(.message)"' .flakeguard/out/report-rich.json | head -5
        fi
    else
        echo "## ⚠️ FlakeGuard Analysis Unavailable"
        echo "No FlakeGuard report was generated for this run."
    fi
fi

echo ""
echo "🎉 Demo complete!"
echo ""
echo "In GitHub Actions, this content would appear in the 'Summary' tab"
echo "of the workflow run page, providing rich insights into test health."