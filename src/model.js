import { EventEmitter } from 'node:events'

const MAX_RATE = 2097152 // 2 MB/s => full thickness, same scale as p2p-graph

/**
 * Pure data model of the graph. API-compatible with feross/p2p-graph
 * (add, remove, connect, disconnect, choke, unchoke, seed, rate, ...),
 * plus a few terminal-specific extras (rename, labelLink, select).
 *
 * Emits:
 *  - 'change'  whenever nodes / links / their state change
 *  - 'select'  (id | false) when the focused node changes
 *  - 'destroy' once, when destroy() is called
 */
export class GraphModel extends EventEmitter {
  constructor () {
    super()
    this._nodes = new Map() // id -> node
    this._links = new Map() // "source\0target" -> link
    this._selected = false
    this._destroyed = false
    this.version = 0
  }

  // ---------------------------------------------------------------- nodes

  /**
   * Add a peer.
   * @param {{id: string, name?: string, me?: boolean, seeder?: boolean}} peer
   */
  add (peer) {
    if (!peer || peer.id == null) throw new Error('add: peer must have an id')
    const id = String(peer.id)
    if (this._nodes.has(id)) throw new Error('add: cannot add duplicate node')
    this._nodes.set(id, {
      id,
      name: peer.name != null ? String(peer.name) : '',
      me: !!peer.me,
      seeder: !!peer.seeder
    })
    return this._changed()
  }

  /** Remove a peer and every link attached to it. */
  remove (id) {
    id = String(id)
    if (!this._nodes.has(id)) throw new Error('remove: node does not exist')
    this._nodes.delete(id)
    for (const [key, link] of this._links) {
      if (link.source === id || link.target === id) this._links.delete(key)
    }
    if (this._selected === id) this._setSelected(false)
    return this._changed()
  }

  /** Change the label of a peer. */
  rename (id, name) {
    const node = this._node(id, 'rename')
    node.name = name != null ? String(name) : ''
    return this._changed()
  }

  /** Mark a peer as seeding (green) or not. */
  seed (id, isSeeding) {
    if (typeof isSeeding !== 'boolean') throw new Error('seed: 2nd param must be a boolean')
    const node = this._node(id, 'seed')
    node.seeder = isSeeding
    return this._changed()
  }

  /** True if every given id exists. */
  hasPeer (...ids) {
    return ids.every(id => this._nodes.has(String(id)))
  }

  /** Snapshot of all peers. */
  list () {
    return [...this._nodes.values()].map(n => ({ ...n }))
  }

  /** Ids of the peers linked to `id`, in either direction. */
  neighbors (id) {
    id = String(id)
    const out = new Set()
    for (const l of this._links.values()) {
      if (l.source === id) out.add(l.target)
      else if (l.target === id) out.add(l.source)
    }
    return [...out]
  }

  // ---------------------------------------------------------------- links

  /** Create a directed link source -> target. */
  connect (sourceId, targetId, opts = {}) {
    const [s, t] = this._ends(sourceId, targetId, 'connect')
    const key = linkKey(s, t)
    if (this._links.has(key)) throw new Error('connect: cannot make duplicate connection')
    this._links.set(key, {
      source: s,
      target: t,
      rate: 0,
      choked: false,
      label: opts.label != null ? String(opts.label) : ''
    })
    return this._changed()
  }

  /** Remove the directed link source -> target. */
  disconnect (sourceId, targetId) {
    const [s, t] = this._ends(sourceId, targetId, 'disconnect')
    if (!this._links.delete(linkKey(s, t))) throw new Error('disconnect: connection does not exist')
    return this._changed()
  }

  /** Link object for source -> target (direction matters), or null. */
  getLink (sourceId, targetId) {
    const l = this._links.get(linkKey(String(sourceId), String(targetId)))
    return l ? { ...l } : null
  }

  /** True if the directed link source -> target exists. */
  hasLink (sourceId, targetId) {
    const [s, t] = this._ends(sourceId, targetId, 'hasLink')
    return this._links.has(linkKey(s, t))
  }

  /** Link object if the two peers are connected in either direction, else null. */
  areConnected (id1, id2) {
    const [a, b] = this._ends(id1, id2, 'areConnected')
    return this.getLink(a, b) || this.getLink(b, a)
  }

  /** Every link as a snapshot. */
  links () {
    return [...this._links.values()].map(l => ({ ...l }))
  }

  /** Set the transfer speed (bytes/s) of a link: drives thickness and flow animation. */
  rate (sourceId, targetId, speed) {
    if (typeof speed !== 'number' || !(speed >= 0)) throw new Error('rate: 3rd param must be a positive number')
    const link = this._link(sourceId, targetId, 'rate')
    link.rate = speed
    return this._changed()
  }

  /** Mark a link as choked (drawn dim and dotted). */
  choke (sourceId, targetId) {
    this._link(sourceId, targetId, 'choke').choked = true
    return this._changed()
  }

  /** Mark a link as unchoked. */
  unchoke (sourceId, targetId) {
    this._link(sourceId, targetId, 'unchoke').choked = false
    return this._changed()
  }

  /** Set (or clear, with '') a text label drawn at the middle of a link. */
  labelLink (sourceId, targetId, text) {
    this._link(sourceId, targetId, 'labelLink').label = text != null ? String(text) : ''
    return this._changed()
  }

  // ------------------------------------------------------------ selection

  /** Focus a peer (dims the rest of the graph), or pass false to clear. */
  select (id) {
    if (id === false || id == null) return this._setSelected(false)
    this._node(id, 'select')
    return this._setSelected(String(id))
  }

  /** Currently focused peer id, or false. */
  selected () {
    return this._selected
  }

  // ------------------------------------------------------------- lifecycle

  /** Stop rendering and drop all listeners. */
  destroy () {
    if (this._destroyed) return
    this._destroyed = true
    this.emit('destroy')
    this.removeAllListeners()
  }

  get destroyed () {
    return this._destroyed
  }

  // ------------------------------------------------------------- internals

  _setSelected (id) {
    if (this._selected === id) return this
    this._selected = id
    this.emit('select', id)
    return this._changed()
  }

  _node (id, method) {
    const node = this._nodes.get(String(id))
    if (!node) throw new Error(`${method}: node does not exist`)
    return node
  }

  _ends (sourceId, targetId, method) {
    const s = String(sourceId)
    const t = String(targetId)
    if (!this._nodes.has(s)) throw new Error(`${method}: invalid source id`)
    if (!this._nodes.has(t)) throw new Error(`${method}: invalid target id`)
    return [s, t]
  }

  _link (sourceId, targetId, method) {
    const [s, t] = this._ends(sourceId, targetId, method)
    const link = this._links.get(linkKey(s, t))
    if (!link) throw new Error(`${method}: connection does not exist`)
    return link
  }

  _changed () {
    this.version++
    if (!this._destroyed) this.emit('change')
    return this
  }
}

export function linkKey (source, target) {
  return source + '\0' + target
}

export { MAX_RATE }
