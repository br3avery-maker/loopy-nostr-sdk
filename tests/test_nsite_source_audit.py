import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

FILE=Path(__file__).resolve().parents[1]/'scripts'/'nsite_source_audit.py'
spec=importlib.util.spec_from_file_location('nsite_source_audit',FILE)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class AuditTests(unittest.TestCase):
    def make_zip(self,path,entries,compression=zipfile.ZIP_STORED):
        with zipfile.ZipFile(path,'w',compression=compression) as z:
            for name,content in entries:z.writestr(name,content)
    def test_nip55_and_relay_classification_are_not_verification(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'sample.zip'
            self.make_zip(p,[('src/main.ts','const u="nostrsigner:"; // NIP-55; NIP-65; kind 10002')])
            r=mod.inspect(p);self.assertIn('android_nip55',r['members'][0]['topics']);self.assertIn('relay_discovery',r['members'][0]['topics'])
            self.assertEqual(r['members'][0]['review_state'],'source_inspected_not_executed')
    def test_detect_exact_duplicate_bytes_only(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);self.make_zip(p/'a.zip',[('a.js','const x=1')]);self.make_zip(p/'b.zip',[('b.js','const x=1')]);
            out=mod.index([p/'a.zip',p/'b.zip']);self.assertEqual(len(out['byte_identical_code_occurrences']),1)
    def test_modified_archive_fails_verification(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'a.zip';self.make_zip(p,[('a.js','export function f(){}')]);d=mod.index([p]);idx=Path(t)/'index.json';idx.write_text(json.dumps(d))
            self.assertEqual(mod.verify(idx)['status'],'PASS')
            self.make_zip(p,[('a.js','export function f(){return 1}')]);self.assertEqual(mod.verify(idx)['status'],'FAIL')
    def test_reject_path_traversal(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'a.zip';self.make_zip(p,[('../unsafe.js','alert(1)')]);
            with self.assertRaisesRegex(ValueError,'unsafe'):list(mod.archive_members(p))
    def test_reject_duplicate_member(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'a.zip';
            with zipfile.ZipFile(p,'w') as z:
                import warnings
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore',UserWarning);z.writestr('same.js','1');z.writestr('same.js','2')
            with self.assertRaisesRegex(ValueError,'duplicate'):list(mod.archive_members(p))
    def test_reject_symlink_member(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'a.zip';i=zipfile.ZipInfo('link.js');i.create_system=3;i.external_attr=(0o120777<<16)
            with zipfile.ZipFile(p,'w') as z:z.writestr(i,'target')
            with self.assertRaisesRegex(ValueError,'symlink'):list(mod.archive_members(p))
    def test_reject_high_compression_ratio(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'a.zip';self.make_zip(p,[('bomb.js','a'*400000)],compression=zipfile.ZIP_DEFLATED)
            with self.assertRaisesRegex(ValueError,'ratio'):list(mod.archive_members(p))
    def test_html_bounded_detection(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'nsite.html';p.write_text('<script>const x="blossom and readback"</script>');r=mod.inspect(p)
            self.assertIn('blossom',r['topics']);self.assertEqual(r['classification'],'html')
    def test_reject_cumulative_uncompressed_total(self):
        orig=mod.MAX_TOTAL_BYTES
        try:
            mod.MAX_TOTAL_BYTES=100
            with tempfile.TemporaryDirectory() as t:
                p=Path(t)/'big.zip'
                self.make_zip(p,[('a.js','x'*60),('b.js','y'*60)])
                with self.assertRaisesRegex(ValueError,'uncompressed total'):list(mod.archive_members(p))
        finally:
            mod.MAX_TOTAL_BYTES=orig

if __name__=='__main__':unittest.main()

