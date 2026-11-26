import { HASH_SALT, HASH_SHA256 } from "./hash-config.js";

const KEY = "onb-unlocked";

export function isUnlocked() {
  try {
    return sessionStorage.getItem(KEY) === "1" || localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function lock() {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

export function markUnlocked(remember) {
  try {
    sessionStorage.setItem(KEY, "1");
    if (remember) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function eqHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Returns true if the given passcode matches the stored hash. Never logs the input. */
export async function verifyPasscode(pass) {
  if (typeof pass !== "string" || pass.length === 0) return false;
  const digest = await sha256Hex(HASH_SALT + pass);
  return eqHex(digest, HASH_SHA256);
}
