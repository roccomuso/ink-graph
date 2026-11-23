import { describe, it, expect, vi } from 'vitest'
import { GraphModel } from '../src/index.js'

function sample () {
  const g = new GraphModel()
  g.add({ id: 'a', name: 'A', me: true })
  g.add({ id: 'b', name: 'B' })
  g.add({ id: 'c', name: 'C' })
  return g
}

describe('GraphModel (p2p-graph API)', () => {
  it('adds peers and rejects duplicates', () => {
    const g = sample()
    expect(g.hasPeer('a', 'b', 'c')).toBe(true)
    expect(g.hasPeer('a', 'z')).toBe(false)
    expect(() => g.add({ id: 'a' })).toThrow('add: cannot add duplicate node')
    expect(g.list()).toEqual([
      { id: 'a', name: 'A', me: true, seeder: false },
      { id: 'b', name: 'B', me: false, seeder: false },
      { id: 'c', name: 'C', me: false, seeder: false }
    ])
  })

  it('connects with direction', () => {
    const g = sample()
    g.connect('a', 'b')
    expect(g.hasLink('a', 'b')).toBe(true)
    expect(g.hasLink('b', 'a')).toBe(false)
    expect(g.areConnected('b', 'a')).toMatchObject({ source: 'a', target: 'b' })
    expect(g.areConnected('b', 'c')).toBe(null)
    expect(() => g.connect('a', 'b')).toThrow('connect: cannot make duplicate connection')
    expect(() => g.connect('x', 'b')).toThrow('connect: invalid source id')
    expect(() => g.connect('a', 'x')).toThrow('connect: invalid target id')
  })

  it('disconnects', () => {
    const g = sample()
    g.connect('a', 'b')
    g.disconnect('a', 'b')
    expect(g.hasLink('a', 'b')).toBe(false)
    expect(() => g.disconnect('a', 'b')).toThrow('disconnect: connection does not exist')
  })

  it('remove() also drops attached links', () => {
    const g = sample()
    g.connect('a', 'b')
    g.connect('c', 'b')
    g.connect('a', 'c')
    g.remove('b')
    expect(g.hasPeer('b')).toBe(false)
    expect(g.links()).toEqual([expect.objectContaining({ source: 'a', target: 'c' })])
    expect(() => g.remove('b')).toThrow('remove: node does not exist')
  })

  it('seed, rate, choke, unchoke, labels', () => {
    const g = sample()
    g.connect('a', 'b')
    g.seed('b', true)
    expect(g.list()[1].seeder).toBe(true)
    expect(() => g.seed('b', 'yes')).toThrow('seed: 2nd param must be a boolean')
    g.rate('a', 'b', 1000)
    expect(g.getLink('a', 'b').rate).toBe(1000)
    expect(() => g.rate('a', 'b', -1)).toThrow('rate: 3rd param must be a positive number')
    expect(() => g.rate('b', 'a', 1)).toThrow('rate: connection does not exist')
    g.choke('a', 'b')
    expect(g.getLink('a', 'b').choked).toBe(true)
    g.unchoke('a', 'b')
    expect(g.getLink('a', 'b').choked).toBe(false)
    g.rename('b', 'Bobby')
    expect(g.list()[1].name).toBe('Bobby')
    g.labelLink('a', 'b', 'utp')
    expect(g.getLink('a', 'b').label).toBe('utp')
  })

  it('emits change and select events', () => {
    const g = sample()
    const change = vi.fn()
    const select = vi.fn()
    g.on('change', change)
    g.on('select', select)
    g.connect('a', 'b')
    expect(change).toHaveBeenCalledTimes(1)
    g.select('b')
    expect(select).toHaveBeenLastCalledWith('b')
    expect(g.selected()).toBe('b')
    g.remove('b')
    expect(select).toHaveBeenLastCalledWith(false)
  })

  it('neighbors() ignores direction', () => {
    const g = sample()
    g.connect('a', 'b')
    g.connect('c', 'a')
    expect(g.neighbors('a').sort()).toEqual(['b', 'c'])
  })

  it('destroy() emits once and detaches listeners', () => {
    const g = sample()
    const d = vi.fn()
    g.on('destroy', d)
    g.destroy()
    g.destroy()
    expect(d).toHaveBeenCalledTimes(1)
    expect(g.destroyed).toBe(true)
    expect(g.listenerCount('destroy')).toBe(0)
  })
})
