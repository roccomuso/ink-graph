import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { GraphModel } from './model.js'
import { Scene, DEFAULT_COLORS } from './scene.js'

const h = React.createElement

/** Create a GraphModel that lives as long as the calling component. */
export function useGraph () {
  const ref = useRef(null)
  if (!ref.current) ref.current = new GraphModel()
  return ref.current
}

function useTerminalSize () {
  const { stdout } = useStdout()
  const read = () => ({ columns: stdout?.columns || 80, rows: stdout?.rows || 24 })
  const [size, setSize] = useState(read)
  useEffect(() => {
    if (!stdout?.on) return
    const onResize = () => setSize(read())
    stdout.on('resize', onResize)
    return () => stdout.off('resize', onResize)
  }, [stdout])
  return size
}

/**
 * <Graph /> — animated force-directed network graph for Ink.
 *
 * Drive it imperatively (p2p-graph style) through a GraphModel passed as
 * `graph`, obtained with `useGraph()` or via `ref`; or declaratively with
 * `nodes` / `links` props.
 */
export default function Graph (props) {
  const {
    graph: externalGraph,
    ref,
    nodes,
    links,
    width,
    height,
    fps = 30,
    animate = true,
    labels = true,
    labelMaxLength = 16,
    flow = true,
    showRates = false,
    colors,
    interactive = false,
    onSelect
  } = props

  const ownGraph = useGraph()
  const graph = externalGraph || ownGraph
  useImperativeHandle(ref, () => graph, [graph])

  const term = useTerminalSize()
  const cols = Math.max(4, width ?? term.columns)
  const rows = Math.max(3, height ?? Math.max(6, Math.min(20, term.rows - 2)))

  const scene = useMemo(() => new Scene({ cols, rows, animate }), [graph]) // eslint-disable-line react-hooks/exhaustive-deps
  Object.assign(scene.opts, { animate, labels, labelMaxLength, flow, showRates })
  const colorsKey = JSON.stringify(colors || {})
  scene.colors = { ...DEFAULT_COLORS, ...(colors || {}) }

  const live = useRef({})
  live.current.onSelect = onSelect
  live.current.fps = fps
  live.current.animate = animate

  const [frame, setFrame] = useState(() => {
    scene.sync(graph)
    scene.step()
    return scene.render()
  })
  const [destroyed, setDestroyed] = useState(graph.destroyed)

  // ---- the frame loop: runs only while something is moving
  const loop = useMemo(() => {
    let timer = null
    let dirty = true
    const tick = () => {
      const now = performance.now()
      if (dirty) {
        dirty = false
        scene.sync(graph, now)
      }
      const moving = scene.step(now)
      setFrame(scene.render(now))
      return moving
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const wake = (changed) => {
      if (changed) dirty = true
      if (graph.destroyed) return
      if (!live.current.animate) {
        stop()
        tick()
        return
      }
      if (timer) return
      timer = setInterval(() => { if (!tick()) stop() }, Math.max(8, 1000 / live.current.fps))
    }
    return { wake, stop }
  }, [graph, scene])

  useEffect(() => {
    const onChange = () => loop.wake(true)
    const onSel = id => live.current.onSelect?.(id)
    const onDestroy = () => {
      loop.stop()
      setDestroyed(true)
    }
    graph.on('change', onChange)
    graph.on('select', onSel)
    graph.on('destroy', onDestroy)
    loop.wake(true)
    return () => {
      loop.stop()
      graph.off('change', onChange)
      graph.off('select', onSel)
      graph.off('destroy', onDestroy)
    }
  }, [graph, loop])

  // size / option changes just need a redraw (resize also reheats the layout)
  useEffect(() => {
    scene.resize(cols, rows)
    loop.wake(false)
  }, [cols, rows, animate, labels, labelMaxLength, flow, showRates, fps, colorsKey, scene, loop])

  // ---- declarative API
  useEffect(() => {
    if (!nodes && !links) return
    reconcile(graph, nodes || [], links || [])
  }, [graph, nodes, links])

  // ---- keyboard navigation
  useInput((input, key) => {
    const ids = scene.ids()
    if (!ids.length) return
    const cur = graph.selected()
    if (key.escape) return graph.select(false)
    if (key.tab) {
      const i = cur ? ids.indexOf(cur) : -1
      const next = key.shift ? (i <= 0 ? ids.length - 1 : i - 1) : (i + 1) % ids.length
      return graph.select(ids[next])
    }
    const dir = key.upArrow ? 'up' : key.downArrow ? 'down' : key.leftArrow ? 'left' : key.rightArrow ? 'right' : null
    if (!dir) return
    if (!cur) {
      const me = graph.list().find(n => n.me)
      return graph.select(me ? me.id : ids[0])
    }
    const next = scene.nearest(cur, dir)
    if (next) graph.select(next)
  }, { isActive: interactive })

  if (destroyed) return null

  return h(
    Box,
    { flexDirection: 'column', width: cols, height: rows, flexShrink: 0 },
    frame.map((segs, i) =>
      h(Text, { key: i, wrap: 'truncate-end' },
        segs.map((s, j) => (s.style ? h(Text, { key: j, ...s.style }, s.text) : s.text))
      )
    )
  )
}

/** Make `graph` match the declarative `nodes` / `links` props. */
function reconcile (graph, nodes, links) {
  const want = new Map(nodes.map(n => [String(n.id), n]))
  for (const n of graph.list()) {
    const w = want.get(n.id)
    if (!w || !!w.me !== n.me) graph.remove(n.id)
  }
  for (const [id, n] of want) {
    if (!graph.hasPeer(id)) graph.add({ id, name: n.name, me: n.me, seeder: n.seeder })
    else {
      const cur = graph.list().find(x => x.id === id)
      if ((n.name ?? '') !== cur.name) graph.rename(id, n.name)
      if (!!n.seeder !== cur.seeder) graph.seed(id, !!n.seeder)
    }
  }

  const key = (s, t) => String(s) + '\0' + String(t)
  const wantLinks = new Map()
  for (const l of links) {
    if (want.has(String(l.source)) && want.has(String(l.target))) wantLinks.set(key(l.source, l.target), l)
  }
  for (const l of graph.links()) {
    if (!wantLinks.has(key(l.source, l.target))) graph.disconnect(l.source, l.target)
  }
  for (const l of wantLinks.values()) {
    const cur = graph.getLink(l.source, l.target)
    if (!cur) graph.connect(l.source, l.target, { label: l.label })
    if ((l.rate || 0) !== (cur?.rate || 0)) graph.rate(l.source, l.target, l.rate || 0)
    if (!!l.choked !== !!cur?.choked) l.choked ? graph.choke(l.source, l.target) : graph.unchoke(l.source, l.target)
    if (cur && (l.label ?? '') !== cur.label) graph.labelLink(l.source, l.target, l.label)
  }
}
