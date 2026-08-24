import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { JsonDataStore } from "./store.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataPath = process.env.DATA_PATH
  ? resolve(process.env.DATA_PATH)
  : resolve(root, "data", "portal.json");
const app = createApp(new JsonDataStore(dataPath));
const clientPath = resolve(root, "dist");

if (existsSync(clientPath)) {
  app.use(express.static(clientPath));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(clientPath, "index.html")));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`BullShark Connected API listening on http://localhost:${port}`));
