import * as assert from "assert";
import * as vscode from "vscode";
import {
  decodeModifiers,
  decodeSemanticTokens,
  buildSegmentsFromBoundaries,
  groupByLine,
  buildOutputUri,
  buildInjectionIndex,
} from "../extension";
import type { DecodedSemanticToken, DecodedTextMateToken, GrammarContribution, GrammarIndex } from "../extension";

suite("decodeModifiers", () => {
  const allModifiers = ["declaration", "definition", "readonly", "static"];

  test("returns empty array for mask 0", () => {
    assert.deepStrictEqual(decodeModifiers(0, allModifiers), []);
  });

  test("decodes single modifier from bit 0", () => {
    assert.deepStrictEqual(decodeModifiers(0b0001, allModifiers), ["declaration"]);
  });

  test("decodes multiple modifiers from bitmask", () => {
    // bits 0 and 2 set -> declaration + readonly
    assert.deepStrictEqual(decodeModifiers(0b0101, allModifiers), ["declaration", "readonly"]);
  });

  test("decodes all modifiers when all bits set", () => {
    assert.deepStrictEqual(decodeModifiers(0b1111, allModifiers), ["declaration", "definition", "readonly", "static"]);
  });

  test("ignores bits beyond the modifiers array length", () => {
    assert.deepStrictEqual(decodeModifiers(0b10000, allModifiers), []);
  });

  test("handles empty modifiers array", () => {
    assert.deepStrictEqual(decodeModifiers(0b1111, []), []);
  });
});

suite("decodeSemanticTokens", () => {
  test("returns empty array when tokens are undefined", () => {
    assert.deepStrictEqual(decodeSemanticTokens(undefined, undefined), []);
  });

  test("returns empty array when legend is undefined", () => {
    const tokens = new vscode.SemanticTokens(new Uint32Array([]));
    assert.deepStrictEqual(decodeSemanticTokens(tokens, undefined), []);
  });

  test("returns empty array for empty token data with valid legend", () => {
    const tokens = new vscode.SemanticTokens(new Uint32Array([]));
    const legend = new vscode.SemanticTokensLegend(["keyword"], []);
    assert.deepStrictEqual(decodeSemanticTokens(tokens, legend), []);
  });

  test("decodes a single token on line 0", () => {
    // deltaLine=0, deltaStart=5, length=3, typeIndex=1, modifierMask=0
    const data = new Uint32Array([0, 5, 3, 1, 0]);
    const tokens = new vscode.SemanticTokens(data);
    const legend = new vscode.SemanticTokensLegend(["keyword", "variable"], ["declaration"]);

    const result = decodeSemanticTokens(tokens, legend);
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0], {
      line: 0,
      startChar: 5,
      endChar: 8,
      type: "variable",
      modifiers: [],
    });
  });

  test("decodes delta-encoded tokens across multiple lines", () => {
    const data = new Uint32Array([
      // Token 1: line 0, col 0, len 5, type 0, mods 0
      0, 0, 5, 0, 0,
      // Token 2: line +2, col 4, len 6, type 1, mods 0b01
      2, 4, 6, 1, 1,
    ]);
    const tokens = new vscode.SemanticTokens(data);
    const legend = new vscode.SemanticTokensLegend(["keyword", "variable"], ["declaration"]);

    const result = decodeSemanticTokens(tokens, legend);
    assert.strictEqual(result.length, 2);

    assert.deepStrictEqual(result[0], {
      line: 0,
      startChar: 0,
      endChar: 5,
      type: "keyword",
      modifiers: [],
    });

    assert.deepStrictEqual(result[1], {
      line: 2,
      startChar: 4,
      endChar: 10,
      type: "variable",
      modifiers: ["declaration"],
    });
  });

  test("accumulates deltaStart on same line", () => {
    const data = new Uint32Array([
      // Token 1: line 0, col 0, len 5, type 0, mods 0
      0, 0, 5, 0, 0,
      // Token 2: same line, col +6, len 3, type 0, mods 0
      0, 6, 3, 0, 0,
    ]);
    const tokens = new vscode.SemanticTokens(data);
    const legend = new vscode.SemanticTokensLegend(["keyword"], []);

    const result = decodeSemanticTokens(tokens, legend);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[1].startChar, 6);
    assert.strictEqual(result[1].endChar, 9);
  });

  test("uses fallback type name for unknown type index", () => {
    const data = new Uint32Array([0, 0, 3, 99, 0]);
    const tokens = new vscode.SemanticTokens(data);
    const legend = new vscode.SemanticTokensLegend(["keyword"], []);

    const result = decodeSemanticTokens(tokens, legend);
    assert.strictEqual(result[0].type, "__unknown_type_99");
  });
});

