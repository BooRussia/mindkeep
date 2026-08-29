#!/usr/bin/env node
import { createServer } from "node:http";
import { handleRequest } from "./worker.js";

const PORT = Number(process.env.PORT || 8787);
const BOT_TOKEN = process.env.BOT_TOKEN || "dev-bot-token";
const PAGES_BASE = process.env.PAGES_BASE || "http://127.0.0.1:4173";

const env = {
  BOT_TOKEN,
  PAGES_BASE,
  XAI_API_KEY: process.env.XAI_API_KEY || "",
  XAI_IMAGE_MODEL: process.env.XAI_IMAGE_MODEL || "",
};

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const url = `http://127.0.0.1:${PORT}${req.url}`;
  const request = new Request(url, { method: req.method, headers, body: body.length ? body : undefined });
  const ctx = { waitUntil: (p) => Promise.resolve(p).catch((err) => console.error("waitUntil", err)) };
  const response = await handleRequest(request, env, ctx);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MindKeep live on http://127.0.0.1:${PORT}`);
  console.log(`  overlay  GET  http://127.0.0.1:${PORT}/overlay.json`);
  console.log(`  mcp      POST http://127.0.0.1:${PORT}/mcp`);
  console.log(`  rest     POST http://127.0.0.1:${PORT}/v1/merge_item`);
  console.log(`BOT_TOKEN=${BOT_TOKEN}`);
  console.log(`PAGES_BASE=${PAGES_BASE}`);
});
