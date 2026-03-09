import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vtm from "vscode-textmate";
import * as oniguruma from "vscode-oniguruma";
import { Document as YamlDocument, isMap, isScalar, isSeq, visit } from "yaml";

export type OutputFormat = "yaml" | "json";

export interface GrammarContribution {
  language?: string;
  scopeName: string;
  path: string;
  injectTo?: string[];
  extensionId: string;
  extensionUri: vscode.Uri;
}

export interface GrammarIndex {
  all: GrammarContribution[];
  byScopeName: Map<string, GrammarContribution>;
}

export interface DecodedSemanticToken {
  line: number;
  startChar: number;
  endChar: number;
  type: string;
  modifiers: string[];
}

export interface DecodedTextMateToken {
  line: number;
  startChar: number;
  endChar: number;
  scopes: string[];
}

export interface ExportSegment {
  text: string;
  span: [number, number];
  semantic: { type: string; modifiers: string[] } | null;
  textmate: { mostSpecific: string | null; scopes: string[] } | null;
}

export interface ExportLine {
  lineNumber: number;
  sourceText: string;
  segments: ExportSegment[];
}

interface ExportPayload {
  schema: string;
  note: string;
  positionEncoding: {
    lines: "1-based";
    columns: "0-based";
    endColumn: "exclusive";
  };
  exportedAt: string;
  source: {
    uri: string;
    fsPath: string;
    languageId: string;
    version: number;
  };
  grammar: {
    scopeName: string;
    relativePath: string;
    extensionId: string;
  };
  semanticLegend: {
    tokenTypes: string[];
    tokenModifiers: string[];
  } | null;
  stats: {
    lineCount: number;
    semanticTokenCount: number;
    textmateTokenCount: number;
    exportedSegmentCount: number;
  };
  lines: ExportLine[];
}

