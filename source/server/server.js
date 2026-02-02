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
  IF: "ENDIF",
  FOR: "NEXT",
  DO: "LOOP",
  WHILE: "WEND",
  SUB: "END SUB",
  FUNCTION: "END FUNCTION",
  SELECT: "END SELECT",
  TYPE: "END TYPE",
  WITH: "END WITH",
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
    { label: "PRINT", kind: 14, detail: "Print to output" },
    { label: "INPUT", kind: 14, detail: "Set port to input mode" },
    { label: "DEBUG", kind: 14, detail: "Debug output" },
    { label: "DELAY", kind: 14, detail: "Pause in milliseconds" },
    { label: "OUTPUT", kind: 14, detail: "Set port to output mode" },
    { label: "IF", kind: 14, detail: "Start conditional" },
    { label: "THEN", kind: 14, detail: "Conditional branch" },
    { label: "ELSE", kind: 14, detail: "Conditional branch" },
    { label: "ENDIF", kind: 14, detail: "End conditional" },
    { label: "FOR", kind: 14, detail: "Start loop" },
    { label: "TO", kind: 14, detail: "Loop boundary" },
    { label: "STEP", kind: 14, detail: "Loop step" },
    { label: "DO", kind: 14, detail: "Start loop" },
    { label: "LOOP", kind: 14, detail: "End loop" },
    { label: "WHILE", kind: 14, detail: "Loop condition" },
    { label: "NEXT", kind: 14, detail: "End loop" },
    { label: "GOTO", kind: 14, detail: "Jump to label" },
    { label: "GOSUB", kind: 14, detail: "Call subroutine" },
    { label: "RETURN", kind: 14, detail: "Return from subroutine" },
    { label: "DIM", kind: 14, detail: "Declare array" },
    { label: "END", kind: 14, detail: "End program" },
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
      message: `Missing ${BLOCK_ENDINGS[open.type] || "END"} for ${open.type}.`,
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
        message: "IF without THEN.",
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
        message: "ELSEIF without matching IF.",
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
        message: "ELSE without matching IF.",
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
      message: "OUT REQUIRES PORT, VALUE.",
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
      message: "OUT REQUIRES PORT, VALUE (MISSING COMMA).",
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
      message: "OUT REQUIRES PORT, VALUE.",
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
      message: "OUT PORT MUST BE 0 TO 255.",
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
      message: "OUT VALUE MUST BE 0 OR 1.",
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
      message: "DEBUG REQUIRES DATA.",
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
      message: "INPUT REQUIRES PORT VALUE.",
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
      message: "INPUT PORT MUST BE 0 TO 255.",
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
      message: "OUTPUT REQUIRES PORT VALUE.",
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
      message: "OUTPUT PORT MUST BE 0 TO 255.",
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
      message: "DELAY REQUIRES MILLISECONDS VALUE.",
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
      message: "DELAY VALUE MUST BE NON-NEGATIVE.",
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
        message: "IN REQUIRES A CLOSING PARENTHESIS.",
        source: "cubloc-basic",
      });
      continue;
    }

    const argument = line.slice(openParenIndex + 1, closeParenIndex).trim();
    if (!argument) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, token.index, token.index + token.length),
        message: "IN REQUIRES A PORT VALUE.",
        source: "cubloc-basic",
      });
      continue;
    }

    const portLiteral = parseIntegerLiteral(argument);
    if (portLiteral !== null && (portLiteral < 0 || portLiteral > 255)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: makeRange(lineNumber, token.index, token.index + token.length),
        message: "IN PORT MUST BE 0 TO 255.",
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
      message: "DIM DOES NOT ALLOW MULTIPLE DECLARATIONS.",
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
      message: "DIM REQUIRES VARIABLE NAME.",
      source: "cubloc-basic",
    });
    return;
  }

  const identifier = parseIdentifier(line, cursor);
  if (!identifier) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, cursor, cursor + 1),
      message: "DIM REQUIRES VARIABLE NAME.",
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
        message: "DIM ARRAY REQUIRES CLOSING PARENTHESIS.",
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
      message: "DIM REQUIRES AS <TYPE>.",
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
      message: "DIM AS REQUIRES TYPE.",
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
      message: "INVALID DIM TYPE.",
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
        message: "ONLY STRING MAY USE * LENGTH.",
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
        message: "STRING LENGTH REQUIRED AFTER *.",
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
        message: "STRING LENGTH MUST BE A NUMBER.",
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
      message: `${context} WHILE/UNTIL must immediately follow ${context}.`,
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
      message: `${context} cannot use both WHILE and UNTIL.`,
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
      message: `${context} ${token.text} requires a condition.`,
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
      message: "LOOP without matching DO.",
      source: "cubloc-basic",
    });
    return;
  }

  const matchIndex = findOpenBlock(stack, "DO");
  if (matchIndex === -1) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(lineNumber, token.index, token.index + token.length),
      message: "LOOP without matching DO.",
      source: "cubloc-basic",
    });
    return;
  }

  for (let i = stack.length - 1; i > matchIndex; i -= 1) {
    const missing = stack[i];
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(missing.line, missing.character, missing.character + missing.length),
      message: `Missing ${BLOCK_ENDINGS[missing.type] || "END"} before LOOP.`,
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
      message: "LOOP cannot include a condition when DO already has WHILE/UNTIL.",
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
      message: `${token.text} without matching ${type}.`,
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
      message: `${token.text} without matching ${type}.`,
      source: "cubloc-basic",
    });
    return;
  }

  for (let i = stack.length - 1; i > matchIndex; i -= 1) {
    const missing = stack[i];
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: makeRange(missing.line, missing.character, missing.character + missing.length),
      message: `Missing ${BLOCK_ENDINGS[missing.type] || "END"} before ${token.text}.`,
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
  DEBUG: "**DEBUG** data\n\nSends data to the debug terminal. Use `DEC`/`HEX` for formatted numbers and `CR`/`LF` for line control.",
  DELAY: "**DELAY** n\n\nPause for *n* milliseconds.",
  DIM: "**DIM** name [ (dims) ] **AS** type [ * length ]\n\nDeclare a variable or array. Types: BYTE, INTEGER, LONG, SINGLE, STRING.",
  DO: "**DO** [WHILE|UNTIL cond] … **LOOP** [WHILE|UNTIL cond]\n\nCreates a loop; condition may appear on DO or LOOP (not both).",
  LOOP: "**LOOP** [WHILE|UNTIL cond]\n\nCloses a DO…LOOP block.",
  IN: "**IN**(port)\n\nReads the state of a GPIO port.",
  INPUT: "**INPUT** port\n\nSets the port to high‑Z input mode.",
  OUT: "**OUT** port, value\n\nWrite logic 1 or 0 to the port.",
  OUTPUT: "**OUTPUT** port\n\nSets the port mode to output.",
  PRINT: "**PRINT** data\n\nPrint to output.",
  LET: "**LET** var = expr\n\nAssign a value.",
  IF: "**IF** cond **THEN** … [**ELSE** …] **ENDIF**\n\nConditional block.",
  FOR: "**FOR** var = start **TO** end [**STEP** n] … **NEXT**\n\nCounting loop.",
};

connection.listen();
