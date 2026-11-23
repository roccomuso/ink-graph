import { describe, it, expect } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import Graph, { GraphModel } from '../src/index.js'

const h = React.createElement
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))

describe('<Graph />', () => {
  it('renders declarative nodes and links', async () => {
    const nodes = [{ id: 'me', name: 'You', me: true }, { id: 'b', name: 'bob' }]
    const links = [{ source: 'me', target: 'b' }]
    const { lastFrame, unmount } = render(h(Graph, { nodes, links, width: 40, height: 10, animate: false }))
    await tick()
    const out = lastFrame()
    expect(out).toContain('You')
    expect(out).toContain('bob')
    expect(out).toContain('◉')
    expect(out.split('\n')).toHaveLength(10)
    unmount()
  })

  it('follows an external GraphModel (p2p-graph style)', async () => {
    const graph = new GraphModel()
    const { lastFrame, unmount } = render(h(Graph, { graph, width: 40, height: 10, animate: false }))
    graph.add({ id: 'a', name: 'alpha', me: true })
    graph.add({ id: 'b', name: 'beta' })
    graph.connect('a', 'b')
    await tick()
    expect(lastFrame()).toContain('beta')
    graph.remove('b')
    await tick()
    expect(lastFrame()).not.toContain('beta')
    graph.destroy()
    await tick()
    expect(lastFrame()).toBe('')
    unmount()
  })

  it('animates when enabled', async () => {
    const graph = new GraphModel()
    graph.add({ id: 'a', name: 'alpha' })
    const { frames, unmount } = render(h(Graph, { graph, width: 30, height: 8, fps: 60 }))
    await tick(300)
    expect(new Set(frames).size).toBeGreaterThan(2)
    unmount()
  })

  it('exposes the model through ref', async () => {
    const ref = React.createRef()
    const { lastFrame, unmount } = render(h(Graph, { ref, width: 30, height: 8, animate: false }))
    await tick()
    ref.current.add({ id: 'z', name: 'zed' })
    await tick()
    expect(lastFrame()).toContain('zed')
    unmount()
  })
})
