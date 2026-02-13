# Instructions for coding agents

## Project overview
- VS Code extension for the CUBLOC BASIC language, plus a ladder diagram custom editor.
- Main extension entry: extension.js. It wires the language server, transpiler, debug adapter, and ladder webview.
- Language server lives in server/server.js (diagnostics, hover, completion).
- Transpiler lives in transpiler.js and targets MicroPython-style output.
- Ladder custom editor UI is in ladderWebview.html; ladderWebview.js only injects CSP nonce and default XML.

## Key flows to know
- On text change in a .cub file, the extension transpiles to a sibling .cub.py file (extension.js -> transpileCubToPython in transpiler.js).
- Debugger type cubloc-basic launches debugAdapter.js, which transpiles .cub to .py and uploads via mpremote.
- Ladder editor stores XML directly in the .cul file; webview sends updates through postMessage and the document is saved as XML.

## Conventions and patterns
- Language server performs full-document sync and validates line length, tabs, and block structure (server/server.js).
- Transpiler uses BASIC-like parsing (REM and single-quote comments, DO/LOOP stack) and emits Python with helper functions.
- Ladder webview HTML uses __CSP_SOURCE__ and __NONCE__ placeholders replaced at runtime (ladderWebview.js).

## Integration points
- mpremote is an external dependency for device upload; debugAdapter.js expects it on PATH or configured via mpremotePath.
- Custom editor is registered for *.cul files with viewType "cubloc-ladder" (package.json, extension.js).
- Language configuration and grammar are provided in language-configuration.json and syntaxes/cubloc-basic.tmLanguage.json.

## Practical tips
- When changing BASIC syntax or keywords, update both transpiler.js and server/server.js (completion/hover/validation).
- Webview UI changes should be done in ladderWebview.html; do not edit generated HTML inside extension.js.