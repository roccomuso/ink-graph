# ink-graph

> Animated force-directed network graph for [Ink](https://github.com/vadimdemedes/ink): [p2p-graph](https://github.com/feross/p2p-graph), but in your terminal.

```
╭────────────────────────────────────────────────────────────────────────────────────────╮
│                                                 alice                                  │
│                                                  ⢀●                                    │
│                          olivia                 ⡸                                      │
│                            ●                   ⢀⠇                                      │
│                             ⠉⠒⢄⡀               ⡸                                       │
│                                ⠈⠑⠤⣀           ⢀⠇                                       │
│                                    ⠑⠢⢄        ⡸                                        │
│                                       ⠉⠒⢄⡀ You⠇                                        │
│                                          ⠈⠑⠤◉⡸                 erin                    │
│                                           ⣀⠤⠒⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠓⠒⠒⠒⠒⠒⠒⠒⠒●⠂                     │
│                                       ⢀⡠⠒⠉                                             │
│                           ivan ⣀⠤⠊⠁                                                    │
│                            ●⠤⠒⠉                                                        │
╰────────────────────────────────────────────────────────────────────────────────────────╯
```

- **Braille rendering.** Every terminal cell is a 2×4 dot grid, so edges are smooth lines, not `/` and `\`.
- **Live force layout** from [d3-force](https://github.com/d3/d3-force). Nodes repel, links pull, and the graph re-settles when it changes.
- **Animations.** New peers pop out of the node they connect to and their label types itself in. Peers that leave shrink away. Links grow from source to target and retract on disconnect. Links that carry data show particles flowing along them, thicker and faster with higher rates.
- **The p2p-graph API:** `add`, `remove`, `connect`, `disconnect`, `seed`, `rate`, `choke`, `unchoke`, `hasPeer`, `hasLink`, `areConnected`, `list`, `destroy` and the `select` event.
- **Labels** on nodes (automatically placed so they don't overlap) and on links.
- **Keyboard navigation.** Arrow keys move to the nearest node in that direction. Tab cycles through nodes, and Esc clears the selection. Selecting a node dims everything except its neighbourhood.
- Idle when nothing moves: the render loop stops as soon as the layout is at rest.

## Install

```sh
npm install ink-graph ink react
```

## Demo

```sh
npm run demo
```

A simulated swarm where peers join, leave, seed, choke and transfer data. Use ←↑↓→ / Tab to select, Esc to clear, `p` to pause and `q` to quit.

## Usage

### Imperative (p2p-graph style)

```js
import React from 'react'
import { render } from 'ink'
import Graph, { GraphModel } from 'ink-graph'

const graph = new GraphModel()

render(React.createElement(Graph, { graph, height: 16, interactive: true }))

graph.on('select', id => { /* id or false */ })

graph.add({ id: 'me', name: 'You', me: true })
graph.add({ id: 'peer1', name: 'Another peer' })
graph.connect('me', 'peer1')
graph.rate('me', 'peer1', 1.5e6) // bytes/s: thicker line + flowing particles
graph.seed('peer1', true)        // green node
graph.choke('me', 'peer1')       // dim, dotted link
graph.unchoke('me', 'peer1')
graph.disconnect('me', 'peer1')
graph.remove('peer1')
```

Inside a component, `useGraph()` returns a model that lives as long as the component does:

```jsx
import Graph, { useGraph } from 'ink-graph'

function Swarm () {
  const graph = useGraph()
  useEffect(() => {
    graph.add({ id: 'me', name: 'You', me: true })
  }, [])
  return <Graph graph={graph} />
}
```

You can also skip creating the model yourself and get the component's own model through `ref`:

```jsx
const ref = useRef()
// ref.current.add({ id: 'x' })
<Graph ref={ref} />
```

### Declarative

```jsx
<Graph
  nodes={[
    { id: 'me', name: 'You', me: true },
    { id: 'b', name: 'bob', seeder: true }
  ]}
  links={[
    { source: 'me', target: 'b', rate: 500000, label: 'utp' }
  ]}
/>
```

When the arrays change, the graph diffs them and animates only what changed.

## `<Graph />` props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `graph` | `GraphModel` | internal | The model to render. |
| `ref` | ref | | Receives the `GraphModel`. |
| `nodes` / `links` | arrays | | Declarative alternative to the imperative API. |
| `width` | number | terminal columns | Width in cells. Pass it explicitly when the graph is inside a border or padding. |
| `height` | number | `min(20, rows - 2)` | Height in cells. |
| `animate` | boolean | `true` | `false` lays out instantly and renders static frames. |
| `fps` | number | `30` | Frame rate while something is moving. |
| `labels` | boolean | `true` | Show node and link labels. |
| `labelMaxLength` | number | `16` | Longer labels are truncated with `…`. |
| `flow` | boolean | `true` | Particles along links with `rate > 0`. |
| `showRates` | boolean | `false` | Show the transfer speed (e.g. `1.5 MB/s`) on every link with `rate > 0`. A link's own `label` takes precedence over its speed. |
| `interactive` | boolean | `false` | Enable keyboard selection. |
| `onSelect` | `(id \| false) => void` | | Called when the selection changes. |
| `colors` | object | see below | Override any of `me`, `seeder`, `peer`, `link`, `linkActive`, `choked`, `dim`, `label`, `linkLabel`. |

The default colours match p2p-graph: `me` is blue `#88b9ea`, seeders are green `#88ea88` and peers are yellow `#eae288`.

### Link labels

Links can show either a text label or their transfer speed:

```js
graph.connect('me', 'bob', { label: 'utp' }) // set when connecting…
graph.labelLink('me', 'bob', 'tcp')          // …or later ('' clears it)
```

```jsx
<Graph graph={graph} showRates />  // every link with rate > 0 shows e.g. "1.5 MB/s"
```

- If a link has both a `label` and a rate, the label is shown.
- With no selection, all link labels are visible. While a node is selected, only its own links keep their labels, so the focused neighbourhood stays readable.
- `labels={false}` hides node and link labels alike.

## `GraphModel` API

All methods throw the same errors as p2p-graph on invalid ids, and return the model so calls can be chained.

| Method | |
| --- | --- |
| `add({ id, name?, me?, seeder? })` | Add a peer. |
| `remove(id)` | Remove a peer **and its links**. |
| `connect(source, target, { label? })` | Add a directed link. |
| `disconnect(source, target)` | Remove a directed link. |
| `seed(id, isSeeding)` | Toggle seeder colour. |
| `rate(source, target, bytesPerSec)` | Set link speed. Above ~1 MB/s the line doubles in width; up to 2 MB/s it sets particle speed. |
| `choke(source, target)` / `unchoke(...)` | Dim and dot a link, or restore it. |
| `rename(id, name)` | Change a node label. |
| `labelLink(source, target, text)` | Set (or clear with `''`) a link label. |
| `select(id \| false)` / `selected()` | Focus a node programmatically. |
| `hasPeer(...ids)` | `true` if all exist. |
| `hasLink(source, target)` | Direction-sensitive. |
| `areConnected(a, b)` | Link object in either direction, or `null`. |
| `getLink(source, target)` | Link object or `null`. |
| `neighbors(id)` | Ids linked in either direction. |
| `list()` / `links()` | Snapshots of nodes and links. |
| `destroy()` | Unmounts the drawing and removes listeners. |

Events: `change`, `select` (`id` or `false`) and `destroy`.

### Differences from p2p-graph

- `remove()` also removes links attached to the peer (p2p-graph leaves them dangling).
- `getLink()` takes ids, as its README says, not array indices.
- `choke`/`unchoke` actually do something: the link becomes dim and dotted.
- Neighbour highlighting on selection works.

## Lower-level building blocks

`Scene` (layout, animation and drawing, independent of the rendering framework) and `Canvas` (the Braille canvas) are exported too, in case you want to draw a graph somewhere other than an Ink component.

```js
import { GraphModel, Scene } from 'ink-graph'
const scene = new Scene({ cols: 60, rows: 15, animate: false })
scene.sync(model)
console.log(scene.draw().toString())
```

## Tips

- Braille needs a font that includes the U+2800 block. Practically all modern terminal fonts do.
- Terminal resolution is limited, so graphs stay readable up to roughly 25–30 nodes. Beyond that, consider `labels={false}`.

## License

Rocco Musolino - MIT
