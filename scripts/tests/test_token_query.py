"""Tests for token_query module against the real sample.md.tokens.yaml fixture."""

from pathlib import Path

import pytest

from token_query import (
    TokenExport,
    TokenSegment,
    all_segments,
    load_export,
    query_scope,
    query_snippet,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample.md.tokens.yaml"


@pytest.fixture
def data() -> TokenExport:
    return load_export(FIXTURE)


class TestLoadExport:
    def test_schema_version(self, data: TokenExport) -> None:
        assert data["schema"] == "token-scope-export/v1"

    def test_stats_present(self, data: TokenExport) -> None:
        stats = data["stats"]
        assert int(stats["lineCount"]) > 0
        assert int(stats["exportedSegmentCount"]) > 0

    def test_lines_not_empty(self, data: TokenExport) -> None:
        assert data["lines"]

    def test_nonexistent_file_raises(self) -> None:
        with pytest.raises(FileNotFoundError):
            load_export(Path("/nonexistent/file.yaml"))


class TestAllSegments:
    def test_returns_nonempty(self, data: TokenExport) -> None:
        assert all_segments(data)

    def test_segment_fields_populated(self, data: TokenExport) -> None:
        seg = all_segments(data)[0]
        assert isinstance(seg, TokenSegment)
        assert seg.text == "#"
        assert seg.line_number == 1
        assert seg.span == (0, 1)
        assert seg.textmate_most_specific == "punctuation.definition.heading.markdown"

    def test_total_matches_stats(self, data: TokenExport) -> None:
        segments = all_segments(data)
        expected = int(data["stats"]["exportedSegmentCount"])
        assert len(segments) == expected

    def test_empty_dict_returns_empty(self) -> None:
        assert all_segments({}) == []

    def test_empty_lines_returns_empty(self) -> None:
        assert all_segments({"lines": []}) == []


class TestQuerySnippet:
    def test_typescript_interface(self, data: TokenExport) -> None:
        segments = query_snippet(data, "interface User")
        texts = [s.text for s in segments]
        assert "interface" in texts
        assert "User" in texts
        assert "{" in texts

    def test_python_def(self, data: TokenExport) -> None:
        segments = query_snippet(data, "def factorial")
        texts = [s.text for s in segments]
        assert "def" in texts
        assert "factorial" in texts

    def test_scopes_on_matched_segments(self, data: TokenExport) -> None:
        segments = query_snippet(data, "interface User")
        matches = [s for s in segments if s.text == "interface"]
        assert matches, "Expected a segment with text 'interface'"
        assert matches[0].textmate_most_specific == "storage.type.interface.ts"
        assert "meta.interface.ts" in matches[0].textmate_scopes

    def test_no_match_returns_empty(self, data: TokenExport) -> None:
        assert query_snippet(data, "THIS_DOES_NOT_EXIST_ANYWHERE") == []

    def test_all_segments_share_same_line(self, data: TokenExport) -> None:
        segments = query_snippet(data, "interface User")
        line_numbers = {s.line_number for s in segments}
        assert len(line_numbers) == 1

    def test_span_covers_text_length(self, data: TokenExport) -> None:
        for seg in query_snippet(data, "interface User"):
            start, end = seg.span
            assert end - start == len(seg.text)


class TestQueryScope:
    def test_find_function_names(self, data: TokenExport) -> None:
        segments = query_scope(data, "entity.name.function")
        texts = [s.text for s in segments]
        assert "greet" in texts
        assert "factorial" in texts

    def test_find_keywords(self, data: TokenExport) -> None:
        segments = query_scope(data, "keyword.control.flow")
        texts = [s.text for s in segments]
        assert "return" in texts
        assert "if" in texts

    def test_no_scope_match_returns_empty(self, data: TokenExport) -> None:
        assert query_scope(data, "nonexistent.scope.xyz") == []


class TestTokenSegmentDataclass:
    def test_frozen(self) -> None:
        seg = TokenSegment(
            text="x",
            line_number=1,
            source_text="x = 1",
            span=(0, 1),
            semantic_type=None,
            semantic_modifiers=(),
            textmate_most_specific="variable",
            textmate_scopes=("source",),
        )
        with pytest.raises(AttributeError):
            seg.text = "y"  # type: ignore[misc]

    def test_null_semantic_fields(self, data: TokenExport) -> None:
        seg = all_segments(data)[0]
        assert seg.semantic_type is None
        assert seg.semantic_modifiers == ()
