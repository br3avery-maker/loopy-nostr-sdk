#!/usr/bin/env python3
"""Deterministic nsite source-intake adapter for IC Workshop and Code Quarry.

This tool is deliberately NOT a replacement for IC Loopy, Embeddy, Code Quarry,
or a Nostr implementation. It emits hash-locked source candidates for those tools.
No archive content is executed and no network or signing operation occurs.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

MAX_MEMBER_BYTES = 550_000
MAX_ARCHIVE_BYTES = 120_000_000
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_MEMBER_COUNT = 12_000
MAX_COMPRESSION_RATIO = 500
CODE_SUFFIX = {'.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.html','.json','.md','.yaml','.yml','.sh','.css'}
TOPICS = {
    'android_nip55': [r'nostrsigner:',r'\bNIP[-_ ]?55\b',r'callbackUrl'],
    'remote_nip46': [r'nostrconnect://',r'bunker://',r'\bNIP[-_ ]?46\b'],
    'relay_discovery': [r'\bNIP[-_ ]?65\b',r'\b10002\b',r'relay[^\n]{0,20}(?:discover|probe|health|list)'],
    'nsite_manifest': [r'\bNIP[-_ ]?5A\b',r'\b34128\b',r'aggregate[^\n]{0,25}hash'],
    'blossom': [r'\bBUD[-_ ]?(?:02|03|06|11)\b',r'blossom',r'blob[^\n]{0,30}upload'],
    'signed_readback': [r'readback',r'verifyEvent',r'signature[^\n]{0,24}verif'],
    'archive_lineage': [r'content[-_ ]address',r'lineage',r'fingerprint',r'deduplicat'],
}
COMPILED = {k:[re.compile(x,re.I) for x in v] for k,v in TOPICS.items()}


def digest(b:bytes)->str: return sha256(b).hexdigest()


def archive_members(path:Path):
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError('archive exceeds bounded intake limit')
    with zipfile.ZipFile(path) as z:
        infos=z.infolist()
        if len(infos)>MAX_MEMBER_COUNT:raise ValueError('archive has too many entries')
        names=set()
        total_bytes=0
        for m in infos:
            n=PurePosixPath(m.filename)
            if m.filename in names:raise ValueError('duplicate archive member path')
            names.add(m.filename)
            if n.is_absolute() or '..' in n.parts or '\\' in m.filename or '\0' in m.filename:
                raise ValueError('unsafe archive member path')
            mode=(m.external_attr>>16) & 0xFFFF
            if stat.S_ISLNK(mode):raise ValueError('symlink archive member rejected')
            if m.is_dir():continue
            total_bytes += m.file_size
            if total_bytes > MAX_TOTAL_BYTES:raise ValueError('archive uncompressed total exceeds budget')
            ratio=m.file_size/max(m.compress_size,1)
            if ratio>MAX_COMPRESSION_RATIO:raise ValueError('oversized compressed member ratio')
            if m.file_size>MAX_MEMBER_BYTES:
                yield {'path':m.filename,'bytes':m.file_size,'skipped':'size_cap'}
                continue
            if n.suffix.lower() not in CODE_SUFFIX:
                yield {'path':m.filename,'bytes':m.file_size,'skipped':'not_code_or_document'}
                continue
            raw=z.read(m)
            text=raw.decode('utf-8','replace')
            tags=[k for k,patterns in COMPILED.items() if any(p.search(text) for p in patterns)]
            yield {'path':m.filename,'bytes':m.file_size,'sha256':digest(raw),
                   'topics':tags,'extension':n.suffix.lower(),
                   'review_state':'source_inspected_not_executed'}


def inspect(path:Path)->dict:
    raw=path.read_bytes()
    record={'name':path.name,'source_path':str(path.resolve()),'bytes':len(raw),
            'sha256':digest(raw),'classification':'archive' if zipfile.is_zipfile(path) else 'html'}
    if zipfile.is_zipfile(path):
        members=list(archive_members(path))
        record['members_total']=len(members)
        record['members_candidates']=sum('sha256' in m for m in members)
        record['members']=members
    elif path.suffix.lower() in ('.html','.htm'):
        if len(raw)>MAX_ARCHIVE_BYTES:raise ValueError('HTML source exceeds bound')
        text=raw[:MAX_MEMBER_BYTES].decode('utf-8','replace')
        record['topics']=[k for k,patterns in COMPILED.items() if any(p.search(text) for p in patterns)]
        record['review_state']='source_inspected_not_executed'
        record['body_scanned_bytes']=min(len(raw),MAX_MEMBER_BYTES)
    else: raise ValueError('unsupported source type: '+path.name)
    return record


def index(paths:list[Path])->dict:
    sources=[]; problems=[]; occurrences=defaultdict(list)
    for path in sorted(paths,key=lambda x:(x.name.lower(),str(x))):
        try:
            rec=inspect(path);sources.append(rec)
            for m in rec.get('members',[]):
                if 'sha256' in m:
                    occurrences[m['sha256']].append({'archive_sha256':rec['sha256'],'path':m['path']})
        except (OSError,ValueError,zipfile.BadZipFile,RuntimeError) as exc:
            problems.append({'path':str(path),'error':type(exc).__name__+': '+str(exc)})
    return {'schema':'nsite-loopy-source-index.v1','source_count':len(sources),
            'member_candidates':sum(r.get('members_candidates',0) for r in sources),
            'sources':sources,'errors':problems,
            'byte_identical_code_occurrences':[
                {'sha256':s,'occurrences':v} for s,v in sorted(occurrences.items()) if len(v)>1],
            'warning':'Nostrsigner/relay/Blossom keyword detection is NOT verified behavior; semantic similarity is review-only.'}


def verify(index_path:Path)->dict:
    data=json.loads(index_path.read_text(encoding='utf-8'))
    failures=[];checked=0
    for old in data['sources']:
        p=Path(old['source_path'])
        if not p.is_file() or digest(p.read_bytes())!=old['sha256']:
            failures.append(old['source_path']+': missing or changed bytes');continue
        try: new=inspect(p)
        except (OSError,ValueError,zipfile.BadZipFile) as e:
            failures.append(old['source_path']+': '+str(e));continue
        if new!=old:failures.append(old['source_path']+': inspected content changed')
        else:checked+=1
    return {'status':'PASS' if not failures else 'FAIL','verified_sources':checked,
            'source_count':len(data['sources']),'failures':failures}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='command',required=True)
    scan=sub.add_parser('scan',help='Build deterministic source/member manifest')
    scan.add_argument('paths',nargs='+',type=Path)
    scan.add_argument('--out',type=Path,required=True)
    ver=sub.add_parser('verify',help='Check exact source/member bytes against manifest')
    ver.add_argument('--index',type=Path,required=True)
    args=p.parse_args()
    if args.command=='scan':
        expanded=[]
        for x in args.paths:
            if x.is_dir():expanded.extend(y for y in x.iterdir() if y.suffix.lower() in ('.zip','.html','.htm'))
            elif x.is_file():expanded.append(x)
            else: p.error('missing source: '+str(x))
        data=index(expanded);args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
        print(json.dumps({'sources':data['source_count'],'candidates':data['member_candidates'],'errors':len(data['errors'])}))
        if data['errors']:raise SystemExit(2)
    else:
        result=verify(args.index);print(json.dumps(result,indent=2));
        if result['status']!='PASS':raise SystemExit(2)

if __name__=='__main__':main()
