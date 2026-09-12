/**
 * Simple test script to run the CLI in PTY and capture output.
 */

import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const bin = join(repo, 'Kibborg_CLI', 'apps', 'cli', 'lib', 'bin.js')

console.log('Bin path:', bin)
console.log('Exists:', existsSync(bin))

if (!existsSync(bin)) {
  console.error(`Missing: ${bin}`)
  process.exit(2)
}

// Simple test: just run the CLI for a short time
console.log('Testing CLI directly...')

try {
  // Test the direct execution
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [bin, '--help'], {
    cwd: repo,
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  
  let stdout = ''
  let stderr = ''
  
  child.stdout.on('data', (data) => {
    stdout += data.toString()
  })
  
  child.stderr.on('data', (data) => {
    stderr += data.toString()
  })
  
  child.on('close', (code) => {
    console.log(`CLI exited with code ${code}`)
    console.log('STDOUT:')
    console.log(stdout.substring(0, 1000))
    console.log('STDERR:')
    console.log(stderr.substring(0, 1000))
    process.exit(0)
  })
  
  setTimeout(() => {
    console.log('Timeout - killing process')
    child.kill()
    process.exit(1)
  }, 5000)
  
} catch (error) {
  console.error('Error:', error)
  process.exit(1)
}