suite("groupByLine", () => {
  test("returns empty map for empty array", () => {
    const result = groupByLine([]);
    assert.strictEqual(result.size, 0);
  });

  test("groups tokens by their line property", () => {
    const tokens = [
      { line: 0, value: "a" },
      { line: 0, value: "b" },
      { line: 2, value: "c" },
    ];

    const result = groupByLine(tokens);
    assert.strictEqual(result.size, 2);
    assert.deepStrictEqual(result.get(0), [tokens[0], tokens[1]]);
    assert.deepStrictEqual(result.get(2), [tokens[2]]);
    assert.strictEqual(result.get(1), undefined);
  });
});

suite("buildSegmentsFromBoundaries", () => {
  test("returns empty array when no tokens cover any boundary", () => {
    const result = buildSegmentsFromBoundaries("hello world", [0, 5, 6, 11], [], [], false);
    assert.deepStrictEqual(result, []);
  });

  test("skips whitespace-only segments when includeWhitespace is false", () => {
    const semantic: DecodedSemanticToken[] = [{ line: 0, startChar: 0, endChar: 11, type: "variable", modifiers: [] }];
    const result = buildSegmentsFromBoundaries("hello world", [0, 5, 6, 11], semantic, [], false);

    const texts = result.map((s) => s.text);
    assert.ok(!texts.includes(" "));
    assert.ok(texts.includes("hello"));
    assert.ok(texts.includes("world"));
  });

  test("includes whitespace segments when includeWhitespace is true", () => {
    const semantic: DecodedSemanticToken[] = [{ line: 0, startChar: 0, endChar: 11, type: "variable", modifiers: [] }];
    const result = buildSegmentsFromBoundaries("hello world", [0, 5, 6, 11], semantic, [], true);

    const texts = result.map((s) => s.text);
    assert.ok(texts.includes(" "));
  });

  test("attaches semantic and textmate data to segments", () => {
    const semantic: DecodedSemanticToken[] = [
      { line: 0, startChar: 0, endChar: 5, type: "keyword", modifiers: ["declaration"] },
    ];
    const textmate: DecodedTextMateToken[] = [
      { line: 0, startChar: 0, endChar: 5, scopes: ["source.ts", "storage.type.ts"] },
    ];

    const result = buildSegmentsFromBoundaries("const", [0, 5], semantic, textmate, false);

    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].semantic, {
      type: "keyword",
      modifiers: ["declaration"],
    });
    assert.deepStrictEqual(result[0].textmate, {
      scope: "storage.type.ts",
      rest: ["source.ts"],
    });
  });

  test("omits semantic when no semantic token covers the span", () => {
    const textmate: DecodedTextMateToken[] = [{ line: 0, startChar: 0, endChar: 5, scopes: ["source.ts"] }];

    const result = buildSegmentsFromBoundaries("const", [0, 5], [], textmate, false);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].semantic, undefined);
    assert.ok(result[0].textmate !== null);
  });

  test("produces correct span coordinates", () => {
    const textmate: DecodedTextMateToken[] = [{ line: 0, startChar: 0, endChar: 10, scopes: ["source.ts"] }];

    const result = buildSegmentsFromBoundaries("const foo;", [0, 5, 6, 9, 10], [], textmate, false);

    assert.deepStrictEqual(result[0].span, [0, 5]);
    assert.strictEqual(result[0].text, "const");
  });

  test("skips zero-width boundary pairs", () => {
    const textmate: DecodedTextMateToken[] = [{ line: 0, startChar: 0, endChar: 3, scopes: ["source.ts"] }];

    const result = buildSegmentsFromBoundaries("foo", [0, 0, 3], [], textmate, false);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].text, "foo");
  });

  test("omits span when includeSpan is false", () => {
    const textmate: DecodedTextMateToken[] = [{ line: 0, startChar: 0, endChar: 3, scopes: ["source.ts"] }];

    const result = buildSegmentsFromBoundaries("foo", [0, 3], [], textmate, false, false);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].span, undefined);
  });

  test("includes span when includeSpan is true", () => {
    const textmate: DecodedTextMateToken[] = [{ line: 0, startChar: 0, endChar: 3, scopes: ["source.ts"] }];

    const result = buildSegmentsFromBoundaries("foo", [0, 3], [], textmate, false, true);

    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].span, [0, 3]);
  });

  test("omits modifiers key when semantic token has no modifiers", () => {
    const semantic: DecodedSemanticToken[] = [
      { line: 0, startChar: 0, endChar: 3, type: "variable", modifiers: [] },
    ];

    const result = buildSegmentsFromBoundaries("foo", [0, 3], semantic, [], false);

    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].semantic, { type: "variable" });
  });
});

