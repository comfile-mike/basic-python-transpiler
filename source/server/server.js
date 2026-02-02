"use strict";

const {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  DiagnosticSeverity,
} = require("vscode-languageserver/node");

const connection = createConnection(ProposedFeatures.all);
const documents = new Map();
const BLOCK_ENDINGS = {
  IF: "End If",
  FOR: "Next",
  DO: "Loop",
  WHILE: "Wend",
  SUB: "End Sub",
  FUNCTION: "End Function",
  SELECT: "End Select",
  TYPE: "End Type",
  WITH: "End With",
};

connection.onInitialize(() => {
  return {
    capabilities: {
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [" "],
      },
      hoverProvider: true,
      textDocumentSync: TextDocumentSyncKind.Full,
    },
  };
});

connection.onCompletion(() => {
  return [
    { label: "Print", kind: 14, detail: "Print to output" },
    { label: "Input", kind: 14, detail: "Set port to input mode" },
    { label: "Debug", kind: 14, detail: "Debug output" },
    { label: "Delay", kind: 14, detail: "Pause in milliseconds" },
    { label: "Output", kind: 14, detail: "Set port to output mode" },
    { label: "If", kind: 14, detail: "Start conditional" },
    { label: "Then", kind: 14, detail: "Conditional branch" },
    { label: "Else", kind: 14, detail: "Conditional branch" },
    { label: "End If", kind: 14, detail: "End conditional" },
    { label: "For", kind: 14, detail: "Start loop" },
    { label: "To", kind: 14, detail: "Loop boundary" },
    { label: "Step", kind: 14, detail: "Loop step" },
    { label: "Do", kind: 14, detail: "Start loop" },
    { label: "Loop", kind: 14, detail: "End loop" },
    { label: "While", kind: 14, detail: "Loop condition" },
    { label: "Next", kind: 14, detail: "End loop" },
    { label: "GoTo", kind: 14, detail: "Jump to label" },
    { label: "GoSub", kind: 14, detail: "Call subroutine" },
    { label: "Return", kind: 14, detail: "Return from subroutine" },
    { label: "Dim", kind: 14, detail: "Declare array" },
    { label: "End", kind: 14, detail: "End program" },
  ];
});

connection.onDidOpenTextDocument((params) => {
  documents.set(params.textDocument.uri, params.textDocument.text);
  validateText(params.textDocument.uri, params.textDocument.text);
});

connection.onDidChangeTextDocument((params) => {
  const text = params.contentChanges[0]?.text ?? "";
  documents.set(params.textDocument.uri, text);
  validateText(params.textDocument.uri, text);
});

connection.onDidCloseTextDocument((params) => {
  documents.delete(params.textDocument.uri);
  connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics: [] });
});

connection.onHover((params) => {
  const text = documents.get(params.textDocument.uri);
  if (!text) {
    return null;
  }

  const lineText = text.split(/\r?\n/)[params.position.line] ?? "";
  const word = getWordAt(lineText, params.position.character);
  if (!word) {
    return null;
  }

  const info = HOVER_DOCS[word];
  if (!info) {
    return null;
  }

  return {
    contents: {
      kind: "markdown",
      value: info,
    },
  };
});

function validateText(uri, text) {
  const diagnostics = [];
  const lines = text.split(/\r?\n/);
  const stack = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const tokens = getTokens(line);

    if (line.length > 120) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line: i, character: 120 },
          end: { line: i, character: line.length },
        },
        message: "Line exceeds 120 characters.",
        source: "cubloc-basic",
      });
    }

    if (/[\t]/.test(line)) {
      const tabIndex = line.indexOf("\t");
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: {
          start: { line: i, character: tabIndex },
          end: { line: i, character: tabIndex + 1 },
        },
        message: "Tab character found; prefer spaces.",
        source: "cubloc-basic",
      });
    }

    if (tokens.length > 0) {
      validateSyntaxLine(tokens, i, line, diagnostics, stack);
    }
  }

  while (stack.length > 0) {
    const open = stack.pop();
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(open.line, open.character, open.character + open.length),
      message: `Missing ${BLOCK_ENDINGS[open.type] || "End"} for ${formatKeyword(open.type)}.`,
      source: "cubloc-basic",
    });
  }

  connection.sendDiagnostics({ uri, diagnostics });
}

