#!/usr/bin/env python3
import json, re, subprocess, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
data = json.loads((root / 'provenance/repo-capabilities.json').read_text())
assert data['schema'] == 'nsite-loopy-public-provenance/1'
assert len(data['entries']) == data['summary']['entries']
checks = [r for r in data['entries'] if r['disposition'].startswith('adopted') or r['disposition'].startswith('already-covered')]
assert all(r['source_url'].startswith('https://github.com/br3avery-maker/') for r in data['entries'])
for r in checks:
    assert '.' in r['sdk_contract'], r
ns = {r['sdk_contract'].split('.')[0] for r in checks}
js = (
    "import * as m from './src/index.js'; const keys="
    + json.dumps([r['sdk_contract'] for r in checks])
    + "; for(const k of keys){const [ns,name]=k.split('.');if(typeof m[ns]?.[name]==='undefined')throw Error('Missing '+k)}"
)
p = subprocess.run(['node', '--input-type=module', '-e', js], cwd=root, capture_output=True, text=True)
assert p.returncode == 0, p.stderr

# Enforce strict acyclic layer DAG across src/<layer>/**/*.js (excluding top-level src/index.js facade)
IMPORT_RE = re.compile(r"""(?:import|export)\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)""")
src_root = root / 'src'
layer_edges = {}
for path in sorted(src_root.rglob('*.js')):
    rel = path.relative_to(src_root)
    if len(rel.parts) < 2:
        continue
    src_layer = rel.parts[0]
    layer_edges.setdefault(src_layer, set())
    text = path.read_text(encoding='utf-8')
    for m in IMPORT_RE.finditer(text):
        spec = m.group(1) or m.group(2)
        if not spec or not spec.startswith('.'):
            continue
        resolved = (path.parent / spec).resolve()
        try:
            target_rel = resolved.relative_to(src_root)
        except ValueError:
            continue
        if len(target_rel.parts) >= 2:
            dst_layer = target_rel.parts[0]
            if dst_layer != src_layer:
                layer_edges[src_layer].add(dst_layer)

# DFS cycle detection over layer_edges
state = {}  # 0=unvisited, 1=visiting, 2=done
cycles = []

def dfs(node, stack):
    state[node] = 1
    for nxt in sorted(layer_edges.get(node, ())):
        if state.get(nxt, 0) == 1:
            idx = stack.index(nxt)
            cycles.append(stack[idx:] + [nxt])
        elif state.get(nxt, 0) == 0:
            dfs(nxt, stack + [nxt])
    state[node] = 2

for layer in sorted(layer_edges):
    if state.get(layer, 0) == 0:
        dfs(layer, [layer])

assert not cycles, f'Layer import cycles detected: {cycles}'

print(
    json.dumps(
        {
            'status': 'PASS',
            'source_module_records': len(data['entries']),
            'adopted_or_existing_contracts_checked': len(checks),
            'namespaces': sorted(ns),
            'layer_dag': 'acyclic',
            'layers_checked': len(layer_edges),
        }
    )
)
