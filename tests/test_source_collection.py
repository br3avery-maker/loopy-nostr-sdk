import sys,unittest,tempfile,zipfile,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from source_collection import export,restore,sha
class SourceCollectionTest(unittest.TestCase):
    def test_source_collection_exact_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp);raw=b'export const x = 42;'
            with zipfile.ZipFile(p/'site.zip','w') as z:z.writestr('src/main.js',raw);z.writestr('images/a.png',b'bin')
            r=export([p/'site.zip'],p/'pack.zip')
            self.assertEqual(r['unique_source_objects'],1)
            out=restore(p/'pack.zip',p/'recovered')
            self.assertEqual(out['restored_occurrences'],1)
            self.assertEqual(list((p/'recovered').rglob('main.js'))[0].read_bytes(),raw)
    def test_reject_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)
            with zipfile.ZipFile(p/'site.zip','w') as z:z.writestr('../evil.js',b'code')
            r=export([p/'site.zip'],p/'pack.zip')
            self.assertEqual(len(r['errors']),1)
    def test_unsupported_member_names_reported_without_blocking_valid_sources(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)
            with zipfile.ZipFile(p/'site.zip','w') as z:
                z.writestr('./src/app.js',b'noncanonical')
                z.writestr('src//other.js',b'empty segment')
                z.writestr('src/./third.js',b'dot segment')
                z.writestr('src/good.js',b'good')
            r=export([p/'site.zip'],p/'pack.zip')
            out=restore(p/'pack.zip',p/'recovered')
            self.assertEqual(out['restored_occurrences'],1)
            self.assertEqual(r['unique_source_objects'],1)
            self.assertEqual(r['skipped_counts']['unsafe_member_path'],3)
            self.assertEqual(len(r['errors']),3)
            with zipfile.ZipFile(p/'pack.zip') as z:
                items=json.loads(z.read('MANIFEST.json'))['sources'][0]['entries']
            self.assertEqual([item['name'] for item in items[:3]],['./src/app.js','src//other.js','src/./third.js'])
            self.assertTrue(all(item['state']=='unsafe_member_path' and 'sha256' not in item for item in items[:3]))
            self.assertEqual(list((p/'recovered').rglob('good.js'))[0].read_bytes(),b'good')
if __name__=='__main__':unittest.main()
