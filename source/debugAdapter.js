"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { transpileBasToPython } = require("./transpiler");

let nextSeq = 1;
let contentLength = null;
let buffer = Buffer.alloc(0);
let terminateTimer = null;
let currentSession = null;

function sendMessage(message) {
  const payload = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n`;
  process.stdout.write(header);
  process.stdout.write(payload);
}

function sendResponse(request, body, success = true, message) {
  const response = {
    type: "response",
    seq: nextSeq++,
    request_seq: request.seq,
    success,
    command: request.command,
  };
  if (body !== undefined) {
    response.body = body;
  }
  if (message) {
    response.message = message;
  }
  sendMessage(response);
}

function sendEvent(event, body) {
  const message = {
    type: "event",
    seq: nextSeq++,
    event,
  };
  if (body !== undefined) {
    message.body = body;
  }
  sendMessage(message);
}

function sendOutput(output, category = "console") {
  if (!output) {
    return;
  }
  sendEvent("output", { category, output });
}

function queueTerminate() {
  if (terminateTimer) {
    return;
  }
  terminateTimer = setTimeout(() => {
    process.exit(0);
  }, 100);
}

function handleInitialize(request) {
  sendResponse(request, {
    supportsConfigurationDoneRequest: true,
    supportsTerminateRequest: true,
    supportsPauseRequest: true,
  });
  sendEvent("initialized");
}

async function handleLaunch(request, args) {
  try {
    const resolved = resolveLaunchArgs(args);
    currentSession = resolved;
    sendResponse(request);
    sendEvent("process", { name: "CUBLOC BASIC", isLocalProcess: false });
    sendEvent("thread", { reason: "started", threadId: 1 });
    sendEvent("continued", { threadId: 1, allThreadsContinued: true });

    uploadWithMpremote(resolved).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      sendOutput(`${message}\n`, "stderr");
      sendEvent("terminated");
      queueTerminate();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendOutput(`${message}\n`, "stderr");
    sendResponse(request, undefined, false, message);
    sendEvent("terminated");
    queueTerminate();
  }
}

async function handleDisconnect(request) {
  await stopExecution();
  sendResponse(request);
  sendEvent("terminated");
  queueTerminate();
}

async function handleTerminate(request) {
  await stopExecution();
  sendResponse(request);
  sendEvent("terminated");
  queueTerminate();
}

function handleThreads(request) {
  sendResponse(request, { threads: [{ id: 1, name: "upload" }] });
}

function handleSetBreakpoints(request) {
  sendResponse(request, { breakpoints: [] });
}

function handleStackTrace(request) {
  sendResponse(request, { stackFrames: [], totalFrames: 0 });
}

function handleScopes(request) {
  sendResponse(request, { scopes: [] });
}

function handleVariables(request) {
  sendResponse(request, { variables: [] });
}

function handlePause(request) {
  sendResponse(request);
  sendEvent("stopped", { reason: "pause", threadId: 1, allThreadsStopped: true });
}

function handleContinue(request) {
  sendResponse(request, { allThreadsContinued: true });
  sendEvent("continued", { threadId: 1, allThreadsContinued: true });
}

function resolveLaunchArgs(args) {
  if (!args || typeof args !== "object") {
    throw new Error("Missing launch configuration.");
  }

  if (!args.serialPort || typeof args.serialPort !== "string") {
    throw new Error("Launch configuration requires a 'serialPort' string.");
  }

  if (!args.program || typeof args.program !== "string") {
    throw new Error("Launch configuration requires a 'program' path.");
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const programPath = path.isAbsolute(args.program)
    ? args.program
    : path.resolve(cwd, args.program);
  const programLower = programPath.toLowerCase();
  let pythonPath = programPath;

  if (programLower.endsWith(".cub")) {
    pythonPath = `${programPath}.py`;
    const basText = fs.readFileSync(programPath, "utf8");
    const pythonText = transpileBasToPython(basText, programPath);
    fs.writeFileSync(pythonPath, pythonText, "utf8");
  }

  return {
    serialPort: args.serialPort,
    mpremotePath: args.mpremotePath || "mpremote",
    mpremoteArgs: Array.isArray(args.mpremoteArgs) ? args.mpremoteArgs : [],
    pythonPath,
    remotePath: args.remotePath || "main.py",
    runAfterUpload: args.runAfterUpload !== false,
    stopCommand: typeof args.stopCommand === "string" ? args.stopCommand : "soft-reset",
    cwd,
  };
}

function uploadWithMpremote(options) {
  return new Promise((resolve, reject) => {
    const remotePath = options.remotePath || "main.py";
    const normalizedRemote = remotePath.replace(/\\/g, "/");
    const args = [
      ...options.mpremoteArgs,
      "connect",
      options.serialPort,
      "fs",
      "cp",
      options.pythonPath,
      `:${remotePath}`,
    ];

    if (options.runAfterUpload) {
      args.push(
        "+",
        "exec",
        `exec(open('${normalizedRemote}').read(), globals())`
      );
    }

    sendOutput(`mpremote ${args.join(" ")}\n`);

    const child = spawn(options.mpremotePath, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.on("data", (data) => {
      sendOutput(data.toString("utf8"));
    });

    child.stderr.on("data", (data) => {
      sendOutput(data.toString("utf8"), "stderr");
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start mpremote: ${error.message}. Set 'mpremotePath' if it's not on PATH.`
        )
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mpremote exited with code ${code}.`));
      }
    });
  });
}

function stopWithMpremote(options) {
  return new Promise((resolve, reject) => {
    if (!options) {
      resolve();
      return;
    }

    const args = [
      ...options.mpremoteArgs,
      "connect",
      options.serialPort,
      options.stopCommand,
    ];

    sendOutput(`mpremote ${args.join(" ")}\n`);

    const child = spawn(options.mpremotePath, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.on("data", (data) => {
      sendOutput(data.toString("utf8"));
    });

    child.stderr.on("data", (data) => {
      sendOutput(data.toString("utf8"), "stderr");
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start mpremote: ${error.message}. Set 'mpremotePath' if it's not on PATH.`
        )
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mpremote exited with code ${code}.`));
      }
    });
  });
}

async function stopExecution() {
  if (!currentSession) {
    return;
  }
  try {
    await stopWithMpremote(currentSession);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendOutput(`${message}\n`, "stderr");
  }
  currentSession = null;
}

function handleRequest(request) {
  switch (request.command) {
    case "initialize":
      return handleInitialize(request);
    case "launch":
      return handleLaunch(request, request.arguments);
    case "disconnect":
      return handleDisconnect(request);
    case "terminate":
      return handleTerminate(request);
    case "threads":
      return handleThreads(request);
    case "pause":
      return handlePause(request);
    case "continue":
      return handleContinue(request);
    case "setBreakpoints":
      return handleSetBreakpoints(request);
    case "setExceptionBreakpoints":
      return sendResponse(request, { breakpoints: [] });
    case "configurationDone":
      return sendResponse(request);
    case "stackTrace":
      return handleStackTrace(request);
    case "scopes":
      return handleScopes(request);
    case "variables":
      return handleVariables(request);
    default:
      return sendResponse(request);
  }
}

function processBuffer() {
  while (true) {
    if (contentLength === null) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const header = buffer.slice(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      contentLength = Number.parseInt(match[1], 10);
      buffer = buffer.slice(headerEnd + 4);
    }

    if (contentLength === null || buffer.length < contentLength) {
      return;
    }

    const messageBytes = buffer.slice(0, contentLength);
    buffer = buffer.slice(contentLength);
    contentLength = null;

    let message;
    try {
      message = JSON.parse(messageBytes.toString("utf8"));
    } catch (error) {
      sendOutput(`Failed to parse request: ${error.message}\n`, "stderr");
      continue;
    }

    Promise.resolve(handleRequest(message)).catch((error) => {
      sendOutput(`Unhandled error: ${error.message}\n`, "stderr");
    });
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});

process.stdin.on("end", () => {
  queueTerminate();
});
