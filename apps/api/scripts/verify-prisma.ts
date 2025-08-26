#!/usr/bin/env tsx

/**
 * Prisma Client Verification Script
 * 
 * This script verifies that the Prisma client is properly generated
 * and can be imported without errors.
 */

import { performance } from 'perf_hooks'

async function verifyPrismaClient(): Promise<void> {
  const startTime = performance.now()
  
  console.log('🔍 Verifying Prisma client generation...')
  
  try {
    // Try to import the Prisma client
    console.log('📦 Importing @prisma/client...')
    const { PrismaClient } = await import('@prisma/client')
    
    console.log('✅ @prisma/client imported successfully')
    
    // Try to instantiate the client
    console.log('🏗️  Instantiating PrismaClient...')
    const prisma = new PrismaClient()
    
    console.log('✅ PrismaClient instantiated successfully')
    
    // Check if the client has the expected models
    const expectedModels = [
      'user',
      'organization', 
      'fGRepository',
      'fGWorkflowRun',
      'fGTestCase',
      'fGOccurrence',
      'fGFlakeScore'
    ]
    
    console.log('🔍 Checking for expected models...')
    const availableModels = Object.keys(
      (prisma as { _engine?: { datamodel?: { models?: Record<string, unknown> } } })._engine?.datamodel?.models ?? {}
    )
    
    if (availableModels.length === 0) {
      // Fallback: check if model methods exist on the client
      const clientKeys = Object.keys(prisma).filter(key => 
        !key.startsWith('_') && 
        !key.startsWith('$') &&
        typeof (prisma as Record<string, unknown>)[key] === 'object' &&
        (prisma as Record<string, unknown>)[key] !== null
      )
      
      console.log(`📊 Found ${clientKeys.length} model methods on client:`, clientKeys)
      
      const missingModels = expectedModels.filter(model => !clientKeys.includes(model))
      
      if (missingModels.length > 0) {
        console.warn('⚠️  Some expected models may be missing:', missingModels)
      } else {
        console.log('✅ All expected models are available on the client')
      }
    } else {
      console.log(`📊 Found ${availableModels.length} models in datamodel`)
    }
    
    // Cleanup
    await prisma.$disconnect()
    console.log('🔌 Prisma client disconnected')
    
    const endTime = performance.now()
    console.log(`✨ Prisma client verification completed in ${Math.round(endTime - startTime)}ms`)
    
  } catch (error) {
    console.error('❌ Prisma client verification failed:')
    console.error(error)
    process.exit(1)
  }
}

// Run verification if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyPrismaClient().catch((error) => {
    console.error('💥 Unhandled error during verification:', error)
    process.exit(1)
  })
}

export { verifyPrismaClient }