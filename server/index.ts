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
// A configured DATA_PATH is the production data store. Never silently replace
// a missing mounted file with demo data; an operator can explicitly opt in for
// a brand-new install with ALLOW_SEED_DATA=true.
const app = createApp(new JsonDataStore(dataPath, !process.env.DATA_PATH || process.env.ALLOW_SEED_DATA === "true"));
const clientPath = resolve(root, "dist");

if (existsSync(clientPath)) {
  app.use(express.static(clientPath));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(clientPath, "index.html")));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`BullShark Connected API listening on http://localhost:${port}`));