function getTokens(line) {
  const tokens = [];
  let inString = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inString) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "'") {
      break;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) {
        i += 1;
      }
      const word = line.slice(start, i).toUpperCase();
      if (word === "REM") {
        break;
      }
      tokens.push({ text: word, index: start, length: i - start });
      i -= 1;
    }
  }

  return tokens;
}

function getWordAt(line, character) {
  if (character < 0 || character > line.length) {
    return null;
  }

  let start = character;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) {
    start -= 1;
  }

  let end = character;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end])) {
    end += 1;
  }

  if (start === end) {
    return null;
  }

  const word = line.slice(start, end);
  if (!/^[A-Za-z_]/.test(word)) {
    return null;
  }

  return word.toUpperCase();
}

const KEYWORD_TITLE = {
  IF: "If",
  THEN: "Then",
  ELSE: "Else",
  ELSEIF: "ElseIf",
  ENDIF: "End If",
  FOR: "For",
  TO: "To",
  STEP: "Step",
  NEXT: "Next",
  DO: "Do",
  LOOP: "Loop",
  WHILE: "While",
  WEND: "Wend",
  UNTIL: "Until",
  SUB: "Sub",
  FUNCTION: "Function",
  TYPE: "Type",
  WITH: "With",
  SELECT: "Select",
  END: "End",
  GOTO: "GoTo",
  GOSUB: "GoSub",
  RETURN: "Return",
  DIM: "Dim",
  INPUT: "Input",
  OUTPUT: "Output",
  OUT: "Out",
  DEBUG: "Debug",
  DELAY: "Delay",
  PRINT: "Print",
  LET: "Let",
  IN: "In",
  CONST: "Const",
  OPTION: "Option",
  DECLARE: "Declare",
  PUBLIC: "Public",
  PRIVATE: "Private",
  SHARED: "Shared",
  STATIC: "Static",
  GLOBAL: "Global",
  LOCAL: "Local",
  BYVAL: "ByVal",
  BYREF: "ByRef",
  ALIAS: "Alias",
  LIB: "Lib",
};

function formatKeyword(word) {
  return KEYWORD_TITLE[word] || word;
}

function validateSyntaxLine(tokens, lineNumber, line, diagnostics, stack) {
  const first = tokens[0]?.text;
  const second = tokens[1]?.text;
  const cleanLine = stripComments(line);

  if (first === "IF") {
    const thenIndex = tokens.findIndex((token) => token.text === "THEN");
    if (thenIndex === -1) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, tokens[0].index, tokens[0].index + tokens[0].length),
        message: "If without Then.",
        source: "cubloc-basic",
      });
    } else if (thenIndex === tokens.length - 1) {
      pushBlock(stack, "IF", tokens[0], lineNumber);
    }
    return;
  }

  if (first === "ELSEIF" || (first === "ELSE" && second === "IF")) {
    if (!hasOpenBlock(stack, "IF")) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, tokens[0].index, tokens[0].index + tokens[0].length),
        message: "ElseIf without matching If.",
        source: "cubloc-basic",
      });
    }
    return;
  }

  if (first === "ELSE") {
    if (!hasOpenBlock(stack, "IF")) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, tokens[0].index, tokens[0].index + tokens[0].length),
        message: "Else without matching If.",
        source: "cubloc-basic",
      });
    }
    return;
  }

  if (first === "ENDIF" || (first === "END" && second === "IF")) {
    popBlock(stack, "IF", tokens[0], lineNumber, diagnostics);
    return;
  }

  if (first === "FOR") {
    pushBlock(stack, "FOR", tokens[0], lineNumber);
    return;
  }

  if (first === "NEXT") {
    popBlock(stack, "FOR", tokens[0], lineNumber, diagnostics);
    return;
  }

  if (first === "DO") {
    const loopIndex = tokens.findIndex((token) => token.text === "LOOP");
    if (loopIndex !== -1) {
      const doTokens = tokens.slice(0, loopIndex);
      const loopTokens = tokens.slice(loopIndex);
      handleDoLine(doTokens, lineNumber, diagnostics, stack);
      handleLoopLine(loopTokens, lineNumber, diagnostics, stack);
      return;
    }
    handleDoLine(tokens, lineNumber, diagnostics, stack);
    return;
  }

  if (first === "LOOP") {
    handleLoopLine(tokens, lineNumber, diagnostics, stack);
    return;
  }

  if (first === "WHILE") {
    pushBlock(stack, "WHILE", tokens[0], lineNumber);
    return;
  }

  if (first === "WEND") {
    popBlock(stack, "WHILE", tokens[0], lineNumber, diagnostics);
    return;
  }

  if (first === "SUB") {
    pushBlock(stack, "SUB", tokens[0], lineNumber);
    return;
  }

  if (first === "FUNCTION") {
    pushBlock(stack, "FUNCTION", tokens[0], lineNumber);
    return;
  }

  if (first === "TYPE") {
    pushBlock(stack, "TYPE", tokens[0], lineNumber);
    return;
  }

  if (first === "WITH") {
    pushBlock(stack, "WITH", tokens[0], lineNumber);
    return;
  }

  if (first === "SELECT") {
    pushBlock(stack, "SELECT", tokens[0], lineNumber);
    return;
  }

  if (first === "END") {
    if (second === "SUB") {
      popBlock(stack, "SUB", tokens[0], lineNumber, diagnostics);
      return;
    }
    if (second === "FUNCTION") {
      popBlock(stack, "FUNCTION", tokens[0], lineNumber, diagnostics);
      return;
    }
    if (second === "SELECT") {
      popBlock(stack, "SELECT", tokens[0], lineNumber, diagnostics);
      return;
    }
    if (second === "TYPE") {
      popBlock(stack, "TYPE", tokens[0], lineNumber, diagnostics);
      return;
    }
    if (second === "WITH") {
      popBlock(stack, "WITH", tokens[0], lineNumber, diagnostics);
      return;
    }
  }

  if (first === "OUT") {
    validateOutStatement(tokens[0], cleanLine, lineNumber, diagnostics);
  }

  if (first === "DEBUG") {
    validateDebugStatement(tokens[0], cleanLine, lineNumber, diagnostics);
  }

  if (first === "INPUT") {
    validateInputStatement(tokens[0], cleanLine, lineNumber, diagnostics);
  }

  if (first === "OUTPUT") {
    validateOutputStatement(tokens[0], cleanLine, lineNumber, diagnostics);
  }

  if (first === "DELAY") {
    validateDelayStatement(tokens[0], cleanLine, lineNumber, diagnostics);
  }

  if (first === "DIM") {
    validateDimStatement(tokens[0], cleanLine, lineNumber, diagnostics);
  }

  validateInFunctionUsage(tokens, cleanLine, lineNumber, diagnostics);
}

