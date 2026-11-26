#!/usr/bin/env node
/**
 * Reads CHESS_NOTEBOOK_PASSCODE from the environment and writes
 * js/hash-config.js containing only a random salt and SHA-256 hash.
 * Never prints or writes the passcode.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pass = process.env.CHESS_NOTEBOOK_PASSCODE;

if (typeof pass !== "string" || pass.length === 0) {
  console.error("CHESS_NOTEBOOK_PASSCODE is missing or empty.");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.createHash("sha256").update(salt + pass, "utf8").digest("hex");

const out = path.join(root, "js", "hash-config.js");
fs.mkdirSync(path.dirname(out), { recursive: true });
const body =
  "/* Generated. Contains a salt and hash only. */\n" +
  "export const HASH_SALT = \"" + salt + "\";\n" +
  "export const HASH_SHA256 = \"" + hash + "\";\n";
fs.writeFileSync(out, body, { encoding: "utf8" });
console.error("Wrote js/hash-config.js");
