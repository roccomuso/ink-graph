import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceCenter,
  forceCollide
} from 'd3-force'
import { Canvas } from './canvas.js'
import { linkKey, MAX_RATE } from './model.js'

// Same hues as p2p-graph: hsl(210|120|55, 70%, 72.5%)
export const DEFAULT_COLORS = {
  me: '#88b9ea',
  seeder: '#88ea88',
  peer: '#eae288',
  link: '#6c6c6c',
  linkActive: '#b4b4b4',
  choked: '#4a4a4a',
  dim: '#3a3a3a',
  label: '#c8c8c8',
  linkLabel: '#8a8a8a'
}

const Z = { dimLink: 0, link: 1, focusLink: 2, flow: 3, linkLabel: 12, label: 15, node: 20 }

const easeOut = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Turns a GraphModel into frames. Owns the force simulation and all the
 * enter / leave / flow animations. Rendering-framework agnostic: `render()`
 * returns rows of styled text segments.
 */
export class Scene {
  constructor (opts = {}) {
    this.opts = {
      animate: true,
      labels: true,
      flow: true,
      showRates: false,
      labelMaxLength: 16,
      enterMs: 450,
      leaveMs: 450,
      linkMs: 400,
      ...opts
    }
    this.colors = { ...DEFAULT_COLORS, ...(opts.colors || {}) }
    this.nodes = new Map() // id -> view node
    this.links = new Map() // key -> view link
    this.selected = false
    this._styles = new Map()
    this.sim = forceSimulation([])
      .stop()
      .alphaDecay(0.035)
      .alphaMin(0.004)
      .velocityDecay(0.35)
    this.cols = 0
    this.rows = 0
    this.resize(opts.cols || 60, opts.rows || 16)
  }

  // ---------------------------------------------------------------- sizing

  resize (cols, rows) {
    cols = Math.max(4, cols | 0)
    rows = Math.max(3, rows | 0)
    if (cols === this.cols && rows === this.rows) return
    const oldW = this.cols * 2
    const oldH = this.rows * 4
    this.cols = cols
    this.rows = rows
    this.W = cols * 2
    this.H = rows * 4
    // keep the drawing proportionally where it was
    if (oldW && oldH) {
      for (const n of this.nodes.values()) {
        n.x = (n.x / oldW) * this.W
        n.y = (n.y / oldH) * this.H
      }
    }
    this._configure()
    this._reheat(0.3)
  }

  // -------------------------------------------------------------- syncing

  /** Diff the model against what is on screen and start animations. */
  sync (model, now = performance.now()) {
    const animate = this.opts.animate
    let topology = false

    const live = new Set()
    for (const n of model.list()) {
      live.add(n.id)
      let v = this.nodes.get(n.id)
      if (!v || v.state === 'leaving') {
        const pos = v ? { x: v.x, y: v.y } : this._spawnPoint(n.id, model)
        v = { id: n.id, x: pos.x, y: pos.y, vx: 0, vy: 0, state: 'live', bornAt: animate ? now : -Infinity }
        this.nodes.set(n.id, v)
        topology = true
      }
      v.name = n.name
      v.me = n.me
      v.seeder = n.seeder
    }
    for (const v of this.nodes.values()) {
      if (live.has(v.id) || v.state === 'leaving') continue
      topology = true
      if (animate) {
        v.state = 'leaving'
        v.leftAt = now
      } else {
        this.nodes.delete(v.id)
      }
    }

    const liveLinks = new Set()
    for (const l of model.links()) {
      const key = linkKey(l.source, l.target)
      liveLinks.add(key)
      let v = this.links.get(key)
      if (!v || v.state === 'leaving') {
        v = { key, source: l.source, target: l.target, state: 'live', bornAt: animate ? now : -Infinity }
        this.links.set(key, v)
        topology = true
      }
      v.rate = l.rate
      v.choked = l.choked
      v.label = l.label
    }
    for (const v of this.links.values()) {
      if (liveLinks.has(v.key) || v.state === 'leaving') continue
      topology = true
      if (animate) {
        v.state = 'leaving'
        v.leftAt = now
      } else {
        this.links.delete(v.key)
      }
    }

    const sel = model.selected()
    this.selected = sel && this.nodes.has(sel) ? sel : false

    if (topology) {
      this._configure()
      this._reheat(0.6)
    }
    if (!animate) this.settle()
  }

  /** Run the simulation to rest immediately (used when animate=false). */
  settle () {
    const sim = this.sim
    let guard = 1000
    while (sim.alpha() >= sim.alphaMin() && guard--) {
      sim.tick()
      this._clamp()
    }
  }