function validateOutStatement(keywordToken, cleanLine, lineNumber, diagnostics) {
  const afterKeyword = cleanLine.slice(keywordToken.index + keywordToken.length);
  const remainder = afterKeyword.trim();

  if (!remainder) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Out requires port, value.",
      source: "cubloc-basic",
    });
    return;
  }

  const commaIndex = remainder.indexOf(",");
  if (commaIndex === -1) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Out requires port, value (missing comma).",
      source: "cubloc-basic",
    });
    return;
  }

  const portText = remainder.slice(0, commaIndex).trim();
  const valueText = remainder.slice(commaIndex + 1).trim();

  if (!portText || !valueText) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Out requires port, value.",
      source: "cubloc-basic",
    });
    return;
  }

  const portLiteral = parseIntegerLiteral(portText);
  if (portLiteral !== null && (portLiteral < 0 || portLiteral > 255)) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Out port must be 0 to 255.",
      source: "cubloc-basic",
    });
  }

  const valueLiteral = parseIntegerLiteral(valueText);
  if (valueLiteral !== null && valueLiteral !== 0 && valueLiteral !== 1) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Out value must be 0 or 1.",
      source: "cubloc-basic",
    });
  }
}

function validateDebugStatement(keywordToken, cleanLine, lineNumber, diagnostics) {
  const afterKeyword = cleanLine.slice(keywordToken.index + keywordToken.length);
  const remainder = afterKeyword.trim();

  if (!remainder) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Debug requires data.",
      source: "cubloc-basic",
    });
  }
}

function validateInputStatement(keywordToken, cleanLine, lineNumber, diagnostics) {
  const afterKeyword = cleanLine.slice(keywordToken.index + keywordToken.length);
  const remainder = afterKeyword.trim();

  if (!remainder) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Input requires port value.",
      source: "cubloc-basic",
    });
    return;
  }

  const portLiteral = parseIntegerLiteral(remainder);
  if (portLiteral !== null && (portLiteral < 0 || portLiteral > 255)) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Input port must be 0 to 255.",
      source: "cubloc-basic",
    });
  }
}

