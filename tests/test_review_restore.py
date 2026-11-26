import json,sys,tempfile,unittest,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from source_collection import restore,sha

class RestoreReview(unittest.TestCase):
    def bundle(self,base,archive,name='source.js',digest=None):
        data=b'new bytes';digest=digest or sha(data)
        path=base/'collection.zip'
        manifest={'schema':'nsite-loopy-source-collection/1','sources':[{'archive_sha256':archive,'entries':[{'name':name,'sha256':digest,'bytes':len(data),'state':'exact_source'}]}]}
        with zipfile.ZipFile(path,'w') as z:
            z.writestr('MANIFEST.json',json.dumps(manifest));z.writestr('objects/sha256/'+digest[:2]+'/'+digest,data)
        return path
    def test_absolute_archive_hash(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);outside=p/'outside';outside.mkdir();f=outside/'source.js';f.write_bytes(b'original')
            with self.assertRaises(ValueError):restore(self.bundle(p,str(outside)),p/'destination')
            self.assertEqual(f.read_bytes(),b'original')
    def test_relative_archive_hash(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);outside=p/'outside';outside.mkdir();f=outside/'source.js';f.write_bytes(b'original')
            with self.assertRaises(ValueError):restore(self.bundle(p,'../outside'),p/'destination')
            self.assertEqual(f.read_bytes(),b'original')
    def test_existing_symlink(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);outside=p/'outside';outside.mkdir();f=outside/'source.js';f.write_bytes(b'original');out=p/'destination';out.mkdir();(out/('a'*64)).symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):restore(self.bundle(p,'a'*64),out)
            self.assertEqual(f.read_bytes(),b'original')
    def test_existing_hardlink_does_not_change_outside_file(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);outside=p/'source.js';outside.write_bytes(b'original');out=p/'destination'/('a'*64);out.mkdir(parents=True);(out/'source.js').hardlink_to(outside)
            restore(self.bundle(p,'a'*64),p/'destination')
            self.assertEqual(outside.read_bytes(),b'original');self.assertEqual((out/'source.js').read_bytes(),b'new bytes')
    def test_noncanonical_member(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)
            with self.assertRaises(ValueError):restore(self.bundle(p,'a'*64,'src/./source.js'),p/'destination')
