#!/usr/bin/env node
/**
 * Copy Apple Color Emoji 64px PNGs into public/ so chat never depends on
 * external CDNs (often blocked). Source: emoji-datasource-apple.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/emoji-datasource-apple/img/apple/64");
const dest = join(root, "public/emoji/apple/64");

if (!existsSync(src)) {
  console.warn("[vendor-apple-emoji] skip: emoji-datasource-apple not installed");
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("[vendor-apple-emoji] copied → public/emoji/apple/64");