let onigLibPromise: Promise<vtm.IOnigLib> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand("tokenScopeExporter.exportActiveFile", async () => {
    try {
      await exportActiveFile();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Token Scope Exporter failed: ${message}`);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Nothing to dispose manually.
}

interface SemanticTokenResult {
  semanticLegend: vscode.SemanticTokensLegend | undefined;
  semanticTokens: vscode.SemanticTokens | undefined;
}

async function requestSemanticTokens(
  uri: vscode.Uri,
): Promise<SemanticTokenResult> {
  const [semanticLegend, semanticTokens] = await Promise.all([
    vscode.commands.executeCommand<vscode.SemanticTokensLegend | undefined>(
      "vscode.provideDocumentSemanticTokensLegend",
      uri,
    ),
    vscode.commands.executeCommand<vscode.SemanticTokens | undefined>(
      "vscode.provideDocumentSemanticTokens",
      uri,
    ),
  ]);
  return { semanticLegend, semanticTokens };
}

const SEMANTIC_RETRY_DELAY_MS = 2000;
const SEMANTIC_MAX_RETRIES = 3;

async function fetchSemanticTokens(uri: vscode.Uri): Promise<SemanticTokenResult> {
  let result = await requestSemanticTokens(uri);

  if (result.semanticLegend && result.semanticTokens) {
    return result;
  }

  for (let attempt = 1; attempt <= SEMANTIC_MAX_RETRIES; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, SEMANTIC_RETRY_DELAY_MS));
    result = await requestSemanticTokens(uri);
    if (result.semanticLegend && result.semanticTokens) {
      return result;
    }
  }

  if (!result.semanticLegend || !result.semanticTokens) {
    const detail = !result.semanticLegend
      ? "No semantic token provider responded."
      : "A provider was found but returned no tokens.";
    void vscode.window.showWarningMessage(
      `${detail} The export will contain only TextMate scopes. ` +
        "If a language server (e.g. Pylance, TypeScript) is still loading, wait a moment and re-run the export.",
    );
  }

  return result;
}


async function exportActiveFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("No active editor.");
  }

  const document = editor.document;
  if (document.isUntitled || document.uri.scheme !== "file") {
    throw new Error("Please save the file first. This command exports sidecar files next to saved local files.");
  }

  const config = vscode.workspace.getConfiguration("tokenScopeExporter", document.uri);

  const outputFormat = config.get<OutputFormat>("outputFormat", "yaml");
  const includeWhitespace = config.get<boolean>("includeWhitespace", false);
  const openAfterExport = config.get<boolean>("openAfterExport", true);

  const { semanticLegend, semanticTokens } = await fetchSemanticTokens(document.uri);

  const grammarIndex = buildGrammarIndex();
  const rootGrammar = pickRootGrammar(document.languageId, grammarIndex);
  if (!rootGrammar) {
    throw new Error(`No contributed TextMate grammar found for language '${document.languageId}'.`);
  }

  const decodedSemantic = decodeSemanticTokens(semanticTokens, semanticLegend);
  const decodedTextMate = await tokenizeWithTextMate(document, rootGrammar, grammarIndex);

  const lines = mergeTokensIntoAtomicSegments(document, decodedSemantic, decodedTextMate, includeWhitespace);

  const payload = buildPayload({
    document,
    rootGrammar,
    semanticLegend,
    decodedSemantic,
    decodedTextMate,
    lines,
  });

  await writeAndOpenExport(document.uri, payload, outputFormat, openAfterExport);
}

interface BuildPayloadInput {
  document: vscode.TextDocument;
  rootGrammar: GrammarContribution;
  semanticLegend: vscode.SemanticTokensLegend | undefined;
  decodedSemantic: DecodedSemanticToken[];
  decodedTextMate: DecodedTextMateToken[];
  lines: ExportLine[];
}

function buildPayload(input: BuildPayloadInput): ExportPayload {
  const { document, rootGrammar, semanticLegend, decodedSemantic, decodedTextMate, lines } = input;
  return {
    schema: "token-scope-export/v1",
    note:
      "Semantic tokens come from VS Code built-in semantic-token commands. " +
      "TextMate scopes are re-tokenized from the contributed grammar.",
    positionEncoding: {
      lines: "1-based",
      columns: "0-based",
      endColumn: "exclusive",
    },
    exportedAt: new Date().toISOString(),
    source: {
      uri: document.uri.toString(),
      fsPath: document.uri.fsPath,
      languageId: document.languageId,
      version: document.version,
    },
    grammar: {
      scopeName: rootGrammar.scopeName,
      relativePath: rootGrammar.path,
      extensionId: rootGrammar.extensionId,
    },
    semanticLegend: semanticLegend
      ? {
          tokenTypes: [...semanticLegend.tokenTypes],
          tokenModifiers: [...semanticLegend.tokenModifiers],
        }
      : null,
    stats: {
      lineCount: document.lineCount,
      semanticTokenCount: decodedSemantic.length,
      textmateTokenCount: decodedTextMate.length,
      exportedSegmentCount: lines.reduce((sum, line) => sum + line.segments.length, 0),
    },
    lines,
  };
}

async function writeAndOpenExport(
  sourceUri: vscode.Uri,
  payload: ExportPayload,
  outputFormat: OutputFormat,
  openAfterExport: boolean,
): Promise<void> {
  const outUri = buildOutputUri(sourceUri, outputFormat);
  const serialized = outputFormat === "json" ? JSON.stringify(payload, null, 2) : serializeYaml(payload);

  await vscode.workspace.fs.writeFile(outUri, Buffer.from(serialized, "utf8"));

  if (openAfterExport) {
    const exportedDoc = await vscode.workspace.openTextDocument(outUri);
    await vscode.window.showTextDocument(exportedDoc, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside,
    });
  }

  void vscode.window.showInformationMessage(`Token export written to ${outUri.fsPath}`);
}

function serializeYaml(payload: ExportPayload): string {
  const doc = new YamlDocument(payload, {
    version: "1.2",
    aliasDuplicateObjects: true,
  });

  const flowKeys = new Set(["span", "semantic", "textmate", "positionEncoding", "modifiers", "scopes", "stats"]);

  visit(doc, {
    Pair(_, pair) {
      if (!isScalar(pair.key)) {
        return;
      }
      const keyValue = String(pair.key.value);
      if (flowKeys.has(keyValue)) {
        const val = pair.value;
        if (isMap(val) || isSeq(val)) {
          val.flow = true;
        }
      }
    },
  });

  return doc.toString({ indent: 2, lineWidth: 0, singleQuote: true });
}

export function buildOutputUri(sourceUri: vscode.Uri, format: OutputFormat): vscode.Uri {
  const dir = path.dirname(sourceUri.fsPath);
  const base = path.basename(sourceUri.fsPath);
  return vscode.Uri.file(path.join(dir, `${base}.tokens.${format}`));
}

function buildGrammarIndex(): GrammarIndex {
  const all: GrammarContribution[] = [];
  const byScopeName = new Map<string, GrammarContribution>();

  for (const extension of vscode.extensions.all) {
    const pkg = extension.packageJSON as {
      contributes?: {
        grammars?: Array<{
          language?: string;
          scopeName?: string;
          path?: string;
          injectTo?: string[];
        }>;
      };
    };

    const grammars = pkg.contributes?.grammars ?? [];
    for (const grammar of grammars) {
      if (!grammar.scopeName || !grammar.path) {
        continue;
      }

      const entry: GrammarContribution = {
        language: grammar.language,
        scopeName: grammar.scopeName,
        path: grammar.path,
        injectTo: grammar.injectTo,
        extensionId: extension.id,
        extensionUri: extension.extensionUri,
      };

      all.push(entry);

      if (!byScopeName.has(entry.scopeName)) {
        byScopeName.set(entry.scopeName, entry);
      }
    }
  }

  return { all, byScopeName };
}

function pickRootGrammar(languageId: string, index: GrammarIndex): GrammarContribution | undefined {
  const candidates = index.all.filter((g) => g.language === languageId);
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.find((g) => !g.injectTo || g.injectTo.length === 0) ?? candidates[0];
}

export function buildInjectionIndex(grammarIndex: GrammarIndex): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const grammar of grammarIndex.all) {
    if (!grammar.injectTo || grammar.injectTo.length === 0) {
      continue;
    }

    for (const targetScope of grammar.injectTo) {
      const existing = index.get(targetScope);
      if (existing) {
        existing.push(grammar.scopeName);
      } else {
        index.set(targetScope, [grammar.scopeName]);
      }
    }
  }

  return index;
}

async function tokenizeWithTextMate(
  document: vscode.TextDocument,
  rootGrammar: GrammarContribution,
  grammarIndex: GrammarIndex,
): Promise<DecodedTextMateToken[]> {
  const injectionIndex = buildInjectionIndex(grammarIndex);

  const registry = new vtm.Registry({
    onigLib: getOnigLib(),
    loadGrammar: async (scopeName: string) => {
      const contribution = grammarIndex.byScopeName.get(scopeName);
      if (!contribution) {
        return null;
      }

      const grammarUri = vscode.Uri.joinPath(contribution.extensionUri, contribution.path);

      const bytes = await vscode.workspace.fs.readFile(grammarUri);
      const content = Buffer.from(bytes).toString("utf8");
      return vtm.parseRawGrammar(content, grammarUri.fsPath);
    },
    getInjections: (scopeName: string): string[] | undefined => {
      const injections = injectionIndex.get(scopeName);
      return injections && injections.length > 0 ? injections : undefined;
    },
  });

  const grammar = await registry.loadGrammar(rootGrammar.scopeName);
  if (!grammar) {
    throw new Error(`Failed to load TextMate grammar '${rootGrammar.scopeName}'.`);
  }

  try {
    const tokens: DecodedTextMateToken[] = [];
    let ruleStack = vtm.INITIAL;

    for (let line = 0; line < document.lineCount; line += 1) {
      const text = document.lineAt(line).text;
      const lineTokens = grammar.tokenizeLine(text, ruleStack);
      ruleStack = lineTokens.ruleStack;

      for (const token of lineTokens.tokens) {
        tokens.push({
          line,
          startChar: token.startIndex,
          endChar: token.endIndex,
          scopes: [...token.scopes],
        });
      }
    }

    return tokens;
  } finally {
    registry.dispose();
  }
}

async function getOnigLib(): Promise<vtm.IOnigLib> {
  if (!onigLibPromise) {
    onigLibPromise = (async () => {
      const wasmPath = path.join(__dirname, "onig.wasm");
      const wasmBytes = await fs.readFile(wasmPath);

      await oniguruma.loadWASM(wasmBytes);

      return {
        createOnigScanner(patterns: string[]) {
          return new oniguruma.OnigScanner(patterns);
        },
        createOnigString(text: string) {
          return new oniguruma.OnigString(text);
        },
      };
    })().catch((error: unknown) => {
      onigLibPromise = undefined;
      throw error;
    });
  }

  return onigLibPromise;
}

export function decodeSemanticTokens(
  semanticTokens: vscode.SemanticTokens | undefined,
  legend: vscode.SemanticTokensLegend | undefined,
): DecodedSemanticToken[] {
  if (!semanticTokens || !legend) {
    return [];
  }

  const out: DecodedSemanticToken[] = [];
  let line = 0;
  let char = 0;

  for (let i = 0; i < semanticTokens.data.length; i += 5) {
    const deltaLine = semanticTokens.data[i];
    const deltaStart = semanticTokens.data[i + 1];
    const length = semanticTokens.data[i + 2];
    const tokenTypeIndex = semanticTokens.data[i + 3];
    const modifierMask = semanticTokens.data[i + 4];

    line += deltaLine;
    char = deltaLine === 0 ? char + deltaStart : deltaStart;

    out.push({
      line,
      startChar: char,
      endChar: char + length,
      type: legend.tokenTypes[tokenTypeIndex] ?? `__unknown_type_${tokenTypeIndex}`,
      modifiers: decodeModifiers(modifierMask, legend.tokenModifiers),
    });
  }

  return out;
}

export function decodeModifiers(mask: number, allModifiers: readonly string[]): string[] {
  const modifiers: string[] = [];

  for (let i = 0; i < allModifiers.length; i += 1) {
    if ((mask & (1 << i)) !== 0) {
      modifiers.push(allModifiers[i]);
    }
  }

  return modifiers;
}

function mergeTokensIntoAtomicSegments(
  document: vscode.TextDocument,
  semanticTokens: DecodedSemanticToken[],
  textMateTokens: DecodedTextMateToken[],
  includeWhitespace: boolean,
): ExportLine[] {
  const semanticByLine = groupByLine(semanticTokens);
  const textMateByLine = groupByLine(textMateTokens);

  const lines: ExportLine[] = [];

  for (let line = 0; line < document.lineCount; line += 1) {
    const sourceText = document.lineAt(line).text;
    const semantic = semanticByLine.get(line) ?? [];
    const textmate = textMateByLine.get(line) ?? [];

    const boundaries = new Set<number>([0, sourceText.length]);

    for (const token of semantic) {
      boundaries.add(token.startChar);
      boundaries.add(token.endChar);
    }

    for (const token of textmate) {
      boundaries.add(token.startChar);
      boundaries.add(token.endChar);
    }

    const sorted = [...boundaries].sort((a, b) => a - b);
    const segments = buildSegmentsFromBoundaries(sourceText, sorted, semantic, textmate, includeWhitespace);

    if (segments.length > 0) {
      lines.push({
        lineNumber: line + 1,
        sourceText,
        segments,
      });
    }
  }

  return lines;
}

export function buildSegmentsFromBoundaries(
  sourceText: string,
  sortedBoundaries: number[],
  semantic: DecodedSemanticToken[],
  textmate: DecodedTextMateToken[],
  includeWhitespace: boolean,
): ExportSegment[] {
  const segments: ExportSegment[] = [];

  for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];

    if (start === end) {
      continue;
    }

    const text = sourceText.slice(start, end);
    if (!includeWhitespace && text.trim().length === 0) {
      continue;
    }

    const semanticToken = semantic.find((t) => t.startChar <= start && t.endChar >= end) ?? null;

    const textmateToken = textmate.find((t) => t.startChar <= start && t.endChar >= end) ?? null;

    if (!semanticToken && !textmateToken) {
      continue;
    }

    segments.push({
      text,
      span: [start, end],
      semantic: semanticToken
        ? {
            type: semanticToken.type,
            modifiers: semanticToken.modifiers,
          }
        : null,
      textmate: textmateToken
        ? {
            mostSpecific: textmateToken.scopes[textmateToken.scopes.length - 1] ?? null,
            scopes: textmateToken.scopes,
          }
        : null,
    });
  }

  return segments;
}

export function groupByLine<T extends { line: number }>(tokens: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();

  for (const token of tokens) {
    const bucket = map.get(token.line);
    if (bucket) {
      bucket.push(token);
    } else {
      map.set(token.line, [token]);
    }
  }

  return map;
}