  // ------------------------------------------------------------ animation

  /**
   * Advance one frame. Returns true while something is still moving, so
   * the caller knows when it can stop its timer.
   */
  step (now = performance.now()) {
    const sim = this.sim
    let moving = false
    if (sim.alpha() >= sim.alphaMin()) {
      sim.tick()
      this._clamp()
      moving = true
    }

    const { enterMs, leaveMs, linkMs } = this.opts
    let dirty = false
    for (const v of this.nodes.values()) {
      if (v.state === 'leaving') {
        if (now - v.leftAt >= leaveMs) {
          this.nodes.delete(v.id)
          dirty = true
        } else moving = true
      } else if (now - v.bornAt < enterMs * 1.6) moving = true
    }
    for (const v of this.links.values()) {
      if (!this.nodes.has(v.source) || !this.nodes.has(v.target)) {
        this.links.delete(v.key)
        continue
      }
      if (v.state === 'leaving') {
        if (now - v.leftAt >= linkMs) {
          this.links.delete(v.key)
          dirty = true
        } else moving = true
      } else {
        if (now - v.bornAt < linkMs) moving = true
        if (this._flows(v)) moving = true
      }
    }
    if (dirty && this.selected && !this.nodes.has(this.selected)) this.selected = false
    return moving
  }

  // -------------------------------------------------------------- drawing

  /** Draw the current frame. Returns rows of `{ text, style }` segments. */
  render (now = performance.now()) {
    return this.draw(now).toRows()
  }

  /** Draw the current frame into a fresh Canvas. */
  draw (now = performance.now()) {
    const cv = new Canvas(this.cols, this.rows)
    const C = this.colors
    const { linkMs, enterMs, leaveMs } = this.opts
    const sel = this.selected
    const focus = sel ? this._focusSet(sel) : null

    // ---- links
    for (const l of this.links.values()) {
      const a = this.nodes.get(l.source)
      const b = this.nodes.get(l.target)
      if (!a || !b) continue
      let to = 1
      if (l.state === 'leaving') to = 1 - easeOut((now - l.leftAt) / linkMs)
      else to = easeOut((now - l.bornAt) / linkMs)
      if (to <= 0) continue

      const touches = sel && (l.source === sel || l.target === sel)
      const dimmed = (sel && !touches) || l.state === 'leaving'
      const color = dimmed ? C.dim : l.choked ? C.choked : l.rate > 0 ? C.linkActive : C.link
      const z = dimmed ? Z.dimLink : touches ? Z.focusLink : Z.link
      const style = this._style(color)
      const dash = l.choked ? 3 : 0
      cv.line(a.x, a.y, b.x, b.y, style, z, { to, dash })

      // thickness follows rate, like stroke-width in p2p-graph
      const rn = Math.min(l.rate || 0, MAX_RATE) / MAX_RATE
      // (capped at 2 dots wide so fast links don't turn into solid bars)
      if (!l.choked && rn > 0.5) {
        const [px, py] = perp(a, b)
        cv.line(a.x + px, a.y + py, b.x + px, b.y + py, style, z, { to })
      }

      // particles running along links that carry data
      if (this._flows(l) && to >= 1 && !(sel && !touches)) {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
        const speed = 10 + rn * 50 // dots per second
        const count = 1 + (rn > 0.33) + (rn > 0.66)
        const fstyle = this._style(this._nodeColor(a), { bold: true })
        for (let k = 0; k < count; k++) {
          const t = (((now / 1000) * speed) / len + k / count) % 1
          for (let tail = 0; tail < 3; tail++) {
            const tt = t - tail / len
            if (tt < 0) continue
            cv.dot(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt, fstyle, Z.flow)
          }
        }
      }
    }

    // ---- nodes (selected and "me" drawn last so they win overlaps)
    const order = [...this.nodes.values()].sort((p, q) => rank(p, sel) - rank(q, sel))
    const placed = []
    for (const n of order) {
      const col = clamp(Math.floor(n.x / 2), 0, this.cols - 1)
      const row = clamp(Math.floor(n.y / 4), 0, this.rows - 1)
      let glyph = n.me ? '◉' : '●'
      let progress = 1 // how much of the label to show
      let leaving = false
      if (n.state === 'leaving') {
        leaving = true
        const p = (now - n.leftAt) / leaveMs
        glyph = p < 0.33 ? glyph : p < 0.66 ? '•' : '·'
        progress = 1 - easeOut(p * 1.3)
      } else {
        const p = (now - n.bornAt) / enterMs
        if (p < 0.33) glyph = '·'
        else if (p < 0.66) glyph = '•'
        progress = easeOut((now - n.bornAt - enterMs * 0.3) / (enterMs * 1.3))
      }
      const dimmed = leaving || (focus && !focus.has(n.id))
      const style = this._style(leaving ? C.dim : this._nodeColor(n), {
        dim: !!dimmed && !leaving,
        bold: n.id === sel
      })
      cv.text(col, row, glyph, style, Z.node)
      placed.push({ n, col, row, progress, dimmed })
    }

    // ---- labels
    if (this.opts.labels) {
      for (let i = placed.length - 1; i >= 0; i--) {
        const { n, col, row, progress, dimmed } = placed[i]
        const full = truncate(n.name, this.opts.labelMaxLength)
        if (!full) continue
        const text = full.slice(0, Math.ceil(full.length * progress))
        if (!text) continue
        const style = this._style(dimmed ? C.dim : C.label, {
          bold: n.me || n.id === sel,
          inverse: n.id === sel
        })
        this._placeLabel(cv, text, full.length, col, row, style)
      }
      this._drawLinkLabels(cv, now, sel)
    }

    return cv
  }

