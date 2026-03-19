# Token Scope Exporter

![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/NikolaiFedorov.token-scope-exporter)
![Installs](https://img.shields.io/visual-studio-marketplace/i/NikolaiFedorov.token-scope-exporter)

Export semantic tokens and TextMate scopes for any file as structured YAML or JSON.

Built for feeding token context into LLM prompts, debugging color themes, and developing TextMate grammars.

## Features

- Semantic tokens decoded from VS Code's built-in semantic-token commands
- TextMate scopes re-tokenized from the contributed grammar via [vscode-textmate](https://github.com/microsoft/vscode-textmate)
- Both token streams merged into line-grouped, span-based segments
- YAML (default) or JSON output written as a sidecar file next to the source
- Exported file opens beside the source editor automatically

## Usage

Open any file, then run from the command palette:

```text
Token Scope Exporter: Export Active File
```

A sidecar file (`{filename}.tokens.yaml` or `.tokens.json`) appears next to the source.

## Output examples

TypeScript:

```yaml
- lineNumber: 3
  sourceText: 'function greet(user: User): string {'
  segments:
    - text: function
      semantic: {type: keyword, modifiers: [declaration]}
      textmate: {scope: storage.type.function.ts, rest: [source.ts, meta.function.ts]}
    - text: greet
      semantic: {type: function, modifiers: [declaration]}
      textmate: {scope: entity.name.function.ts, rest: [source.ts, meta.function.ts, meta.definition.function.ts]}
    - text: user
      semantic: {type: parameter, modifiers: [declaration]}
      textmate: {scope: variable.parameter.ts, rest: [source.ts, meta.function.ts, meta.parameters.ts]}
```

Kotlin inside a Markdown fenced block (injection grammars are resolved):

```yaml
- lineNumber: 39
  sourceText: 'data class User(val id: Long, val name: String)'
  segments:
    - text: data
      textmate: {scope: storage.modifier.kotlin, rest: [text.html.markdown, markup.fenced_code.block.markdown, meta.embedded.block.kotlin]}
    - text: class
      textmate: {scope: storage.type.kotlin, rest: [text.html.markdown, markup.fenced_code.block.markdown, meta.embedded.block.kotlin]}
```

Markdown prose with bold and a link:

```yaml
- lineNumber: 66
  sourceText: No code here, just a paragraph with **bold** and *italic* text.
  segments:
    - text: '**'
      textmate: {scope: punctuation.definition.bold.markdown, rest: [text.html.markdown, meta.paragraph.markdown, markup.bold.markdown]}
    - text: bold
      textmate: {scope: markup.bold.markdown, rest: [text.html.markdown, meta.paragraph.markdown]}
```

## Extension Settings

| Setting | Default | Description |
| --- | --- | --- |
| `tokenScopeExporter.outputFormat` | `yaml` | `yaml` or `json` |
| `tokenScopeExporter.includeWhitespace` | `false` | Include pure-whitespace segments |
| `tokenScopeExporter.openAfterExport` | `true` | Open the export beside the source editor |
| `tokenScopeExporter.includeSpan` | `true` | Include character-offset span on each segment |
| `tokenScopeExporter.includePath` | `true` | Include the file path in source metadata |

## Requirements

- A language extension that contributes a TextMate grammar for the file type (most built-in languages work out of the box)
- For semantic tokens: a language server that provides them (e.g., TypeScript, Python with Pylance)

## Known Issues

- TextMate scopes are re-tokenized from the contributed grammar using vscode-textmate, not read from the live renderer. Injection grammars from third-party extensions are supported, but exact parity with the editor is not guaranteed for every file type.
- For languages where VS Code uses Tree-Sitter-based highlighting, the exported TextMate scopes may differ from what the editor visually shows.

## Release Notes

### 0.0.2

Schema changes and new settings. See [CHANGELOG](CHANGELOG.md) for details.

### 0.0.1

Initial release. See [CHANGELOG](CHANGELOG.md) for details.

## Contributing

Pull requests are welcome. Repository: [github.com/Unril/token-scope-exporter][repo]

## Development

```sh
npm install
npm run compile
# Press F5 in VS Code to launch the Extension Development Host
```

## Python Scripts

The [scripts/][scripts-dir] directory contains Python utilities for querying exported
`.tokens.yaml` files. See [scripts/README.md][scripts-readme] for usage and API details.

```bash
python scripts/token_query.py export.tokens.yaml "interface User"
```

[scripts-dir]: https://github.com/Unril/token-scope-exporter/tree/master/scripts
[scripts-readme]: https://github.com/Unril/token-scope-exporter/blob/master/scripts/README.md

## License

MIT

[repo]: https://github.com/Unril/token-scope-exporter
