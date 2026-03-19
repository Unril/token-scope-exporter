# Changelog

All notable changes to the "token-scope-exporter" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.0.2] - 2026-03-19

### Changed

- `textmate` field: renamed `mostSpecific` to `scope` and `scopes` to `rest`; `rest` no longer includes the most-specific scope
- `grammar` field: flattened from object (`scopeName`, `relativePath`, `extensionId`) to a plain string (the scope name)
- `source` field: removed `uri`, renamed `fsPath` to `path`
- `semantic` key is omitted from segments when no semantic token covers the span (instead of `semantic: null`)

### Added

- `tokenScopeExporter.includeSpan` setting (default `true`): when `false`, the `span` field is omitted from segments
- `tokenScopeExporter.includePath` setting (default `true`): when `false`, the `path` field is omitted from source metadata

## [0.0.1] - 2026-03-09

### Added

- Export command: "Token Scope Exporter: Export Active File"
- Semantic token decoding via VS Code built-in commands
- TextMate re-tokenization via vscode-textmate and vscode-oniguruma
- Merged line-grouped, span-based output format
- YAML (default) and JSON output formats
- Settings: output format, include whitespace, open after export

[0.0.2]: https://github.com/Unril/token-scope-exporter/releases/tag/v0.0.2
[0.0.1]: https://github.com/Unril/token-scope-exporter/releases/tag/v0.0.1
