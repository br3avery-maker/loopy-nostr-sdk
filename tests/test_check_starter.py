import shutil
import tempfile
import unittest
from pathlib import Path
from scripts.check_starter import scan, REQUIRED, FILLED_DOCS


class StarterChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = Path(__file__).resolve().parents[1]
        for name in REQUIRED:
            shutil.copy2(source / name, self.root / name)

    def tearDown(self):
        self.temp.cleanup()

    def test_template_is_well_annotated_but_unfinished(self):
        errors, pending = scan(self.root, 'template')
        self.assertEqual(errors, [])
        self.assertGreaterEqual(len(pending), 10)

    def test_ready_rejects_unfilled_fields(self):
        errors, pending = scan(self.root, 'ready')
        self.assertTrue(pending)
        self.assertTrue(any('unresolved required' in e for e in errors))

    def test_missing_required_file_fails(self):
        (self.root / 'PROJECT.md').unlink()
        errors, _ = scan(self.root, 'template')
        self.assertTrue(any('missing required' in e for e in errors))

    def test_empty_file_fails(self):
        (self.root / 'CAPABILITIES.md').write_text('')
        errors, _ = scan(self.root, 'template')
        self.assertTrue(any('empty required' in e for e in errors))

    def test_unannotated_token_fails(self):
        with (self.root / 'PROJECT.md').open('a') as f:
            f.write('\n{{FILL:unexplained}}\n')
        errors, _ = scan(self.root, 'template')
        self.assertTrue(any('lacks DISCOVER' in e for e in errors))

    def test_stale_annotation_fails(self):
        p = self.root / 'PROJECT.md'
        p.write_text(p.read_text().replace('{{FILL:scope}}','Actual grounded scope.'))
        errors, _ = scan(self.root, 'template')
        self.assertTrue(any('stale FILL annotation scope' in e for e in errors))

    def test_deleted_token_cannot_hide_blank_section(self):
        from scripts.check_starter import TOKEN, ANNOTATION
        p = self.root / 'PROJECT.md'
        s = ANNOTATION.sub('', p.read_text())
        s = TOKEN.sub('', s)
        p.write_text(s)
        errors, _ = scan(self.root, 'ready')
        self.assertTrue(any('section' in e and 'blank' in e for e in errors))

    def test_capability_unknown_is_not_a_pass(self):
        from scripts.check_starter import TOKEN, ANNOTATION
        p = self.root / 'CAPABILITIES.md'
        s = ANNOTATION.sub('', p.read_text())
        s = TOKEN.sub('Filled with source evidence', s)
        p.write_text(s)
        errors, _ = scan(self.root, 'ready')
        self.assertTrue(any('Unknown capability state' in e for e in errors))

    def fill_all(self, scope='headless'):
        from scripts.check_starter import TOKEN, ANNOTATION
        for filename in FILLED_DOCS:
            p = self.root / filename
            s = p.read_text()
            s = ANNOTATION.sub('', s)
            s = TOKEN.sub(lambda m: scope if m.group(1) == 'ui-scope' else 'Evidence-backed value (source: example only for test)', s)
            if filename == 'CAPABILITIES.md':
                s = s.replace('| Unknown |', '| Source-tested |')
            p.write_text(s)
    def test_ready_clean_when_all_resolved(self):
        self.fill_all()
        errors, pending = scan(self.root, 'ready')
        self.assertEqual((errors, pending), ([], []))

    def test_applicable_ui_with_documented_evidence(self):
        self.fill_all('applicable')
        self.assertEqual(scan(self.root, 'ready'), ([], []))

    def test_new_documents_are_required(self):
        for name in ('UI.md', 'ARCHITECTURE.md', 'REUSE.md', 'SECURITY.md', 'CHANGELOG.md'):
            with self.subTest(name=name):
                p = self.root / name
                old = p.read_text()
                p.unlink()
                self.assertTrue(any(name in e and 'missing required' in e for e in scan(self.root, 'template')[0]))
                p.write_text(old)

    def test_new_docs_unfilled_block_ready(self):
        errors, pending = scan(self.root, 'ready')
        for name in ('UI.md', 'ARCHITECTURE.md', 'REUSE.md', 'SECURITY.md', 'CHANGELOG.md'):
            self.assertTrue(any(name in e and 'unresolved required' in e for e in errors))

    def test_invalid_ui_scope_fails(self):
        self.fill_all('N/A')
        self.assertTrue(any('Interface scope must' in e for e in scan(self.root, 'ready')[0]))

    def test_bare_ui_scope_evidence_fails(self):
        self.fill_all()
        p = self.root / 'UI.md'
        p.write_text(p.read_text().replace('**Scope evidence:** Evidence-backed value (source: example only for test)', '**Scope evidence:** N/A'))
        self.assertTrue(any('Scope evidence must' in e for e in scan(self.root, 'ready')[0]))

    def test_removed_ui_scope_field_fails(self):
        self.fill_all()
        p = self.root / 'UI.md'
        p.write_text(p.read_text().replace('**Interface scope:** headless\n', ''))
        self.assertTrue(any('Interface scope must' in e for e in scan(self.root, 'ready')[0]))


if __name__ == '__main__':
    unittest.main()
