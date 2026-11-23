import { describe, it, expect } from 'vitest'
import { GraphModel, Scene, formatRate } from '../src/index.js'

function star (n) {
  const g = new GraphModel()
  g.add({ id: 'me', name: 'You', me: true })
  for (let i = 0; i < n; i++) {
    g.add({ id: 'p' + i, name: 'peer' + i })
    g.connect('me', 'p' + i)
  }
  return g
}

describe('Scene', () => {
  it('settles immediately when animate=false and keeps nodes in bounds', () => {
    const g = star(6)
    const s = new Scene({ cols: 60, rows: 16, animate: false })
    s.sync(g, 0)
    expect(s.step(0)).toBe(false)
    for (const id of s.ids()) {
      const { col, row } = s.position(id)
      expect(col).toBeGreaterThanOrEqual(0)
      expect(col).toBeLessThan(60)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThan(16)
    }
    const out = s.draw(0).toString()
    expect(out).toContain('◉')
    expect(out).toContain('You')
    expect(out.match(/●/g)).toHaveLength(6)
    for (let i = 0; i < 6; i++) expect(out).toContain('peer' + i)
  })

  it('animates nodes in and out, then goes idle', () => {
    const g = star(2)
    const s = new Scene({ cols: 50, rows: 14 })
    let t = 0
    s.sync(g, t)
    expect(s.draw(t).toString()).toContain('·') // entering glyph
    while (s.step(t += 33) && t < 30000);
    expect(t).toBeLessThan(30000) // eventually rests
    expect(s.draw(t).toString().match(/●/g)).toHaveLength(2)

    g.remove('p0')
    s.sync(g, t)
    expect(s.nodes.get('p0').state).toBe('leaving')
    expect(s.step(t += 33)).toBe(true)
    while (s.step(t += 33) && t < 60000);
    expect(s.nodes.has('p0')).toBe(false)
    expect(s.links.size).toBe(1)
  })

  it('keeps animating while data flows', () => {
    const g = star(1)
    g.rate('me', 'p0', 1e6)
    const s = new Scene({ cols: 40, rows: 10 })
    let t = 0
    s.sync(g, t)
    for (let i = 0; i < 2000; i++) s.step(t += 33)
    expect(s.step(t += 33)).toBe(true)
    s.opts.flow = false
    expect(s.step(t += 33)).toBe(false)
  })

  it('spawns new peers next to their neighbor', () => {
    const g = star(0)
    const s = new Scene({ cols: 80, rows: 20, animate: false })
    s.sync(g)
    s.opts.animate = true
    g.add({ id: 'x' })
    g.connect('x', 'me')
    s.sync(g, 0)
    const me = s.position('me')
    const x = s.position('x')
    expect(Math.hypot(me.x - x.x, me.y - x.y)).toBeLessThan(30)
  })

  it('shows link labels and rates', () => {
    const g = star(1)
    g.labelLink('me', 'p0', 'utp')
    const s = new Scene({ cols: 60, rows: 16, animate: false })
    s.sync(g)
    expect(s.draw(0).toString()).toContain('utp')
    g.labelLink('me', 'p0', '')
    g.rate('me', 'p0', 1500000)
    s.opts.showRates = true
    s.sync(g)
    expect(s.draw(0).toString()).toContain('1.5 MB/s')
  })

  it('nearest() navigates spatially', () => {
    const g = star(0)
    g.add({ id: 'r' })
    const s = new Scene({ cols: 60, rows: 16, animate: false })
    s.sync(g)
    s.nodes.get('me').x = 10
    s.nodes.get('r').x = 100
    s.nodes.get('r').y = s.nodes.get('me').y
    expect(s.nearest('me', 'right')).toBe('r')
    expect(s.nearest('me', 'left')).toBe(null)
  })

  it('formats rates', () => {
    expect(formatRate(0)).toBe('0 B/s')
    expect(formatRate(1500)).toBe('1.5 kB/s')
    expect(formatRate(25e6)).toBe('25 MB/s')
  })
})
