#!/usr/bin/env python3
"""Lossless code-document collection from source ZIP/HTML, content-addressed and reconstructable.

Use on copies in a private workspace. Does not execute discovered sources and never claims
that indexing makes any donor module independently compatible with the SDK.
"""
from __future__ import annotations
import argparse,hashlib,json,stat,zipfile,os,re,tempfile
from collections import defaultdict
from pathlib import Path,PurePosixPath
from io import BytesIO

SOURCE_EXT={'.js','.mjs','.cjs','.jsx','.ts','.tsx','.py','.html','.htm','.css','.scss','.json','.md','.txt','.xml','.yaml','.yml','.toml','.kt','.java','.sh','.c','.h','.cpp','.hpp','.sql','.svg','.svelte','.vue','.astro'}
MAX_FILES=22000;MAX_SIZE=30_000_000;MAX_RATIO=1000;MAX_TOTAL=360_000_000

def sha(data:bytes)->str:return hashlib.sha256(data).hexdigest()
def safe_recovery_member(name):
    return isinstance(name,str) and not any(part in ('','.','..') for part in name.split('/')) and '\\' not in name and '\0' not in name

def source_items(path:Path):
    name=path.name
    if path.suffix.lower() not in ('.zip','.html','.htm'):
        raise ValueError('unsupported source type')
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            seen=set()
            if len(z.infolist())>MAX_FILES:raise ValueError('Archive member count exceeds budget')
            total=0
            for info in z.infolist():
                member=info.filename
                parts=PurePosixPath(member)
                if member in seen:raise ValueError('Duplicate archive member')
                seen.add(member)
                if parts.is_absolute() or '..' in parts.parts or '\\' in member or '\0' in member:raise ValueError('Unsafe member path')
                if stat.S_ISLNK((info.external_attr>>16)&0xFFFF):raise ValueError('Symlink rejected')
                if info.is_dir():continue
                total+=info.file_size
                if total>MAX_TOTAL:raise ValueError('Archive size exceeds budget')
                yield member,info.file_size,z.read(info) if safe_recovery_member(member) and info.file_size<=MAX_SIZE and info.file_size/max(info.compress_size,1)<=MAX_RATIO and parts.suffix.lower() in SOURCE_EXT else None
    else:
        data=path.read_bytes()
        yield name,len(data),data if len(data)<=MAX_SIZE else None

def export(paths:list[Path],destination:Path)->dict:
    registry=[];objects={};errors=[];skips=defaultdict(int);total=0
    for path in sorted(paths,key=lambda p:p.name.lower()):
        root={'filename':path.name,'archive_sha256':sha(path.read_bytes()),'archive_bytes':path.stat().st_size,'entries':[]}
        try:
            for name,size,data in source_items(path):
                total+=1
                entry={'name':name,'bytes':size}
                if not safe_recovery_member(name):
                    entry['state']='unsafe_member_path';skips['unsafe_member_path']+=1
                    errors.append({'path':path.name,'member':name,'error':'Unsafe recovery member'})
                elif data is None:entry['state']='not_code_or_exceeds_bound';skips['not_code_or_exceeds_bound']+=1
                else:
                    digest=sha(data);entry.update({'sha256':digest,'state':'exact_source','kind':PurePosixPath(name).suffix.lower()});objects.setdefault(digest,data)
                root['entries'].append(entry)
        except (ValueError,zipfile.BadZipFile,OSError,RuntimeError) as e:
            root['error']=str(e);errors.append({'path':path.name,'error':str(e)})
        registry.append(root)
    manifest={'schema':'nsite-loopy-source-collection/1','status':'raw-source-provenance-not-adopted','source_files':len(registry),'entries':total,'unique_source_objects':len(objects),'skipped_counts':dict(skips),'errors':errors,'sources':registry}
    destination.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=7) as z:
        z.writestr('MANIFEST.json',json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
        z.writestr('README.md','# Nsite Loopy full source collection\n\nContent-addressed exact copies of source code and documentation extracted from the available Library ZIP and HTML files. Original ZIPs remain in Library. This collection is **private donor material**, not a public license grant or verified importable code. Use `scripts/source_collection.py restore` to recover paths. Indexing is not execution.\n')
        for digest,data in sorted(objects.items()):z.writestr('objects/sha256/'+digest[:2]+'/'+digest,data)
    return {k:manifest[k] for k in ('source_files','entries','unique_source_objects','skipped_counts','errors')}

def restore(bundle:Path,destination:Path)->dict:
    # The caller controls the output root; archive metadata never controls it.
    base=destination.resolve()
    def checked_target(archive,name):
        if not isinstance(archive,str) or not re.fullmatch(r'[0-9a-f]{64}',archive):
            raise ValueError('Invalid archive SHA-256')
        if not safe_recovery_member(name):
            raise ValueError('Unsafe recovery member')
        target=base/archive/name
        if not target.resolve().is_relative_to(base):raise ValueError('Recovery path escapes destination')
        for part in (target,*target.parents):
            if part==base:break
            if part.is_symlink():raise ValueError('Recovery symlink rejected')
        return target
    restored=0
    with zipfile.ZipFile(bundle) as z:
        manifest=json.loads(z.read('MANIFEST.json'))
        if manifest.get('schema')!='nsite-loopy-source-collection/1':raise ValueError('Wrong collection schema')
        plan=[];targets={}
        for root in manifest['sources']:
            archive=root['archive_sha256']
            if not isinstance(archive,str) or not re.fullmatch(r'[0-9a-f]{64}',archive):raise ValueError('Invalid archive SHA-256')
            for item in root['entries']:
                if item.get('state')!='exact_source':continue
                target=checked_target(archive,item['name'])
                digest=item['sha256']
                if not isinstance(digest,str) or not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('Invalid object SHA-256')
                if target in targets and targets[target]!=digest:raise ValueError('Conflicting recovery path')
                targets[target]=digest
                obj='objects/sha256/'+digest[:2]+'/'+digest
                info=z.getinfo(obj)
                if info.file_size>MAX_SIZE or info.file_size!=item['bytes']:raise ValueError('Invalid object size')
                if sha(z.read(info))!=digest:raise ValueError('Donor object hash mismatch')
                plan.append((archive,item['name'],obj))
        # Validate the complete metadata before writing, and replace files atomically
        # rather than truncating pre-existing hardlinks. Use a private output directory.
        for archive,name,obj in plan:
            target=checked_target(archive,name)
            target.parent.mkdir(parents=True,exist_ok=True)
            target=checked_target(archive,name)
            tmp=None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent,delete=False) as f:
                    tmp=Path(f.name);f.write(z.read(obj))
                os.replace(tmp,target);restored+=1
            finally:
                if tmp is not None:tmp.unlink(missing_ok=True)
    return {'restored_occurrences':restored}

if __name__=='__main__':
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='cmd',required=True)
    x=sub.add_parser('export');x.add_argument('--input',required=True,type=Path);x.add_argument('--out',required=True,type=Path)
    x=sub.add_parser('restore');x.add_argument('--bundle',required=True,type=Path);x.add_argument('--out',required=True,type=Path)
    a=p.parse_args()
    if a.cmd=='export':print(json.dumps(export([x for x in a.input.iterdir() if x.suffix.lower() in ('.zip','.html','.htm')],a.out),indent=2))
    else:print(json.dumps(restore(a.bundle,a.out),indent=2))
