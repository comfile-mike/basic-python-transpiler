"use strict";

const fs = require("fs");
const path = require("path");

function defaultLadderXml() {
  return `<ladder version="1.0">\n  <rung id="1">\n    <path id="1"></path>\n  </rung>\n</ladder>\n`;
}

function getLadderWebviewHtml(webview) {
  const nonce = getNonce();
  const templatePath = path.join(__dirname, "ladderWebview.html");
  let html = fs.readFileSync(templatePath, "utf8");
  html = html.replace(/__CSP_SOURCE__/g, webview.cspSource);
  html = html.replace(/__NONCE__/g, nonce);
  return html;
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

module.exports = {
  defaultLadderXml,
  getLadderWebviewHtml,
};