function validateOutputStatement(keywordToken, cleanLine, lineNumber, diagnostics) {
  const afterKeyword = cleanLine.slice(keywordToken.index + keywordToken.length);
  const remainder = afterKeyword.trim();

  if (!remainder) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Output requires port value.",
      source: "cubloc-basic",
    });
    return;
  }

  const portLiteral = parseIntegerLiteral(remainder);
  if (portLiteral !== null && (portLiteral < 0 || portLiteral > 255)) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Output port must be 0 to 255.",
      source: "cubloc-basic",
    });
  }
}

function validateDelayStatement(keywordToken, cleanLine, lineNumber, diagnostics) {
  const afterKeyword = cleanLine.slice(keywordToken.index + keywordToken.length);
  const remainder = afterKeyword.trim();

  if (!remainder) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Delay requires milliseconds value.",
      source: "cubloc-basic",
    });
    return;
  }

  const literal = parseIntegerLiteral(remainder);
  if (literal !== null && literal < 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Delay value must be non-negative.",
      source: "cubloc-basic",
    });
  }
}

function validateInFunctionUsage(tokens, line, lineNumber, diagnostics) {
  for (const token of tokens) {
    if (token.text !== "IN") {
      continue;
    }

    const searchStart = token.index + token.length;
    const afterToken = line.slice(searchStart);
    const openParenOffset = afterToken.search(/\S/);
    if (openParenOffset === -1) {
      continue;
    }

    const openParenIndex = searchStart + openParenOffset;
    if (line[openParenIndex] !== "(") {
      continue;
    }

    const closeParenIndex = findMatchingParen(line, openParenIndex);
    if (closeParenIndex === -1) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, token.index, token.index + token.length),
      message: "In requires a closing parenthesis.",
      source: "cubloc-basic",
    });
      continue;
    }

    const argument = line.slice(openParenIndex + 1, closeParenIndex).trim();
    if (!argument) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, token.index, token.index + token.length),
      message: "In requires a port value.",
      source: "cubloc-basic",
    });
      continue;
    }

    const portLiteral = parseIntegerLiteral(argument);
    if (portLiteral !== null && (portLiteral < 0 || portLiteral > 255)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, token.index, token.index + token.length),
      message: "In port must be 0 to 255.",
      source: "cubloc-basic",
    });
    }
  }
}

function validateDimStatement(keywordToken, line, lineNumber, diagnostics) {
  const startIndex = keywordToken.index + keywordToken.length;
  const commaIndex = findTopLevelComma(line, startIndex);
  if (commaIndex !== -1) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Dim does not allow multiple declarations.",
      source: "cubloc-basic",
    });
    return;
  }

  let cursor = startIndex;
  cursor = skipWhitespace(line, cursor);
  if (cursor >= line.length) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Dim requires variable name.",
      source: "cubloc-basic",
    });
    return;
  }

  const identifier = parseIdentifier(line, cursor);
  if (!identifier) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, cursor, cursor + 1),
      message: "Dim requires variable name.",
      source: "cubloc-basic",
    });
    return;
  }

  cursor = identifier.end;
  cursor = skipWhitespace(line, cursor);

  if (line[cursor] === "(") {
    const closeParen = findMatchingParen(line, cursor);
    if (closeParen === -1) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, cursor, cursor + 1),
      message: "Dim array requires closing parenthesis.",
      source: "cubloc-basic",
    });
      return;
    }
    cursor = closeParen + 1;
  }

  const remaining = line.slice(cursor);
  const asMatch = /^\s*AS\b/i.exec(remaining);
  if (!asMatch) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        keywordToken.index,
        keywordToken.index + keywordToken.length
      ),
      message: "Dim requires As <Type>.",
      source: "cubloc-basic",
    });
    return;
  }

  cursor += asMatch[0].length;
  cursor = skipWhitespace(line, cursor);

  const typeIdentifier = parseIdentifier(line, cursor);
  if (!typeIdentifier) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, cursor, cursor + 1),
      message: "Dim As requires Type.",
      source: "cubloc-basic",
    });
    return;
  }

  const type = typeIdentifier.name.toUpperCase();
  const allowedTypes = new Set(["BYTE", "INTEGER", "LONG", "SINGLE", "STRING"]);
  if (!allowedTypes.has(type)) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        typeIdentifier.start,
        typeIdentifier.end
      ),
      message: "Invalid Dim Type.",
      source: "cubloc-basic",
    });
    return;
  }

  cursor = typeIdentifier.end;
  cursor = skipWhitespace(line, cursor);

  if (line[cursor] === "*") {
    if (type !== "STRING") {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, cursor, cursor + 1),
        message: "Only String may use * length.",
        source: "cubloc-basic",
      });
      return;
    }

    cursor = skipWhitespace(line, cursor + 1);
    const lengthIdentifier = parseIdentifier(line, cursor);
    if (!lengthIdentifier) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, cursor, cursor + 1),
        message: "String length required after *.",
        source: "cubloc-basic",
      });
      return;
    }

    const lengthValue = parseIntegerLiteral(
      line.slice(lengthIdentifier.start, lengthIdentifier.end)
    );
    if (lengthValue === null) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(
          lineNumber,
          lengthIdentifier.start,
          lengthIdentifier.end
        ),
        message: "String length must be a number.",
        source: "cubloc-basic",
      });
    }
  }
}

