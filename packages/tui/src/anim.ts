/**
 * Animation utilities for terminal interfaces.
 *
 * This module implements animation utilities for terminal rendering.
 * @module @kibborg/tui/anim
 */

/** Create a spinner frame. */
export function spinnerFrame(tick: number): string {
  const frames = ['·', '✳', '✻', '✽', '✻', '✳', '✢', '✣', '✤', '✥']
  const index = tick % frames.length
  return frames[index] || '·'
}

/**
 * Create one frame of the working spinner.
 *
 * Four glyphs of a turning quarter circle: a quiet mark of motion that reads as
 * one object rather than as a scattering of characters.
 * @param tick - frames advanced since the turn started.
 * @returns the glyph for this frame.
 */
export function workingSpinner(tick: number): string {
  const frames = ['◐', '◓', '◑', '◒']
  return frames[Math.abs(tick) % frames.length] ?? '◐'
}

/** Create a band wave. */
export function bandWave(tick: number, cells: number): string {
  if (cells <= 0) {
    return ''
  }
  
  // Use sine to create wave effect
  const wave = []
  for (let i = 0; i < cells; i++) {
    // Create a wave using sine function
    const phase = (i / cells) * Math.PI * 2 + tick * 0.2
    const height = Math.sin(phase) * 0.5 + 0.5 // Normalize to 0-1 range
    const blockIndex = Math.floor(height * 4) // 0-3 = ░▒▓█
    
    // Map index to block character
    const blocks = ['░', '▒', '▓', '█']
    wave.push(blocks[Math.min(blockIndex, blocks.length - 1)])
  }
  
  return wave.join('')
}

/** Create a progress bar. */
export function progressBar(pct: number, cells: number): string {
  if (cells <= 0) {
    return ''
  }
  
  // Clamp percentage
  const clampedPct = Math.max(0, Math.min(100, pct))
  
  // Calculate filled cells
  const filled = Math.round(cells * clampedPct / 100)
  
  // Create progress bar
  let bar = ''
  for (let i = 0; i < cells; i++) {
    bar += i < filled ? '▓' : '░'
  }
  
  return bar
}

/** Format elapsed time. */
export function elapsedLabel(ms: number): string {
  const clamped = Math.max(0, ms)
  if (clamped < 60000) {
    return `${(clamped / 1000).toFixed(1)}s`
  }
  const minutes = Math.floor(clamped / 60000)
  const seconds = Math.round((clamped % 60000) / 1000)
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

/** Create a ticker. */
export function createTicker(fps: number, cb: (tick: number, elapsedMs: number) => void): { 
  start(): void; 
  stop(): void; 
  readonly running: boolean 
} {
  let interval: NodeJS.Timeout | null = null
  let tick = 0
  let startTime: number | null = null
  let running = false
  
  function tickCallback() {
    tick++
    const elapsed = startTime ? Date.now() - startTime : 0
    cb(tick, elapsed)
  }
  
  return {
    start() {
      if (running) return
      running = true
      startTime = Date.now()
      const intervalMs = 1000 / fps
      interval = setInterval(tickCallback, intervalMs)
      interval.unref()
    },
    stop() {
      if (!running) return
      running = false
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    },
    get running() {
      return running
    }
  }
}