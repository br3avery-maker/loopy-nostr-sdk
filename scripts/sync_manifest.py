#!/usr/bin/env python3
"""Sync and verify provenance/manifest.json pins, docs/API_INDEX.json, and TypeScript declarations.

Usage:
  python3 scripts/sync_manifest.py --check
  python3 scripts/sync_manifest.py --write
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / 'provenance' / 'manifest.json'
API_INDEX_PATH = ROOT / 'docs' / 'API_INDEX.json'
TYPES_INDEX_PATH = ROOT / 'types' / 'index.d.ts'
INTEL_TYPES_DIR = ROOT / 'types' / 'intelligence'


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def discover_src_modules() -> list[str]:
    return sorted(
        p.relative_to(ROOT).as_posix()
        for p in (ROOT / 'src').rglob('*.js')
        if p.is_file()
    )


def inspect_runtime_exports() -> dict[str, list[dict[str, str]]]:
    script = (
        "import * as m from './src/index.js';"
        "const out = {};"
        "for (const [ns, val] of Object.entries(m)) {"
        "  if (val && typeof val === 'object') {"
        "    out[ns] = Object.keys(val).sort().map(name => ({"
        "      name, kind: typeof val[name] === 'function' ? 'function' : 'constant'"
        "    }));"
        "  }"
        "}"
        "console.log(JSON.stringify(out));"
    )
    proc = subprocess.run(
        ['node', '--input-type=module', '-e', script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(proc.stdout)


def extract_dts_symbols() -> dict[str, set[str]]:
    text = TYPES_INDEX_PATH.read_text(encoding='utf-8')
    namespaces: dict[str, set[str]] = {}
    for match in re.finditer(r'export namespace (\w+)\s*\{([\s\S]*?)^\}', text, re.MULTILINE):
        ns = match.group(1)
        body = match.group(2)
        names = set(re.findall(r'^\s*(?:function|const)\s+([A-Za-z0-9_]+)', body, re.MULTILINE))
        namespaces[ns] = names

    intel_names: set[str] = set()
    if INTEL_TYPES_DIR.is_dir():
        for dts in sorted(INTEL_TYPES_DIR.glob('*.d.ts')):
            content = dts.read_text(encoding='utf-8')
            intel_names.update(
                re.findall(r'export declare (?:function|const)\s+([A-Za-z0-9_]+)', content)
            )
    namespaces['Intelligence'] = intel_names
    return namespaces


def check_repo() -> tuple[int, dict]:
    errors: list[str] = []
    manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    api_index = json.loads(API_INDEX_PATH.read_text(encoding='utf-8'))

    pinned_paths: set[str] = set()
    for entry in manifest.get('modules', []):
        rel = entry['path']
        pinned_paths.add(rel)
        target = ROOT / rel
        if not target.is_file():
            errors.append(f'Missing pinned file: {rel}')
            continue
        actual = sha256_file(target)
        if actual != entry['sha256']:
            errors.append(f'Hash mismatch for {rel}: expected {entry["sha256"][:12]}..., got {actual[:12]}...')

    for rel in discover_src_modules():
        if rel not in pinned_paths:
            errors.append(f'Unpinned src module: {rel}')

    runtime = inspect_runtime_exports()
    indexed_namespaces = {k for k in api_index.keys() if k != 'facade'}
    runtime_namespaces = set(runtime.keys())

    for ns in sorted(runtime_namespaces - indexed_namespaces):
        errors.append(f'Undocumented runtime namespace: {ns}')
    for ns in sorted(indexed_namespaces - runtime_namespaces):
        errors.append(f'Stale API_INDEX namespace: {ns}')

    for ns in sorted(runtime_namespaces & indexed_namespaces):
        rt_names = {e['name'] for e in runtime[ns]}
        idx_names = {e['name'] for e in api_index[ns]}
        for name in sorted(rt_names - idx_names):
            errors.append(f'Undocumented runtime export: {ns}.{name}')
        for name in sorted(idx_names - rt_names):
            errors.append(f'Missing runtime export: {ns}.{name}')

    dts = extract_dts_symbols()
    for ns in sorted(runtime_namespaces):
        rt_names = {e['name'] for e in runtime[ns]}
        dts_names = dts.get(ns, set())
        for name in sorted(rt_names - dts_names):
            errors.append(f'Missing TypeScript declaration: {ns}.{name}')
        for name in sorted(dts_names - rt_names):
            errors.append(f'Stale TypeScript declaration: {ns}.{name}')

    pkg = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    ns_by_subpath = {f'./{ns.lower()}': ns for ns in runtime_namespaces}
    for subpath, entry in pkg.get('exports', {}).items():
        if subpath not in ns_by_subpath:
            continue
        ns = ns_by_subpath[subpath]
        if not isinstance(entry, dict) or 'types' not in entry:
            errors.append(f'Missing subpath types condition in package.json for {subpath}')
            continue
        dts_path = ROOT / entry['types'].lstrip('./')
        if not dts_path.is_file():
            errors.append(f'Missing subpath declaration file: {entry["types"]}')
            continue
        if ns != 'Intelligence':
            sub_names = set(
                re.findall(r'^export declare (?:const|function)\s+([A-Za-z0-9_]+)', dts_path.read_text(encoding='utf-8'), re.MULTILINE)
            )
            rt_names = {e['name'] for e in runtime[ns]}
            for name in sorted(rt_names - sub_names):
                errors.append(f'Missing subpath TypeScript declaration ({subpath}): {name}')
            for name in sorted(sub_names - rt_names):
                errors.append(f'Stale subpath TypeScript declaration ({subpath}): {name}')

    summary = {
        'status': 'FAIL' if errors else 'PASS',
        'module_pins_checked': len(manifest.get('modules', [])),
        'runtime_symbols': sum(len(v) for v in runtime.values()),
        'errors': errors,
    }
    return (1 if errors else 0), summary


def write_repo() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    modules = manifest.get('modules', [])
    by_path = {entry['path']: entry for entry in modules}

    updated_pins = 0
    added_pins = 0

    for entry in modules:
        target = ROOT / entry['path']
        if target.is_file():
            digest = sha256_file(target)
            if digest != entry.get('sha256'):
                entry['parent_sha256'] = entry.get('sha256')
                entry['sha256'] = digest
                updated_pins += 1

    for rel in discover_src_modules():
        if rel not in by_path:
            modules.append({
                'path': rel,
                'sha256': sha256_file(ROOT / rel),
                'role': 'shared stateless core brick',
                'lineage': 'derived and standardized; modular core contract consolidation',
            })
            added_pins += 1

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    existing_index = json.loads(API_INDEX_PATH.read_text(encoding='utf-8'))
    runtime = inspect_runtime_exports()
    new_index: dict[str, object] = {}
    for key in existing_index.keys():
        if key == 'facade':
            new_index['facade'] = existing_index['facade']
        elif key in runtime:
            new_index[key] = runtime[key]
    for key in sorted(runtime.keys()):
        if key not in new_index:
            new_index[key] = runtime[key]

    API_INDEX_PATH.write_text(json.dumps(new_index, indent=2) + '\n', encoding='utf-8')
    return {
        'status': 'UPDATED',
        'updated_pins': updated_pins,
        'added_pins': added_pins,
        'total_pins': len(modules),
        'runtime_symbols': sum(len(v) for v in runtime.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Sync/check SDK pins, API index, and TypeScript declarations.')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check', action='store_true', help='Verify pins and bidirectional API/type parity.')
    group.add_argument('--write', action='store_true', help='Update manifest pins and API_INDEX.json from runtime.')
    args = parser.parse_args()

    if args.write:
        res = write_repo()
        print(json.dumps(res, indent=2))
        code, check = check_repo()
        if code:
            print(json.dumps(check, indent=2))
        return code

    code, summary = check_repo()
    print(json.dumps(summary, indent=2))
    return code


if __name__ == '__main__':
    sys.exit(main())
