# Token Query Scripts

Python utilities for querying `.tokens.yaml` files exported by the
Token Scope Exporter VS Code extension.

## Requirements

- Python >= 3.13
- [ruamel.yaml](https://yaml.readthedocs.io/) (YAML 1.2 parser)
- pytest (for running tests)

PyYAML cannot parse these files because the extension emits unquoted `=`
values, which PyYAML interprets as the YAML 1.1 `!!value` tag.

```bash
pip install ruamel.yaml pytest
```

## Usage

### CLI

```bash
python scripts/token_query.py FILE SNIPPET
python scripts/token_query.py FILE --scope PATTERN
```

```bash
# Find segments on lines containing "interface User"
python scripts/token_query.py export.tokens.yaml "interface User"

# Find segments by TextMate scope
python scripts/token_query.py export.tokens.yaml --scope entity.name.function
```

Output:

```text
L8: interface User {
  0-9 'interface' tm=storage.type.interface.ts
  10-14 'User' tm=entity.name.type.interface.ts
  15-16 '{' tm=punctuation.definition.block.ts
```

### As a library

```python
from pathlib import Path
from token_query import load_export, query_snippet, query_scope, all_segments

data = load_export(Path("export.tokens.yaml"))

# Find all segments on lines containing a snippet
for seg in query_snippet(data, "def factorial"):
    print(f"{seg.text!r}  {seg.textmate_most_specific}")

# Find segments by TextMate scope pattern
for seg in query_scope(data, "entity.name.function"):
    print(f"L{seg.line_number} {seg.text!r}")

# Get every segment in the file
segments = all_segments(data)
```

## API

- `load_export(path)` -- load a `.tokens.yaml` file, returns parsed dict
- `all_segments(data)` -- flatten all lines into a list of `TokenSegment`
- `query_snippet(data, snippet)` -- segments from lines containing `snippet`
- `query_scope(data, scope_pattern)` -- segments whose `mostSpecific` scope
  contains `scope_pattern`

Each `TokenSegment` has: `text`, `line_number`, `source_text`, `span`,
`semantic_type`, `semantic_modifiers`, `textmate_most_specific`,
`textmate_scopes`.

## Running tests

```bash
pytest scripts/tests/ -v
```