suite("buildOutputUri", () => {
  test("appends .tokens.yaml for yaml format", () => {
    const source = vscode.Uri.file("/work/project/foo.ts");
    const result = buildOutputUri(source, "yaml");
    assert.strictEqual(result.fsPath, "/work/project/foo.ts.tokens.yaml");
  });

  test("appends .tokens.json for json format", () => {
    const source = vscode.Uri.file("/work/project/foo.ts");
    const result = buildOutputUri(source, "json");
    assert.strictEqual(result.fsPath, "/work/project/foo.ts.tokens.json");
  });

  test("preserves the source directory", () => {
    const source = vscode.Uri.file("/work/project/src/bar.py");
    const result = buildOutputUri(source, "yaml");
    assert.strictEqual(result.fsPath, "/work/project/src/bar.py.tokens.yaml");
  });
});

function makeGrammar(scopeName: string, injectTo?: string[], language?: string): GrammarContribution {
  return {
    scopeName,
    path: `./syntaxes/${scopeName}.json`,
    extensionId: "test.ext",
    extensionUri: vscode.Uri.file("/test"),
    injectTo,
    language,
  };
}

function makeIndex(grammars: GrammarContribution[]): GrammarIndex {
  const byScopeName = new Map<string, GrammarContribution>();
  for (const g of grammars) {
    if (!byScopeName.has(g.scopeName)) {
      byScopeName.set(g.scopeName, g);
    }
  }
  return { all: grammars, byScopeName };
}

suite("buildInjectionIndex", () => {
  test("returns empty map when no grammars have injectTo", () => {
    const index = makeIndex([
      makeGrammar("source.ts", undefined, "typescript"),
      makeGrammar("source.python", undefined, "python"),
    ]);

    const result = buildInjectionIndex(index);
    assert.strictEqual(result.size, 0);
  });

  test("maps injection grammar to its target scope", () => {
    const index = makeIndex([
      makeGrammar("text.html.markdown", undefined, "markdown"),
      makeGrammar("markdown.kotlin.codeblock", ["text.html.markdown"]),
    ]);

    const result = buildInjectionIndex(index);
    assert.strictEqual(result.size, 1);
    assert.deepStrictEqual(result.get("text.html.markdown"), ["markdown.kotlin.codeblock"]);
  });

  test("collects multiple injections for the same target", () => {
    const index = makeIndex([
      makeGrammar("text.html.markdown", undefined, "markdown"),
      makeGrammar("markdown.kotlin.codeblock", ["text.html.markdown"]),
      makeGrammar("markdown.rust.codeblock", ["text.html.markdown"]),
    ]);

    const result = buildInjectionIndex(index);
    assert.strictEqual(result.size, 1);
    const injections = result.get("text.html.markdown");
    assert.strictEqual(injections?.length, 2);
    assert.ok(injections?.includes("markdown.kotlin.codeblock"));
    assert.ok(injections?.includes("markdown.rust.codeblock"));
  });

  test("handles grammar injecting into multiple targets", () => {
    const index = makeIndex([makeGrammar("some.injection", ["text.html.markdown", "source.gfm"])]);

    const result = buildInjectionIndex(index);
    assert.strictEqual(result.size, 2);
    assert.deepStrictEqual(result.get("text.html.markdown"), ["some.injection"]);
    assert.deepStrictEqual(result.get("source.gfm"), ["some.injection"]);
  });

  test("ignores grammars with empty injectTo array", () => {
    const index = makeIndex([makeGrammar("source.ts", [], "typescript")]);

    const result = buildInjectionIndex(index);
    assert.strictEqual(result.size, 0);
  });
});