  // -------------------------------------------------------------- queries

  /** Ids of on-screen (non-leaving) nodes in insertion order. */
  ids () {
    return [...this.nodes.values()].filter(n => n.state !== 'leaving').map(n => n.id)
  }

  /** Nearest node from `id` in a direction ('up' | 'down' | 'left' | 'right'). */
  nearest (id, dir) {
    const from = this.nodes.get(id)
    if (!from) return null
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir]
    let best = null
    let bestScore = Infinity
    for (const n of this.nodes.values()) {
      if (n.id === id || n.state === 'leaving') continue
      const vx = n.x - from.x
      const vy = n.y - from.y
      const along = vx * dx + vy * dy
      if (along <= 0) continue
      const across = Math.abs(vx * dy - vy * dx)
      const score = along + across * 2
      if (score < bestScore) { bestScore = score; best = n.id }
    }
    return best
  }

  /** Cell position of a node, or null. */
  position (id) {
    const n = this.nodes.get(id)
    return n ? { col: Math.floor(n.x / 2), row: Math.floor(n.y / 4), x: n.x, y: n.y } : null
  }

  // ------------------------------------------------------------- internals

  _flows (l) {
    return this.opts.flow && this.opts.animate && l.state !== 'leaving' && l.rate > 0 && !l.choked
  }

  _nodeColor (n) {
    return n.me ? this.colors.me : n.seeder ? this.colors.seeder : this.colors.peer
  }

  _style (color, { dim = false, bold = false, inverse = false } = {}) {
    const key = `${color}|${dim}|${bold}|${inverse}`
    let s = this._styles.get(key)
    if (!s) {
      s = Object.freeze({ color, dimColor: dim, bold, inverse })
      this._styles.set(key, s)
    }
    return s
  }

  _focusSet (sel) {
    const set = new Set([sel])
    for (const l of this.links.values()) {
      if (l.state === 'leaving') continue
      if (l.source === sel) set.add(l.target)
      if (l.target === sel) set.add(l.source)
    }
    return set
  }

  _placeLabel (cv, text, fullLen, col, row, style) {
    const len = fullLen
    const center = col - Math.floor((len - 1) / 2)
    const candidates = [
      [center, row - 1],
      [center, row + 1],
      [col + 2, row],
      [col - 1 - len, row]
    ]
    for (const [c0, r] of candidates) {
      const c = clamp(c0, 0, Math.max(0, this.cols - len))
      if (!cv.occupied(c, r, len, Z.linkLabel)) {
        cv.text(c, r, text, style, Z.label)
        return true
      }
    }
    // crowded: squeeze it above anyway as long as we don't cover a node
    const c = clamp(center, 0, Math.max(0, this.cols - len))
    const r = row > 0 ? row - 1 : row + 1
    if (!cv.occupied(c, r, len, Z.node)) {
      cv.text(c, r, text, style, Z.label)
      return true
    }
    return false
  }

  _drawLinkLabels (cv, now, sel) {
    const style = this._style(this.colors.linkLabel)
    const drawn = new Set()
    for (const l of this.links.values()) {
      if (l.state === 'leaving' || now - l.bornAt < this.opts.linkMs) continue
      if (sel && l.source !== sel && l.target !== sel) continue
      let text = l.label
      if (!text && this.opts.showRates && l.rate > 0) text = formatRate(l.rate)
      if (!text) continue
      const pair = l.source < l.target ? l.source + '\0' + l.target : l.target + '\0' + l.source
      if (drawn.has(pair)) continue // a<->b share the same spot
      const a = this.nodes.get(l.source)
      const b = this.nodes.get(l.target)
      if (!a || !b) continue
      text = truncate(text, this.opts.labelMaxLength)
      const col = Math.floor((a.x + b.x) / 4) - Math.floor(text.length / 2)
      const row = Math.floor((a.y + b.y) / 8)
      for (const r of [row, row - 1, row + 1]) {
        const c = clamp(col, 0, Math.max(0, this.cols - text.length))
        if (!cv.occupied(c, r, text.length, Z.linkLabel)) {
          cv.text(c, r, text, style, Z.linkLabel)
          drawn.add(pair)
          break
        }
      }
    }
  }

  _spawnPoint (id, model) {
    const d = this._distance()
    for (const nid of model.neighbors(id)) {
      const nb = this.nodes.get(nid)
      if (nb && nb.state !== 'leaving') {
        const angle = Math.random() * Math.PI * 2
        return { x: nb.x + Math.cos(angle) * d * 0.4, y: nb.y + Math.sin(angle) * d * 0.4 }
      }
    }
    const angle = Math.random() * Math.PI * 2
    const r = this.nodes.size ? d * (0.5 + Math.random() * 0.5) : 0
    return { x: this.W / 2 + Math.cos(angle) * r, y: this.H / 2 + Math.sin(angle) * r }
  }

  _distance () {
    const n = this.ids().length
    const scale = n < 10 ? 1 : Math.max(0.35, 1 - (n - 10) / 60)
    return clamp(Math.min(this.W, this.H * 1.6) / 3.2, 8, 48) * scale
  }

  _configure () {
    const liveNodes = [...this.nodes.values()].filter(n => n.state !== 'leaving')
    const seen = new Set()
    const simLinks = []
    for (const l of this.links.values()) {
      if (l.state === 'leaving') continue
      const a = this.nodes.get(l.source)
      const b = this.nodes.get(l.target)
      if (!a || !b || a.state === 'leaving' || b.state === 'leaving') continue
      const pair = l.source < l.target ? l.source + '\0' + l.target : l.target + '\0' + l.source
      if (seen.has(pair)) continue
      seen.add(pair)
      simLinks.push({ source: a, target: b })
    }
    const d = this._distance()
    const ratio = this.W / this.H
    this.sim
      .nodes(liveNodes)
      .force('link', forceLink(simLinks).distance(d))
      .force('charge', forceManyBody().strength(-d * 2.2).distanceMax(Math.max(this.W, this.H)))
      .force('x', forceX(this.W / 2).strength(0.03))
      .force('y', forceY(this.H / 2).strength(Math.min(0.12, 0.03 * ratio)))
      .force('collide', forceCollide(4))
      .force('center', forceCenter(this.W / 2, this.H / 2).strength(0.6))
  }

  _reheat (alpha) {
    this.sim.alpha(Math.max(this.sim.alpha(), alpha))
  }

  _clamp () {
    const top = this.opts.labels ? Math.min(4, this.H / 2) : 1
    const xMin = 1
    const xMax = Math.max(xMin, this.W - 2)
    const yMin = top
    const yMax = Math.max(yMin, this.H - 3)
    for (const n of this.sim.nodes()) {
      if (n.x < xMin) { n.x = xMin; n.vx = 0 }
      if (n.x > xMax) { n.x = xMax; n.vx = 0 }
      if (n.y < yMin) { n.y = yMin; n.vy = 0 }
      if (n.y > yMax) { n.y = yMax; n.vy = 0 }
    }
  }
}

function rank (n, sel) {
  if (n.id === sel) return 3
  if (n.me) return 2
  if (n.state === 'leaving') return 0
  return 1
}

function perp (a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  // one dot sideways; favour the axis the line runs across
  return [Math.round(-dy / len), Math.round(dx / len)]
}

function truncate (str, max) {
  if (!str) return ''
  str = String(str)
  return str.length > max ? str.slice(0, Math.max(1, max - 1)) + '…' : str
}

/** Human readable bytes/s, e.g. 1.2 MB/s */
export function formatRate (bytes) {
  const units = ['B/s', 'kB/s', 'MB/s', 'GB/s']
  let i = 0
  while (bytes >= 1000 && i < units.length - 1) { bytes /= 1000; i++ }
  return (bytes >= 10 || i === 0 ? Math.round(bytes) : bytes.toFixed(1)) + ' ' + units[i]
}
