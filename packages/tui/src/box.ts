/**
 * Box drawing for terminal interfaces.
 *
 * This module implements box drawing functions for terminal rendering.
 * @module @kibborg/tui/box
 */

import type { CellBuffer } from './framebuffer.ts'
import type { TokenName } from './tokens.ts'
import { displayWidth } from './width.ts'

/** Border style types. */
export type BorderKind = 'single' | 'round' | 'double' | 'dashed' | 'none'

/** Rectangle for drawing boxes. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Draw a box in the buffer. */
export function drawBox(buf: CellBuffer, rect: Rect, options: { 
  readonly border?: BorderKind; 
  readonly token?: TokenName; 
  readonly title?: string; 
  readonly titleAlign?: 'left'|'center'|'right'; 
  readonly fill?: boolean; 
  readonly ascii?: boolean 
}): void {
  const { 
    border = 'single', 
    token = 'Text', 
    title = '', 
    fill = false, 
    titleAlign = 'left',
    ascii = false 
  } = options
  
  const { x, y, w, h } = rect
  
  // Validate rectangle
  if (w <= 0 || h <= 0) {
    return
  }
  
  // Ensure rectangle fits within buffer
  const cols = buf.cols
  const rows = buf.rows
  
  // Clip rectangle to buffer bounds
  const clipX = Math.max(0, x)
  const clipY = Math.max(0, y)
  const clipW = Math.min(w, cols - clipX)
  const clipH = Math.min(h, rows - clipY)
  
  if (clipW <= 0 || clipH <= 0) {
    return
  }
  
  // Border characters
  let topChar = '─'
  let bottomChar = '─'
  let leftChar = '│'
  let rightChar = '│'
  let topLeft = '┌'
  let topRight = '┐'
  let bottomLeft = '└'
  let bottomRight = '┘'
  
  if (border === 'double') {
    topChar = '═'
    bottomChar = '═'
    leftChar = '║'
    rightChar = '║'
    topLeft = '╔'
    topRight = '╗'
    bottomLeft = '╚'
    bottomRight = '╝'
  } else if (border === 'round') {
    topChar = '─'
    bottomChar = '─'
    leftChar = '│'
    rightChar = '│'
    topLeft = '╭'
    topRight = '╮'
    bottomLeft = '╰'
    bottomRight = '╯'
  } else if (border === 'dashed') {
    topChar = '─'
    bottomChar = '─'
    leftChar = '│'
    rightChar = '│'
    topLeft = '┌'
    topRight = '┐'
    bottomLeft = '└'
    bottomRight = '┘'
  } else if (border === 'none') {
    return // No borders
  }
  
  if (ascii) {
    topChar = '-'
    bottomChar = '-'
    leftChar = '|'
    rightChar = '|'
    topLeft = '+'
    topRight = '+'
    bottomLeft = '+'
    bottomRight = '+'
  }
  
  // Draw borders
  if (h > 1) {
    // Top border
    for (let i = 0; i < clipW; i++) {
      buf.put(clipX + i, clipY, i === 0 ? topLeft : (i === clipW - 1 ? topRight : topChar))
    }
    
    // Bottom border
    for (let i = 0; i < clipW; i++) {
      buf.put(clipX + i, clipY + clipH - 1, i === 0 ? bottomLeft : (i === clipW - 1 ? bottomRight : bottomChar))
    }
    
    // Left and right borders
    for (let i = 1; i < clipH - 1; i++) {
      buf.put(clipX, clipY + i, leftChar)
      buf.put(clipX + clipW - 1, clipY + i, rightChar)
    }
  } else {
    // Single row, just draw top and bottom
    for (let i = 0; i < clipW; i++) {
      buf.put(clipX + i, clipY, i === 0 ? topLeft : (i === clipW - 1 ? topRight : topChar))
    }
  }
  
  // Fill if requested
  if (fill && h > 2 && w > 2) {
    for (let y = clipY + 1; y < clipY + clipH - 1; y++) {
      for (let x = clipX + 1; x < clipX + clipW - 1; x++) {
        buf.put(x, y, ' ')
      }
    }
  }
  
  // Draw title if present
  if (title !== '') {
    const titleWidth = displayWidth(title)
    const titleAreaWidth = clipW - 2 // Account for border
    if (titleAreaWidth > 0) {
      let titleX = clipX + 1
      if (titleAlign === 'center') {
        titleX = clipX + Math.max(0, Math.floor((clipW - 2 - titleWidth) / 2))
      } else if (titleAlign === 'right') {
        titleX = clipX + Math.max(0, clipW - 2 - titleWidth)
      }
      
      // Ensure title fits
      const availableTitleWidth = Math.max(0, titleAreaWidth - (titleX - (clipX + 1)))
      if (availableTitleWidth > 0) {
        const clippedTitle = title.length > availableTitleWidth ? 
          (title.slice(0, availableTitleWidth - 1) + '…') : 
          title
        
        // Draw title, stopping before the frame's right border
        let column = titleX
        const titleLimit = clipX + clipW - 1
        for (const glyph of clippedTitle) {
          const width = displayWidth(glyph)
          if (column + width > titleLimit) break
          buf.put(column, clipY, glyph, token)
          column += width
        }
      }
    }
  }
}

/** Create a dashed line. */
export function dashedLine(width: number, ascii = false): string {
  if (width <= 0) {
    return ''
  }
  
  let line = ''
  for (let i = 0; i < width; i++) {
    // Create alternating pattern of space and dash
    line += (i % 2 === 0) ? (ascii ? '-' : '─') : ' '
  }
  
  return line
}

/** Calculate box widths. */
export function boxWidths(cols: number): { readonly inner: number; readonly box: number } {
  const inner = Math.max(1, cols - 4)
  return {
    inner,
    box: cols
  }
}