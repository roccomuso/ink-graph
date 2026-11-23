// Braille "pixel" canvas: every terminal cell is a 2x4 grid of dots.
//
//   dot (dx,dy)  ->  bit
//   (0,0) 0x01   (1,0) 0x08
//   (0,1) 0x02   (1,1) 0x10
//   (0,2) 0x04   (1,2) 0x20
//   (0,3) 0x40   (1,3) 0x80
//
// On top of the dots, whole cells can be overlaid with regular characters
// (node glyphs, labels). Every cell carries a single style; when several
// things touch the same cell the one with the highest z wins the style.

const BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80]
]

export class Canvas {
  /**
   * @param {number} cols  width in terminal cells
   * @param {number} rows  height in terminal cells
   */
  constructor (cols, rows) {
    this.cols = Math.max(1, cols | 0)
    this.rows = Math.max(1, rows | 0)
    this.width = this.cols * 2 // in dots
    this.height = this.rows * 4 // in dots
    const n = this.cols * this.rows
    this.bits = new Uint8Array(n)
    this.z = new Int16Array(n).fill(-1)
    this.style = new Array(n).fill(null)
    this.chars = new Array(n).fill(null)
    this.charZ = new Int16Array(n).fill(-1)
  }

  /** Turn on the dot at (x, y) in dot coordinates. */
  dot (x, y, style, z = 0) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y >> 2) * this.cols + (x >> 1)
    this.bits[i] |= BITS[x & 1][y & 3]
    if (z >= this.z[i]) {
      this.z[i] = z
      this.style[i] = style
    }
  }

  /**
   * Draw a line between two dot coordinates (Bresenham).
   * @param {object} [opts]
   * @param {number} [opts.from=0]  start drawing at this fraction of the line
   * @param {number} [opts.to=1]    stop drawing at this fraction of the line
   * @param {number} [opts.dash=0]  if > 1, draw only every `dash`-th dot
   */
  line (x0, y0, x1, y1, style, z = 0, opts = {}) {
    const { from = 0, to = 1, dash = 0 } = opts
    x0 = Math.round(x0); y0 = Math.round(y0)
    x1 = Math.round(x1); y1 = Math.round(y1)
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    const steps = Math.max(dx, -dy)
    const start = Math.floor(from * steps)
    const end = Math.ceil(to * steps)
    let err = dx + dy
    let x = x0
    let y = y0
    for (let i = 0; i <= steps; i++) {
      if (i >= start && i <= end && (dash <= 1 || i % dash === 0)) this.dot(x, y, style, z)
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x += sx }
      if (e2 <= dx) { err += dx; y += sy }
    }
  }

  /** Overlay a string starting at cell (col, row). Characters outside are clipped. */
  text (col, row, str, style, z = 10) {
    if (row < 0 || row >= this.rows) return
    let c = col
    for (const ch of str) {
      if (c >= 0 && c < this.cols) {
        const i = row * this.cols + c
        if (z >= this.charZ[i]) {
          this.chars[i] = ch
          this.charZ[i] = z
          this.style[i] = style
          this.z[i] = Math.max(this.z[i], z)
        }
      }
      c++
    }
  }

  /** True if any cell in [col, col+len) on `row` holds an overlay char with z >= minZ. */
  occupied (col, row, len, minZ = 0) {
    if (row < 0 || row >= this.rows) return true
    for (let c = col; c < col + len; c++) {
      if (c < 0 || c >= this.cols) return true
      if (this.charZ[row * this.cols + c] >= minZ) return true
    }
    return false
  }

  /**
   * Convert to rows of styled segments:
   *   [[{ text, style }, ...], ...]
   * Consecutive cells with the same style are merged. `style` is null for blanks.
   */
  toRows () {
    const out = []
    for (let r = 0; r < this.rows; r++) {
      const segs = []
      let cur = null
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c
        let ch = this.chars[i]
        let style = this.style[i]
        if (ch == null) {
          ch = this.bits[i] ? String.fromCharCode(0x2800 + this.bits[i]) : ' '
          if (!this.bits[i]) style = null
        }
        if (cur && cur.style === style) cur.text += ch
        else segs.push(cur = { text: ch, style })
      }
      out.push(segs)
    }
    return out
  }

  /** Plain text (no styles), handy for tests and snapshots. */
  toString () {
    return this.toRows().map(segs => segs.map(s => s.text).join('')).join('\n')
  }
}
