#!/usr/bin/env python3
"""Verify source pins, API file list, and package integrity; no network required."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
index=json.loads((ROOT/'docs/API_INDEX.json').read_text())
provenance=json.loads((ROOT/'provenance/manifest.json').read_text())
errors=[]
for module in provenance['modules']:
    path=ROOT/module['path']
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=module['sha256']:
        errors.append('Missing or changed pinned module '+module['path'])
for name in ['package.json','README.md','types/index.d.ts','docs/API_REFERENCE.md','LICENSES.md']:
    if not (ROOT/name).is_file():errors.append('Required file missing: '+name)
call=subprocess.run(['node','--input-type=module','-e',"import * as m from './src/index.js'; import fs from 'node:fs'; const d=JSON.parse(fs.readFileSync('docs/API_INDEX.json','utf8')); for(const [name,entries] of Object.entries(d)) {if(name==='facade')continue; for (const entry of entries)if(!(entry.name in m[name]))throw Error('Missing runtime export '+name+'.'+entry.name)}"],cwd=ROOT,capture_output=True,text=True)
if call.returncode:errors.append('Runtime API mismatch: '+call.stderr.strip())
result={'status':'FAIL' if errors else 'PASS','module_pins_checked':len(provenance['modules']),'api_symbols':sum(len(v) for k,v in index.items() if k!='facade'),'errors':errors}
print(json.dumps(result,indent=2));sys.exit(bool(errors))
