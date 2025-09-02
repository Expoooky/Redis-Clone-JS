#!/usr/bin/env node

/**
 * Project Setup Verification Script
 * Run this to verify that the Redis-Clone-JS project structure is correctly set up
 */

const fs = require('fs')
const path = require('path')

console.log('🔍 Verifying Redis-Clone-JS project setup...\n')

// Required directories
const requiredDirs = [
  'src/core',
  'src/data-structures',
  'src/vector-db',
  'src/document-db',
  'src/server',
  'src/transactions',
  'src/persistence',
  'src/replication',
  'src/security',
  'src/scripting',
  'src/clustering',
  'src/monitoring',
  'src/client',
  'src/utils',
  'tests/unit',
  'tests/integration',
  'tests/performance',
  'tests/compatibility',
  'benchmarks',
  'examples',
  'docs',
  'cli'
]

// Required files
const requiredFiles = [
  'package.json',
  '.gitignore',
  '.eslintrc.js',
  'README.md'
]

let allValid = true

// Check directories
console.log('📁 Checking directory structure:')
requiredDirs.forEach(dir => {
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    console.log(`  ✅ ${dir}`)
  } else {
    console.log(`  ❌ ${dir} (missing or not a directory)`)
    allValid = false
  }
})

console.log('\n📄 Checking required files:')
requiredFiles.forEach(file => {
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    console.log(`  ✅ ${file}`)
  } else {
    console.log(`  ❌ ${file} (missing or not a file)`)
    allValid = false
  }
})

// Check package.json content
console.log('\n📦 Checking package.json configuration:')
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  
  const requiredFields = ['name', 'version', 'main', 'scripts', 'dependencies', 'devDependencies']
  requiredFields.forEach(field => {
    if (pkg[field]) {
      console.log(`  ✅ ${field}`)
    } else {
      console.log(`  ❌ ${field} (missing)`)
      allValid = false
    }
  })
  
  // Check for required dependencies
  const requiredDeps = ['commander', 'winston']
  requiredDeps.forEach(dep => {
    if (pkg.dependencies && pkg.dependencies[dep]) {
      console.log(`  ✅ dependency: ${dep}`)
    } else {
      console.log(`  ❌ dependency: ${dep} (missing)`)
      allValid = false
    }
  })
  
  const requiredDevDeps = ['jest', 'eslint']
  requiredDevDeps.forEach(dep => {
    if (pkg.devDependencies && pkg.devDependencies[dep]) {
      console.log(`  ✅ dev dependency: ${dep}`)
    } else {
      console.log(`  ❌ dev dependency: ${dep} (missing)`)
      allValid = false
    }
  })
} catch (error) {
  console.log(`  ❌ Error reading package.json: ${error.message}`)
  allValid = false
}

console.log('\n' + '='.repeat(50))

if (allValid) {
  console.log('🎉 Setup verification PASSED! Ready to start development.')
  console.log('\nNext steps:')
  console.log('1. Run: npm install')
  console.log('2. Begin with Phase 1: Foundation & Core Infrastructure')
  console.log('3. Follow the README.md development phases sequentially')
  process.exit(0)
} else {
  console.log('❌ Setup verification FAILED! Please fix the issues above.')
  console.log('\nTo fix:')
  console.log('1. Review the README.md file structure requirements')
  console.log('2. Create missing directories and files')
  console.log('3. Run this script again to verify')
  process.exit(1)
}