function stripComments(line) {
  let inString = false;
  let commentIndex = line.length;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "'") {
      commentIndex = i;
      break;
    }
  }

  const remMatch = /\bREM\b/i.exec(line);
  if (remMatch && remMatch.index < commentIndex) {
    commentIndex = remMatch.index;
  }

  return line.slice(0, commentIndex);
}

function parseIntegerLiteral(text) {
  if (!/^\d+$/.test(text)) {
    return null;
  }
  return Number.parseInt(text, 10);
}

function parseIdentifier(line, startIndex) {
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(startIndex));
  if (!match) {
    return null;
  }
  return {
    name: match[0],
    start: startIndex,
    end: startIndex + match[0].length,
  };
}

function skipWhitespace(line, index) {
  let cursor = index;
  while (cursor < line.length && /\s/.test(line[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function findTopLevelComma(line, startIndex) {
  let depth = 0;
  let inString = false;

  for (let i = startIndex; i < line.length; i += 1) {
    const ch = line[i];

    if (inString) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      continue;
    }

    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (ch === "," && depth === 0) {
      return i;
    }
  }

  return -1;
}

function findMatchingParen(line, openIndex) {
  let depth = 0;
  let inString = false;

  for (let i = openIndex + 1; i < line.length; i += 1) {
    const ch = line[i];

    if (inString) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      continue;
    }

    if (ch === ")") {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    }
  }

  return -1;
}

function handleDoLine(tokens, lineNumber, diagnostics, stack) {
  const condition = parseLoopCondition(
    tokens,
    1,
    tokens.length,
    lineNumber,
    diagnostics,
    "DO"
  );

  if (condition && condition.missingExpression) {
    return;
  }

  const entry = pushBlock(stack, "DO", tokens[0], lineNumber);
  if (condition) {
    entry.conditionPlacement = "do";
    entry.conditionKind = condition.kind;
  }
}

function handleLoopLine(tokens, lineNumber, diagnostics, stack) {
  const condition = parseLoopCondition(
    tokens,
    1,
    tokens.length,
    lineNumber,
    diagnostics,
    "LOOP"
  );

  if (condition && condition.missingExpression) {
    return;
  }

  popDoBlock(stack, tokens[0], lineNumber, diagnostics, condition);
}

function parseLoopCondition(tokens, startIndex, endIndex, lineNumber, diagnostics, context) {
  const immediate = tokens[startIndex];
  const immediateIsWhile =
    immediate && (immediate.text === "WHILE" || immediate.text === "UNTIL");

  let whileToken = null;
  let untilToken = null;

  for (let i = startIndex; i < endIndex; i += 1) {
    if (tokens[i].text === "WHILE") {
      whileToken = tokens[i];
    } else if (tokens[i].text === "UNTIL") {
      untilToken = tokens[i];
    }
  }

  if (!immediateIsWhile && (whileToken || untilToken)) {
    const misplaced = whileToken || untilToken;
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, misplaced.index, misplaced.index + misplaced.length),
      message: `${formatKeyword(context)} While/Until must immediately follow ${formatKeyword(context)}.`,
      source: "cubloc-basic",
    });
    return { kind: "MISPLACED", missingExpression: true };
  }

  if (whileToken && untilToken) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(
        lineNumber,
        Math.min(whileToken.index, untilToken.index),
        Math.max(
          whileToken.index + whileToken.length,
          untilToken.index + untilToken.length
        )
      ),
      message: `${formatKeyword(context)} cannot use both While and Until.`,
      source: "cubloc-basic",
    });
    return { kind: "BOTH", missingExpression: true };
  }

  const token = immediateIsWhile ? immediate : whileToken || untilToken;
  if (!token) {
    return null;
  }

  if (token.index === tokens[endIndex - 1].index) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, token.index, token.index + token.length),
      message: `${formatKeyword(context)} ${formatKeyword(token.text)} requires a condition.`,
      source: "cubloc-basic",
    });
    return { kind: token.text, missingExpression: true };
  }

  return { kind: token.text, missingExpression: false };
}

