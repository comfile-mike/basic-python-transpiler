"use strict";

const path = require("path");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
const { transpileBasToPython } = require("./transpiler");

let client;
let transpileController;
let transpileTimer;
let debugProvider;

function activate(context) {
  const serverModule = context.asAbsolutePath(path.join("server", "server.js"));

  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions = {
    documentSelector: [{ scheme: "file", language: "cubloc-basic" }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.bas"),
    },
  };

  client = new LanguageClient(
    "cublocBasicLanguageServer",
    "CUBLOC BASIC Language Server",
    serverOptions,
    clientOptions
  );

  context.subscriptions.push(client.start());

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      scheduleTranspile(event.document);
    })
  );

  debugProvider = vscode.debug.registerDebugConfigurationProvider(
    "cubloc-basic",
    {
      provideDebugConfigurations() {
        return [
          {
            type: "cubloc-basic",
            request: "launch",
            name: "CUBLOC BASIC: Upload to device",
            program: "${file}",
            serialPort: "COM3",
          },
        ];
      },
      async resolveDebugConfiguration(folder, config) {
        const resolved = { ...config };

        if (!resolved.type && !resolved.request && !resolved.name) {
          resolved.type = "cubloc-basic";
          resolved.request = "launch";
          resolved.name = "CUBLOC BASIC: Upload to device";
        }

        if (!resolved.program) {
          const active = vscode.window.activeTextEditor;
          if (active && active.document.uri.scheme === "file") {
            resolved.program = active.document.uri.fsPath;
          } else {
            const pick = await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters: { "CUBLOC BASIC": ["bas"] },
              title: "Select a CUBLOC BASIC file to upload",
            });
            if (!pick || pick.length === 0) {
              return undefined;
            }
            resolved.program = pick[0].fsPath;
          }
        }

        if (!resolved.serialPort) {
          const port = await vscode.window.showInputBox({
            prompt: "Serial port for the CUBLOC BASIC device",
            placeHolder: "COM3 or /dev/ttyUSB0",
            value: "COM3",
            ignoreFocusOut: true,
          });
          if (!port) {
            return undefined;
          }
          resolved.serialPort = port.trim();
          await ensureLaunchProfile(folder, resolved);
        }

        return resolved;
      },
    }
  );
  context.subscriptions.push(debugProvider);
}

function deactivate() {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

async function ensureLaunchProfile(folder, config) {
  const workspaceFolder =
    folder || (vscode.workspace.workspaceFolders || [])[0];
  if (!workspaceFolder) {
    return;
  }

  const launchUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    ".vscode",
    "launch.json"
  );

  let launchData = { version: "0.2.0", configurations: [] };
  try {
    const raw = await vscode.workspace.fs.readFile(launchUri);
    const text = Buffer.from(raw).toString("utf8");
    launchData = JSON.parse(text);
  } catch (error) {
    // If file doesn't exist or is invalid, create a fresh launch.json.
  }

  if (!Array.isArray(launchData.configurations)) {
    launchData.configurations = [];
  }

  const existingIndex = launchData.configurations.findIndex(
    (entry) =>
      entry &&
      entry.type === "cubloc-basic" &&
      entry.request === "launch" &&
      entry.name === config.name
  );

  const configToWrite = {
    type: "cubloc-basic",
    request: "launch",
    name: config.name || "CUBLOC BASIC: Upload to device",
    program: config.program || "${file}",
    serialPort: config.serialPort,
  };

  if (existingIndex >= 0) {
    launchData.configurations[existingIndex] = {
      ...launchData.configurations[existingIndex],
      ...configToWrite,
    };
  } else {
    launchData.configurations.push(configToWrite);
  }

  const text = JSON.stringify(launchData, null, 2);
  await vscode.workspace.fs.writeFile(
    launchUri,
    Buffer.from(text, "utf8")
  );
}

function scheduleTranspile(document) {
  if (!shouldTranspile(document)) {
    return;
  }

  if (transpileTimer) {
    clearTimeout(transpileTimer);
    transpileTimer = undefined;
  }

  if (transpileController) {
    transpileController.abort();
  }

  const controller = new AbortController();
  transpileController = controller;
  const text = document.getText();
  const uri = document.uri;

  transpileTimer = setTimeout(() => {
    transpileTimer = undefined;
    transpileBasDocument(uri, text, controller.signal).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }
      console.error("CUBLOC transpile failed:", error);
    });
  }, 0);
}

function shouldTranspile(document) {
  if (document.languageId !== "cubloc-basic") {
    return false;
  }
  if (document.uri.scheme !== "file") {
    return false;
  }
  if (document.uri.path.endsWith(".bas.py")) {
    return false;
  }
  return true;
}

async function transpileBasDocument(uri, text, signal) {
  if (signal.aborted) {
    return;
  }

  const output = transpileBasToPython(text, uri.fsPath);
  if (signal.aborted) {
    return;
  }

  const pyUri = uri.with({ path: `${uri.path}.py` });
  const encoded = Buffer.from(output, "utf8");
  await vscode.workspace.fs.writeFile(pyUri, encoded);
}

module.exports = {
  activate,
  deactivate,
};
