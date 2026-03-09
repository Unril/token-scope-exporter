#!/usr/bin/env python3

"""Query token segments from exported .tokens.yaml files.

Requires ruamel.yaml (YAML 1.2 parser). PyYAML cannot parse these files
because the extension emits unquoted `=` which PyYAML interprets as the
YAML 1.1 !!value tag.

Usage:
    python scripts/token_query.py FILE SNIPPET
    python scripts/token_query.py FILE --scope PATTERN
"""

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

type TokenExport = dict[str, Any]


@dataclass(frozen=True)
class TokenSegment:
    """Single token segment from the export."""

    text: str
    line_number: int
    source_text: str
    span: tuple[int, int]
    semantic_type: str | None
    semantic_modifiers: tuple[str, ...]
    textmate_most_specific: str | None
    textmate_scopes: tuple[str, ...]


def load_export(path: Path) -> TokenExport:
    """Load a .tokens.yaml file using ruamel.yaml (YAML 1.2)."""
    ry = YAML()
    with path.open() as f:
        data: TokenExport = ry.load(f)
    return data


def _parse_segment(seg: dict[str, Any], line_number: int, source_text: str) -> TokenSegment:
    tm = seg.get("textmate")
    sem = seg.get("semantic")
    span_raw = seg["span"]
    return TokenSegment(
        text=str(seg["text"]),
        line_number=line_number,
        source_text=str(source_text),
        span=(int(span_raw[0]), int(span_raw[1])),
        semantic_type=str(sem["type"]) if sem and sem.get("type") else None,
        semantic_modifiers=tuple(sem.get("modifiers", ())) if sem else (),
        textmate_most_specific=str(tm["mostSpecific"]) if tm else None,
        textmate_scopes=tuple(str(s) for s in tm.get("scopes", ())) if tm else (),
    )


def all_segments(data: TokenExport) -> list[TokenSegment]:
    """Flatten all lines into a list of TokenSegment."""
    return [
        _parse_segment(seg, int(line["lineNumber"]), str(line["sourceText"]))
        for line in data.get("lines", [])
        for seg in line.get("segments", [])
    ]


def query_snippet(data: TokenExport, snippet: str) -> list[TokenSegment]:
    """Find token segments whose source lines contain the snippet.

    Matches lines where `snippet` appears as a substring of sourceText,
    then returns all segments from those lines.
    """
    return [
        _parse_segment(seg, int(line["lineNumber"]), str(line["sourceText"]))
        for line in data.get("lines", [])
        if snippet in str(line["sourceText"])
        for seg in line.get("segments", [])
    ]


def query_scope(data: TokenExport, scope_pattern: str) -> list[TokenSegment]:
    """Find segments whose textmate mostSpecific scope contains the pattern."""
    return [
        seg for seg in all_segments(data) if seg.textmate_most_specific and scope_pattern in seg.textmate_most_specific
    ]


def _print_segments(segments: list[TokenSegment]) -> None:
    current_line = -1
    for seg in segments:
        if seg.line_number != current_line:
            if current_line != -1:
                print()
            print(f"L{seg.line_number}: {seg.source_text}")
            current_line = seg.line_number
        scope = seg.textmate_most_specific or "(none)"
        parts = [f"{seg.span[0]}-{seg.span[1]}", repr(seg.text), f"tm={scope}"]
        if seg.semantic_type:
            parts.append(f"sem={seg.semantic_type}")
        print(f"  {' '.join(parts)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Query token segments from exported .tokens.yaml files.",
    )
    parser.add_argument("file", type=Path, help=".tokens.yaml file to query")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("snippet", nargs="?", help="substring to match in source lines")
    group.add_argument("--scope", help="substring to match in textmate mostSpecific scope")
    args = parser.parse_args()

    data = load_export(args.file)

    if args.scope:
        segments = query_scope(data, args.scope)
    else:
        segments = query_snippet(data, args.snippet)

    if not segments:
        pattern = args.scope or args.snippet
        print(f"No matches for {pattern!r}")
        sys.exit(0)

    _print_segments(segments)


if __name__ == "__main__":
    main()
