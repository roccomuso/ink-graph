import { describe, it, expect } from 'vitest'
import { Canvas } from '../src/index.js'

describe('Canvas', () => {
  it('maps dots to braille bits', () => {
    const c = new Canvas(1, 1)
    c.dot(0, 0)
    expect(c.toString()).toBe('⠁')
    c.dot(1, 3)
    expect(c.toString()).toBe(String.fromCharCode(0x2800 | 0x01 | 0x80))
  })

  it('draws lines and partial lines', () => {
    const full = new Canvas(4, 1)
    full.line(0, 0, 7, 0)
    expect(full.toString()).toBe('⠉⠉⠉⠉')
    const half = new Canvas(4, 1)
    half.line(0, 0, 7, 0, null, 0, { to: 0.5 })
    expect(half.toString()).toBe('⠉⠉⠁ ')
  })

  it('overlays text by z order and clips', () => {
    const c = new Canvas(5, 1)
    c.line(0, 0, 9, 0)
    c.text(3, 0, 'abc', null, 10)
    c.text(3, 0, 'X', null, 5)
    expect(c.toString()).toBe('⠉⠉⠉ab')
    expect(c.occupied(0, 0, 2)).toBe(false)
    expect(c.occupied(3, 0, 1)).toBe(true)
  })

  it('merges equal styles into segments', () => {
    const red = { color: 'red' }
    const c = new Canvas(4, 1)
    c.text(0, 0, 'ab', red)
    c.text(3, 0, 'c', red)
    expect(c.toRows()[0]).toEqual([
      { text: 'ab', style: red },
      { text: ' ', style: null },
      { text: 'c', style: red }
    ])
  })
})
