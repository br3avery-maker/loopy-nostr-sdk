#!/usr/bin/env python3
import json,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
data=json.loads((root/'provenance/repo-capabilities.json').read_text())
assert data['schema']=='nsite-loopy-public-provenance/1'
assert len(data['entries'])==data['summary']['entries']
checks=[r for r in data['entries'] if r['disposition'].startswith('adopted') or r['disposition'].startswith('already-covered')]
assert all(r['source_url'].startswith('https://github.com/br3avery-maker/') for r in data['entries'])
for r in checks:
 assert '.' in r['sdk_contract'],r
ns={r['sdk_contract'].split('.')[0] for r in checks}
js="import * as m from './src/index.js'; const keys="+json.dumps([r['sdk_contract'] for r in checks])+"; for(const k of keys){const [ns,name]=k.split('.');if(typeof m[ns]?.[name]==='undefined')throw Error('Missing '+k)}"
p=subprocess.run(['node','--input-type=module','-e',js],cwd=root,capture_output=True,text=True)
assert p.returncode==0,p.stderr
print(json.dumps({'status':'PASS','source_module_records':len(data['entries']),'adopted_or_existing_contracts_checked':len(checks),'namespaces':sorted(ns)}))
