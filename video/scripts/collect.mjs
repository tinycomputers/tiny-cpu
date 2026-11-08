// Dev helper: receives layout measurements POSTed by the Debug composition while `remotion still` renders it.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("out", { recursive: true });
createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.end();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const name = (req.url ?? "/x").slice(1) || "x";
    writeFileSync(`out/layout-${name}.json`, body);
    console.log("saved", name, body.length);
    res.end("ok");
  });
}).listen(4999, () => console.log("collector on 4999"));
