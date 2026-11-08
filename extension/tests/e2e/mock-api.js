// Tiny stand-in for api.anthropic.com: serves the test page and canned /v1/messages replies.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const FIX = (n) => fs.readFileSync(path.join(__dirname, "../../../desktop/tests/fixtures", n), "utf8");
const PAGE = fs.readFileSync(path.join(__dirname, "fixtures/page.html"));

function start() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.method === "GET") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(PAGE); }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      requests.push({ headers: req.headers, body });
      const send = (status, obj) => { res.writeHead(status, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.headers["x-api-key"] === "bad-key")
        return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      const user = body.messages[0].content;
      const fixture = /[֐-׿]/.test(user) ? "response_he.json"
        : /exactly \d+ alternatives/.test(body.system) ? "response_rephrase.json" : "response_en.json";
      send(200, { id: "msg_test", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn",
        content: [{ type: "text", text: FIX(fixture) }] });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, port: server.address().port })));
}

module.exports = { start };
