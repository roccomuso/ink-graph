#!/usr/bin/env node
// Simulated BitTorrent-ish swarm: peers join, leave, seed, get choked and
// exchange data at varying speeds. Arrow keys / Tab select a peer, Esc clears,
// p pauses the simulation, q quits.
import React, { useEffect, useState } from 'react'
import { render, Box, Text, useApp, useInput, useStdout } from 'ink'
import Graph, { useGraph, formatRate } from '../src/index.js'

const h = React.createElement

const NAMES = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi',
  'ivan', 'judy', 'mallory', 'niaj', 'olivia', 'peggy', 'rupert', 'sybil', 'trent',
  'victor', 'walter', 'yolanda']

const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const MAX_PEERS = 11

function Demo () {
  const graph = useGraph()
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [cols, setCols] = useState(stdout.columns || 80)
  useEffect(() => {
    const onResize = () => setCols(stdout.columns)
    stdout.on('resize', onResize)
    return () => stdout.off('resize', onResize)
  }, [stdout])
  const [log, setLog] = useState('starting swarm…')
  const [selected, setSelected] = useState(false)
  const [paused, setPaused] = useState(false)
  const [, force] = useState(0)

  useInput((input) => {
    if (input === 'q') exit()
    if (input === 'p') setPaused(p => !p)
  })

  // bootstrap
  useEffect(() => {
    graph.add({ id: 'me', name: 'You', me: true })
    let n = 0
    const boot = setInterval(() => {
      const id = join(graph)
      setLog(`${id} joined`)
      if (++n >= 4) clearInterval(boot)
    }, 500)
    return () => clearInterval(boot)
  }, [graph])

  // random swarm activity
  useEffect(() => {
    if (paused) return
    const t = setInterval(() => {
      const msg = randomEvent(graph)
      if (msg) setLog(msg)
      force(x => x + 1)
    }, 1300)
    return () => clearInterval(t)
  }, [graph, paused])

  const peers = graph.list()
  const links = graph.links()
  const down = links.filter(l => l.target === 'me').reduce((s, l) => s + l.rate, 0)
  const up = links.filter(l => l.source === 'me').reduce((s, l) => s + l.rate, 0)
  const sel = selected && peers.find(p => p.id === selected)

  return h(Box, { flexDirection: 'column' },
    h(Box, { borderStyle: 'round', borderColor: 'gray', flexDirection: 'column' },
      h(Graph, {
        graph,
        width: cols - 2, // inside the border
        height: 18,
        interactive: true,
        showRates: !!selected,
        onSelect: setSelected
      })
    ),
    h(Box, { gap: 2, paddingX: 1 },
      h(Text, { color: '#88b9ea' }, '◉ you'),
      h(Text, { color: '#88ea88' }, '● seeder'),
      h(Text, { color: '#eae288' }, '● peer'),
      h(Text, { color: 'gray' }, '┄ choked'),
      h(Text, { dimColor: true }, `${peers.length} peers · ${links.length} links · ↓ ${formatRate(down)} ↑ ${formatRate(up)}`)
    ),
    h(Box, { paddingX: 1 },
      h(Text, { dimColor: true }, sel
        ? `selected: ${sel.name}${sel.seeder ? ' (seeding)' : ''} · neighbors: ${graph.neighbors(sel.id).join(', ') || '—'}`
        : `› ${log}${paused ? '  [paused]' : ''}`)
    ),
    h(Box, { paddingX: 1 },
      h(Text, { color: 'gray' }, '←↑↓→ / tab select · esc clear · p pause · q quit')
    )
  )
}

function join (graph) {
  const used = new Set(graph.list().map(p => p.id))
  const free = NAMES.filter(n => !used.has(n))
  if (!free.length) return null
  const id = pick(free)
  graph.add({ id, name: id })
  graph.connect('me', id)
  graph.connect(id, 'me')
  const others = graph.list().filter(p => p.id !== id && p.id !== 'me')
  if (others.length && Math.random() < 0.6) graph.connect(id, pick(others).id)
  return id
}

function randomEvent (graph) {
  const peers = graph.list().filter(p => !p.me)
  const links = graph.links()
  const r = Math.random()

  if ((r < 0.22 && peers.length < MAX_PEERS) || peers.length < 3) {
    const id = join(graph)
    return id && `${id} joined the swarm`
  }
  if (r < 0.34 && peers.length > 4) {
    const p = pick(peers)
    graph.remove(p.id)
    return `${p.name} left`
  }
  if (r < 0.42 && peers.length) {
    const p = pick(peers)
    graph.seed(p.id, !p.seeder)
    return `${p.name} ${p.seeder ? 'stopped seeding' : 'is now seeding'}`
  }
  if (r < 0.52 && links.length) {
    const l = pick(links)
    l.choked ? graph.unchoke(l.source, l.target) : graph.choke(l.source, l.target)
    return `${l.source} ${l.choked ? 'unchoked' : 'choked'} ${l.target}`
  }
  if (r < 0.62 && peers.length > 2) {
    const a = pick(peers)
    const b = pick(peers.filter(p => p.id !== a.id))
    if (!graph.hasLink(a.id, b.id)) {
      graph.connect(a.id, b.id)
      return `${a.name} connected to ${b.name}`
    }
    return null
  }
  if (r < 0.68 && links.length > peers.length + 2) {
    const l = pick(links.filter(l => l.source !== 'me' && l.target !== 'me')) || null
    if (l) {
      graph.disconnect(l.source, l.target)
      return `${l.source} disconnected from ${l.target}`
    }
  }
  // shuffle transfer rates
  for (const l of links) {
    if (Math.random() < 0.5) {
      const speed = Math.random() < 0.3 ? 0 : Math.round(Math.random() ** 2 * 2.5e6)
      graph.rate(l.source, l.target, speed)
    }
  }
  return 'transfer rates updated'
}

render(h(Demo))
