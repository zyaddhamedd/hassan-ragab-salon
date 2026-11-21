"""Read Alembic revision literals with AST only. Never import or run migrations."""
import ast
import hashlib
import json
from pathlib import Path


VERSIONS = Path(__file__).resolve().parents[2] / 'backend/migrations/versions'


def references(value):
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (tuple, list)) and all(isinstance(v, str) for v in value):
        return list(value)
    raise ValueError('Unsupported revision reference')


def audit(directory=VERSIONS):
    revisions = {}
    for path in sorted(directory.glob('*.py')):
        source = path.read_text()
        tree = ast.parse(source, filename=str(path))
        values = {}
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in {
                        'revision', 'down_revision', 'depends_on', 'branch_labels'
                    }:
                        values[target.id] = ast.literal_eval(node.value)
        revision = values.get('revision')
        if not isinstance(revision, str) or not revision or revision in revisions:
            raise ValueError('Missing or duplicate revision: ' + path.name)
        if 'down_revision' not in values:
            raise ValueError('Missing down_revision: ' + path.name)
        revisions[revision] = dict(values, file=path.name,
                                   sha256=hashlib.sha256(source.encode()).hexdigest())
    if not revisions:
        raise ValueError('No migration files found')
    visiting, visited, order = set(), set(), []

    def visit(revision):
        if revision not in revisions:
            raise ValueError('Missing referenced revision: ' + revision)
        if revision in visiting:
            raise ValueError('Revision cycle: ' + revision)
        if revision in visited:
            return
        visiting.add(revision)
        node = revisions[revision]
        for parent in references(node['down_revision']) + references(node.get('depends_on')):
            visit(parent)
        visiting.remove(revision)
        visited.add(revision)
        order.append(revision)

    for revision in revisions:
        visit(revision)
    parents = {p for node in revisions.values() for p in references(node['down_revision'])}
    return {
        'count': len(revisions),
        'roots': sorted(r for r, n in revisions.items() if n['down_revision'] is None),
        'heads': sorted(set(revisions) - parents),
        'merges': sorted(r for r, n in revisions.items() if len(references(n['down_revision'])) > 1),
        'topological_order': order,
        'revisions': revisions,
    }


if __name__ == '__main__':
    print(json.dumps(audit(), indent=2))
