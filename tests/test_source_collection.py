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
if __name__=='__main__':unittest.main()