function popDoBlock(stack, token, lineNumber, diagnostics, condition) {
  if (stack.length === 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, token.index, token.index + token.length),
      message: "Loop without matching Do.",
      source: "cubloc-basic",
    });
    return;
  }

  const matchIndex = findOpenBlock(stack, "DO");
  if (matchIndex === -1) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, token.index, token.index + token.length),
      message: "Loop without matching Do.",
      source: "cubloc-basic",
    });
    return;
  }

  for (let i = stack.length - 1; i > matchIndex; i -= 1) {
    const missing = stack[i];
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(missing.line, missing.character, missing.character + missing.length),
      message: `Missing ${BLOCK_ENDINGS[missing.type] || "End"} before Loop.`,
      source: "cubloc-basic",
    });
  }

  const doBlock = stack[matchIndex];
  stack.length = matchIndex;
  stack.pop();

  if (condition && doBlock.conditionPlacement === "do") {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, token.index, token.index + token.length),
      message: "Loop cannot include a condition when Do already has While/Until.",
      source: "cubloc-basic",
    });
  }
}

function pushBlock(stack, type, token, lineNumber) {
  const entry = {
    type,
    line: lineNumber,
    character: token.index,
    length: token.length,
  };
  stack.push(entry);
  return entry;
}

function popBlock(stack, type, token, lineNumber, diagnostics) {
  if (stack.length === 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, token.index, token.index + token.length),
      message: `${formatKeyword(token.text)} without matching ${formatKeyword(type)}.`,
      source: "cubloc-basic",
    });
    return;
  }

  if (stack[stack.length - 1].type === type) {
    stack.pop();
    return;
  }

  const matchIndex = findOpenBlock(stack, type);
  if (matchIndex === -1) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, token.index, token.index + token.length),
      message: `${formatKeyword(token.text)} without matching ${formatKeyword(type)}.`,
      source: "cubloc-basic",
    });
    return;
  }

  for (let i = stack.length - 1; i > matchIndex; i -= 1) {
    const missing = stack[i];
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(missing.line, missing.character, missing.character + missing.length),
      message: `Missing ${BLOCK_ENDINGS[missing.type] || "End"} before ${formatKeyword(token.text)}.`,
      source: "cubloc-basic",
    });
  }

  stack.length = matchIndex;
  stack.pop();
}

function hasOpenBlock(stack, type) {
  return findOpenBlock(stack, type) !== -1;
}

function findOpenBlock(stack, type) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].type === type) {
      return i;
    }
  }
  return -1;
}

function makeRange(line, start, end) {
  return {
    start: { line, character: start },
    end: { line, character: end },
  };
}

const HOVER_DOCS = {
  DEBUG: "**Debug** data\n\nSends data to the debug terminal. Use `Dec`/`Hex` for formatted numbers and `CR`/`LF` for line control.",
  DELAY: "**Delay** n\n\nPause for *n* milliseconds.",
  DIM: "**Dim** name [ (dims) ] **As** type [ * length ]\n\nDeclare a variable or array. Types: Byte, Integer, Long, Single, String.",
  DO: "**Do** [While|Until cond] … **Loop** [While|Until cond]\n\nCreates a loop; condition may appear on Do or Loop (not both).",
  LOOP: "**Loop** [While|Until cond]\n\nCloses a Do…Loop block.",
  IN: "**In**(port)\n\nReads the state of a GPIO port.",
  INPUT: "**Input** port\n\nSets the port to high‑Z input mode.",
  OUT: "**Out** port, value\n\nWrite logic 1 or 0 to the port.",
  OUTPUT: "**Output** port\n\nSets the port mode to output.",
  PRINT: "**Print** data\n\nPrint to output.",
  LET: "**Let** var = expr\n\nAssign a value.",
  IF: "**If** cond **Then** … [**Else** …] **End If**\n\nConditional block.",
  FOR: "**For** var = start **To** end [**Step** n] … **Next**\n\nCounting loop.",
};

connection.listen();

