#!/usr/bin/env python3
"""Report instruction-bearing blanks; do not infer missing project facts."""
from __future__ import annotations
import argparse
import re
from pathlib import Path

REQUIRED = ('AGENTS.md', 'README.md', 'PROJECT.md', 'DEVELOPMENT.md', 'CAPABILITIES.md', 'RELEASE.md', 'GAPS.md', 'TEMPLATE-GUIDE.md', 'UI.md', 'ARCHITECTURE.md', 'REUSE.md', 'SECURITY.md', 'CHANGELOG.md', 'LICENSE', 'AI-DEVELOPMENT.md', 'THIRD_PARTY_NOTICES.md')
# Tokens deliberately use ASCII slugs to support simple grep and code review.
TOKEN = re.compile(r'\{\{FILL:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}')
ANNOTATION = re.compile(r'<!--\s*FILL:([a-z0-9]+(?:-[a-z0-9]+)*)\s*\|\s*DISCOVER:\s*([^|\n]+)\s*\|\s*ACCEPT:\s*([^\n]+?)\s*-->')
# Check genuinely required project docs; examples/instructions may mention a placeholder as an example.
FILLED_DOCS = ('README.md', 'PROJECT.md', 'DEVELOPMENT.md', 'CAPABILITIES.md', 'RELEASE.md', 'UI.md', 'ARCHITECTURE.md', 'REUSE.md', 'SECURITY.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md')
FILLER = re.compile(r'(?im)^\s*(?:\*\*)?(?:TBD|TODO|COMING SOON|LOREM IPSUM)(?:\*\*)?\s*$')


def scan(root: Path, mode: str) -> tuple[list[str], list[str]]:
    errors, outstanding = [], []
    if not root.is_dir():
        return [f'{root}: missing directory'], []
    for filename in REQUIRED:
        file = root / filename
        if not file.is_file() or file.is_symlink():
            errors.append(f'{filename}: missing required regular file')
            continue
        s = file.read_text(encoding='utf-8')
        if not s.strip():
            errors.append(f'{filename}: empty required document')
            continue
        if filename not in FILLED_DOCS:
            continue
        tokens, notes = TOKEN.findall(s), list(ANNOTATION.finditer(s))
        annotated = [m.group(1) for m in notes]
        for token in tokens:
            if token not in annotated:
                errors.append(f'{filename}: token {token} lacks DISCOVER and ACCEPT instructions')
            else:
                outstanding.append(f'{filename}: {token}')
        for aid in annotated:
            if aid not in tokens:
                errors.append(f'{filename}: stale FILL annotation {aid} (remove it only after completing field)')
        for issue in re.finditer(r'\{\{FILL:[^}]*\}\}', s):
            if not TOKEN.fullmatch(issue.group()):
                errors.append(f'{filename}: malformed FILL token {issue.group()!r}')
        if mode == 'ready':
            if filename == 'UI.md':
                scopes = re.findall(r'(?m)^\*\*Interface scope:\*\*[ \t]*(.*)$', s)
                evidence = re.findall(r'(?m)^\*\*Scope evidence:\*\*[ \t]*(.*)$', s)
                if len(scopes) != 1 or scopes[0].strip() not in ('applicable', 'headless'):
                    errors.append('UI.md: Interface scope must be exactly applicable or headless')
                if len(evidence) != 1 or not evidence[0].strip() or re.fullmatch(r'(?i)(?:N/?A|none|not applicable|headless|applicable|unknown|TBD|TODO)[.!]?', evidence[0].strip()):
                    errors.append('UI.md: Scope evidence must explain the selected scope')
            # A removed token without replacement text is still an unfinished section.
            # Ignore HTML comments and heading-only sections when checking emptiness.
            segments = re.split(r'(?m)^#{1,3} +[^\n]+\n', s)
            headings = list(re.finditer(r'(?m)^(#{1,3}) +([^\n]+)\n', s))
            for index, (head, segment) in enumerate(zip(headings, segments[1:])):
                if index + 1 < len(headings) and len(headings[index + 1].group(1)) > len(head.group(1)):
                    continue  # Parent section has child headings; its introduction may be empty.
                visible = re.sub(r'<!--.*?-->', '', segment, flags=re.S)
                visible = re.sub(r'\s+', '', visible)
                if not visible:
                    errors.append(f'{filename}: section {head.group(2)!r} is blank')
            for field in ('State', 'Verified current status', 'Start here', 'Artifact identity', 'Versioning / updates', 'Recovery and rollback'):
                if re.search(rf'(?m)^\*\*{re.escape(field)}:\*\*\s*$', s):
                    errors.append(f'{filename}: empty inline field {field}')
            if filename == 'CAPABILITIES.md' and re.search(r'\|\s*Unknown\s*\|', s):
                errors.append(f'{filename}: Unknown capability state is not evidence')
            if FILLER.search(s):
                errors.append(f'{filename}: generic filler is not evidence')
            for field in tokens:
                errors.append(f'{filename}: unresolved required field {field}')
    return errors, outstanding


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('template', 'ready'), required=True)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    errors, outstanding = scan(args.root, args.mode)
    for item in outstanding:
        print('UNFINISHED (not a completed field):', item)
    for issue in errors:
        print('ERROR:', issue)
    print(f'{args.mode.upper()}: {len(outstanding)} documented unfilled fields; {len(errors)} errors')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
