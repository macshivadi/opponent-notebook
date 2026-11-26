import { isUnlocked, markUnlocked, verifyPasscode, lock as lockSession } from "./auth.js";
import * as db from "./db.js";
import { boardHTML } from "./board.js";
import { fenAfter, parseMovesFromPgn, movesFromSanText, prepNote, buildTree, childrenSorted, nodeScorePct, formatMoveLine, mainLine, weakestLine } from "./openings.js";
import { openingName } from "./eco.js";
import { lookupLichess, lookupChesscom, pullLichessGames, pullChesscomGames } from "./api.js";
import { initEngine, analyzeGame, describeSwing, describeDeparture } from "./engine.js";
import { demoPayload } from "./demo.js";

const $app = document.getElementById("app");

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toast(msg) {
  document.querySelectorAll(".toast").forEach((n) => n.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

/* ---------- routing ---------- */
function parseHash() {
  const raw = (location.hash || "#/opponents").replace(/^#/, "");
  const [path, qs] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const query = {};
  if (qs) new URLSearchParams(qs).forEach((v, k) => (query[k] = v));
  if (parts[0] === "opponents" && parts[1] === "new") return { name: "add-opponent", query };
  if (parts[0] === "opponents" && parts[1]) return { name: "card", id: parts[1], query };
  if (parts[0] === "game") return { name: "add-game", query };
  if (parts[0] === "lines") return { name: "lines", query };
  if (parts[0] === "patterns") return { name: "patterns", query };
  return { name: "opponents", query };
}

function go(hash) {
  location.hash = hash.startsWith("#") ? hash : "#" + hash;
}

/* ---------- shared chrome ---------- */
const LOGO = `<img class="brand-mark" src="icons/logo.svg" width="32" height="32" alt=""/>`;

function tabbar(active) {
  const items = [
    ["opponents", "#/opponents", "Opponents", peopleIcon],
    ["add-game", "#/game", "Add game", plusIcon],
    ["lines", "#/lines", "My lines", bookIcon],
    ["patterns", "#/patterns", "Patterns", barsIcon],
  ];
  return `<nav class="tabbar">${items
    .map(([k, href, label, icon]) => `<a class="tab${active === k ? " on" : ""}" href="${href}">${icon(active === k)}${label}</a>`)
    .join("")}</nav>`;
}

function deskNav(active) {
  const items = [
    ["opponents", "#/opponents", "Opponents"],
    ["add-game", "#/game", "Add game"],
    ["lines", "#/lines", "My lines"],
    ["patterns", "#/patterns", "Patterns"],
  ];
  return `<nav class="desk-nav">${items
    .map(([k, href, label]) => `<a class="${active === k ? "on" : ""}" href="${href}">${label}</a>`)
    .join("")}</nav>`;
}

function appbar({ sub = "For your next round", back = null, active = "opponents" } = {}) {
  const backBtn = back
    ? `<button type="button" class="back" data-act="back" aria-label="Back"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10.5 3.5 5.5 8l5 4.5" stroke="#1A1612" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
    : "";
  return `<header class="appbar">${backBtn}<div class="brand">${LOGO}<div><div class="brand-name">Opponent Notebook</div><div class="brand-sub">${esc(sub)}</div></div></div>${deskNav(active)}</header>`;
}

function peopleIcon(on) {
  const c = on ? "#1B5D45" : "#6B6258";
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="8" cy="8" r="2.4" stroke="${c}" stroke-width="1.5"/><circle cx="14.5" cy="8.2" r="2.1" stroke="${c}" stroke-width="1.5"/><path d="M3.8 16.2c.7-2.2 2.3-3.3 4.3-3.3s3.6 1.1 4.3 3.3" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/><path d="M13.2 12.9c1.7-.1 3.1.9 3.8 2.8" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}
function plusIcon(on) {
  const c = on ? "#1B5D45" : "#6B6258";
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3.5" y="3.5" width="15" height="15" rx="3" stroke="${c}" stroke-width="1.5"/><path d="M11 7.5v7M7.5 11h7" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}
function bookIcon(on) {
  const c = on ? "#1B5D45" : "#6B6258";
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M6.5 4.5h9A2 2 0 0 1 17.5 6.5v11l-3-1.6-3 1.6-3-1.6-3 1.6v-11A2 2 0 0 1 6.5 4.5z" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/><path d="M8.5 9h5M8.5 12h5" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}
function barsIcon(on) {
  const c = on ? "#1B5D45" : "#6B6258";
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="4" y="12" width="3.2" height="5.5" rx="0.8" stroke="${c}" stroke-width="1.5"/><rect x="9.4" y="7" width="3.2" height="10.5" rx="0.8" stroke="${c}" stroke-width="1.5"/><rect x="14.8" y="4.5" width="3.2" height="13" rx="0.8" stroke="${c}" stroke-width="1.5"/></svg>`;
}

const TAGS = [
  { id: "theory-gap", label: "Theory gap", cls: "gap" },
  { id: "blunder", label: "Blunder", cls: "blunder" },
  { id: "time-trouble", label: "Time trouble", cls: "time" },
  { id: "new-line", label: "Trying new line", cls: "experiment" },
];
function tagLabel(id) {
  return (TAGS.find((t) => t.id === id) || {}).label || id;
}
function tagChip(id, on = true) {
  const t = TAGS.find((x) => x.id === id);
  const cls = `tag-chip${on ? " on " + (t ? t.cls : "") : ""}`;
  return `<span class="${cls}">${esc(t ? t.label : id)}</span>`;
}

function siteBadge(opp) {
  if (opp.site === "lichess" && opp.username) return `<span class="badge lichess">Lichess</span>`;
  if (opp.site === "chesscom" && opp.username) return `<span class="badge chesscom">Chess.com</span>`;
  return `<span class="badge none">No online account</span>`;
}

function initials(name) {
  const p = String(name || "").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

function otbRecord(games) {
  let w = 0, d = 0, l = 0;
  for (const g of games) {
    if (g.result === "win") w++;
    else if (g.result === "draw") d++;
    else if (g.result === "loss") l++;
  }
  if (!games.length) return { text: "No OTB yet", none: true, w, d, l };
  if (w + d + l === 0) return { text: `${games.length} game${games.length === 1 ? "" : "s"}`, none: false, w, d, l };
  return { text: `${w}–${d}–${l}`, none: false, w, d, l };
}

function resultText(r) {
  if (r === "win") return "Win";
  if (r === "draw") return "Draw";
  if (r === "loss") return "Loss";
  return "—";
}

function fmtDate(s) {
  if (!s) return "";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Format a timestamp in the viewer's local time zone (not UTC). */
function fmtLocalStamp(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/* ---------- lock ---------- */
function renderLock(error) {
  $app.className = "locked";
  $app.innerHTML = `
    <div class="lock-screen">
      <form class="lock-card" data-form="unlock" autocomplete="off">
        <div class="logo-wrap">${LOGO}</div>
        <h1>Opponent Notebook</h1>
        <p class="lead">A private notebook of opponents, openings, and your own notes. Saved only on this device.</p>
        ${error ? `<div class="lock-error" role="alert">${esc(error)}</div>` : ""}
        <label class="field-label" for="pass">Passcode</label>
        <input class="input" id="pass" name="pass" type="password" autocomplete="current-password" required autofocus/>
        <label class="privacy" style="margin:12px 0 4px">
          <input type="checkbox" name="remember" style="margin-top:3px"/>
          Keep me unlocked on this device
        </label>
        <button class="btn" type="submit">Unlock</button>
        <p class="privacy lock-privacy">Nothing is sent to a server. There are no analytics.</p>
      </form>
    </div>`;
  $app.querySelector("#pass")?.focus();
}

/* ---------- data helpers ---------- */
async function loadLists() {
  const [opponents, otb, online] = await Promise.all([
    db.getAll("opponents"),
    db.getAll("otb"),
    db.getAll("online"),
  ]);
  opponents.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return { opponents, otb, online };
}

function gamesFor(otb, id) {
  return otb.filter((g) => g.opponentId === id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
function onlineFor(online, id) {
  return online.filter((g) => g.opponentId === id);
}

/* ---------- views ---------- */
function lastPlayedLabel(opp, otbGames) {
  const dates = otbGames.map((g) => g.date).filter(Boolean).sort();
  const last = dates[dates.length - 1];
  if (last) return `Last played ${fmtDate(last)}`;
  if (opp.lastFetchedAt) return `Online games refreshed ${fmtLocalStamp(opp.lastFetchedAt)}`;
  return "No games yet";
}


function gameOppName(g, byId) {
  const opp = g.opponentId ? byId[g.opponentId] : null;
  if (opp) return opp.name;
  return g.opponentName || "";
}

function unlinkedGames(otb, opponents) {
  const ids = new Set(opponents.map((o) => o.id));
  return otb.filter((g) => !g.opponentId || !ids.has(g.opponentId)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function closeDialog() {
  document.querySelectorAll(".modal-backdrop").forEach((n) => n.remove());
}

function showDialog({ title, body, extra = "", confirmLabel = "Delete", danger = true }) {
  closeDialog();
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML = `<div class="dialog">
      <h2>${esc(title)}</h2>
      <p>${body}</p>
      ${extra}
      <div class="dialog-actions">
        <button type="button" class="btn secondary" data-dlg="cancel">Cancel</button>
        <button type="button" class="btn${danger ? " danger" : ""}" data-dlg="ok">${esc(confirmLabel)}</button>
      </div>
    </div>`;
    const finish = (val) => {
      document.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(val);
    };
    const onKey = (e) => { if (e.key === "Escape") finish(null); };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.closest("[data-dlg=cancel]")) finish(null);
      else if (e.target.closest("[data-dlg=ok]")) finish(wrap);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    wrap.querySelector("[data-dlg=cancel]")?.focus();
  });
}

async function confirmDeleteOpponent(opp, otbCount) {
  const extra = otbCount
    ? `<div class="dialog-choices">
        <label><input type="radio" name="otb-fate" value="keep" checked>
          <span><div class="choice-title">Keep my over-the-board games</div>
          <div class="choice-sub">They stay on this device, unlinked from this card. They still show in My lines and Patterns.</div></span>
        </label>
        <label><input type="radio" name="otb-fate" value="delete">
          <span><div class="choice-title">Also delete my over-the-board games vs them</div>
          <div class="choice-sub">Notes, tags, and those scoresheets are removed from this device.</div></span>
        </label>
      </div>`
    : "";
  const body = `This removes ${esc(opp.name)} and any cached online games pulled for them from this device.` +
    (otbCount ? ` You have ${otbCount} over-the-board game${otbCount === 1 ? "" : "s"} vs them.` : "");
  const el = await showDialog({
    title: `Delete ${opp.name}?`,
    body,
    extra,
    confirmLabel: "Delete opponent",
  });
  if (!el) return null;
  const choice = el.querySelector('input[name="otb-fate"]:checked');
  return { deleteOtb: choice ? choice.value === "delete" : false };
}

async function confirmDeleteGame(g) {
  const el = await showDialog({
    title: "Delete this game?",
    body: `This removes the over-the-board game${g.event ? " “" + esc(g.event) + "”" : ""}${g.date ? " (" + esc(fmtDate(g.date)) + ")" : ""} from this device, including your notes and tags. This cannot be undone.`,
    confirmLabel: "Delete game",
  });
  return !!el;
}

async function deleteOpponentRecord(opp, { deleteOtb }) {
  const online = await db.getByOpponent("online", opp.id);
  for (const g of online) await db.remove("online", g.id);
  const mine = await db.getByOpponent("otb", opp.id);
  if (deleteOtb) {
    for (const g of mine) await db.remove("otb", g.id);
  } else {
    for (const g of mine) {
      await db.put("otb", { ...g, opponentId: "", opponentName: g.opponentName || opp.name });
    }
  }
  await db.remove("opponents", opp.id);
}

async function deleteOtbGame(id) {
  await db.remove("otb", id);
}

function renderOpponents({ opponents, otb }, { q = "" } = {}) {
  const query = q.trim().toLowerCase();
  const rows = opponents.filter((o) => {
    if (!query) return true;
    const blob = `${o.name} ${o.username || ""} ${o.rating || ""}`.toLowerCase();
    return blob.includes(query);
  });
  const list = rows.length
    ? rows
        .map((o) => {
          const rec = otbRecord(gamesFor(otb, o.id));
          return `<a class="opp-row" href="#/opponents/${o.id}">
            <div class="avatar${o.username ? "" : " none"}">${esc(initials(o.name))}</div>
            <div class="opp-body">
              <div class="opp-top"><div class="opp-name">${esc(o.name)}</div><div class="record${rec.none ? " none" : ""}">${esc(rec.text)}</div></div>
              <div class="opp-meta">${o.rating ? `Rated ${esc(o.rating)} · ` : ""}${esc(lastPlayedLabel(o, gamesFor(otb, o.id)))}</div>
              <div class="badge-row">${siteBadge(o)}</div>
            </div>
          </a>`;
        })
        .join("")
    : opponents.length
      ? `<p class="hint">No names match that search.</p>`
      : `<div class="empty-card">
           <h3>No opponents yet</h3>
           <p>Add someone you already know you’ll face, or look up a Lichess or Chess.com username. The notebook starts empty.</p>
         </div>`;

  const loose = unlinkedGames(otb, opponents);
  const unlinkedBlock = loose.length
    ? `<div class="card section-gap" id="unlinked-games">
        <h2 class="section-title">Games without an opponent card</h2>
        <p class="hint">Kept when you deleted a card and left your over-the-board games. They still count in My lines and Patterns.</p>
        ${loose.map((g) => `<div class="otb-item" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
          <div class="game-title">${g.opponentName ? "vs " + esc(g.opponentName) : "Unlinked game"}${g.event ? " · " + esc(g.event) : ""}${g.date ? " · " + esc(fmtDate(g.date)) : ""}</div>
          <div class="game-meta">You: ${g.color === "white" ? "White" : "Black"}</div>
          ${g.notes ? `<p class="quote">${esc(g.notes)}</p>` : ""}
          <div class="game-actions"><button type="button" class="btn tiny danger" data-act="delete-game" data-id="${g.id}">Delete game</button></div>
        </div>`).join("")}
      </div>`
    : "";

  $app.className = "";
  $app.innerHTML = `
    ${appbar({ active: "opponents" })}
    <main class="page has-tabs">
      <h1 class="page-title">Opponents</h1>
      <p class="page-lead">Your notebook for people you already know you’ll face — and anyone you look up after pairings.</p>
      <form class="search" role="search" data-form="search">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.2" stroke="#6B6258" stroke-width="1.5"/><path d="M10.4 10.4 13.2 13.2" stroke="#6B6258" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input name="q" type="search" placeholder="Search name or username" value="${esc(q)}" />
      </form>
      <a class="btn" href="#/opponents/new" style="margin:0 0 14px;height:46px;font-size:15px;box-shadow:none;text-decoration:none">+ Add opponent</a>
      <div class="opp-list">${list}</div>
      <p class="hint" style="margin-top:12px">Record is your W–D–L against them over the board. Online games are pulled only when you ask, and cached on this device.</p>
      ${unlinkedBlock}
      <details class="device-tools">
        <summary>This device</summary>
        <p class="hint">All data stays in this browser. You can download a backup and load it on another device. There are no analytics.</p>
        <div class="toolbar-row">
          <button type="button" class="btn small secondary" data-act="export">Export backup</button>
          <button type="button" class="btn small secondary" data-act="import">Import backup</button>
          <button type="button" class="btn small secondary" data-act="demo">Load demo</button>
        </div>
        <input class="file-hidden" id="import-file" type="file" accept="application/json,.json"/>
        <p class="hint">The demo uses made-up names only. It replaces the current notebook on this device.</p>
      </details>
    </main>
    ${tabbar("opponents")}`;
}

function renderAddOpponent(state) {
  const f = state.form || {};
  const site = f.site || "lichess";
  $app.className = "";
  $app.innerHTML = `
    ${appbar({ sub: "New card", back: true, active: "opponents" })}
    <main class="page has-tabs">
      <h1 class="page-title">Add opponent</h1>
      <p class="page-lead">Search Lichess or Chess.com by username. A USCF or FIDE ID is stored as a note only — those databases can’t be searched from here.</p>
      <form class="stack" data-form="lookup">
        <div>
          <label class="field-label" for="name">Name</label>
          <input class="input" id="name" name="name" value="${esc(f.name || "")}" required/>
        </div>
        <div class="grid-2">
          <div>
            <label class="field-label" for="rating">Rating</label>
            <input class="input" id="rating" name="rating" value="${esc(f.rating || "")}" placeholder="Optional"/>
          </div>
          <div>
            <label class="field-label" for="uscfId">USCF or FIDE ID</label>
            <input class="input" id="uscfId" name="uscfId" value="${esc(f.uscfId || "")}" placeholder="Optional note"/>
          </div>
        </div>
        <p class="hint" style="margin-top:-8px">An ID is stored as a note only. It is not used to look up games.</p>
        <div>
          <label class="field-label">Look up games on</label>
          <div class="toggle" role="tablist">
            <button type="button" class="opt${site === "lichess" ? " on" : ""}" data-act="site" data-site="lichess">Lichess</button>
            <button type="button" class="opt${site === "chesscom" ? " on" : ""}" data-act="site" data-site="chesscom">Chess.com</button>
          </div>
        </div>
        <div>
          <label class="field-label" for="username">Username</label>
          <input class="input" id="username" name="username" value="${esc(f.username || "")}" placeholder="Optional"/>
          <p class="hint">Leave blank to save a card and log over-the-board games only.</p>
        </div>
        ${state.lookupMsg ? `<div class="banner ${state.lookupKind === "ok" ? "ok" : state.lookupKind === "notfound" ? "warn" : "error"}">${esc(state.lookupMsg)}</div>` : ""}
        ${state.matchCard || ""}
        ${state.emptyCard || ""}
        <button class="btn" type="submit">${state.looking ? `<span class="spin"></span> Looking up…` : "Look up / save"}</button>
        <p class="privacy">Saved on this device.</p>
      </form>
    </main>
    ${tabbar("opponents")}`;
}

function matchCardHTML(match) {
  const rating = match.rating ? `${match.rating} ${match.ratingLabel}` : "rating unknown";
  const count = match.count ? `${match.count} games on record` : "Public games can be pulled after you confirm.";
  return `<div class="card match-card">
    <div class="tag-row" style="margin-bottom:10px"><span class="tag">Possible match</span></div>
    <div class="match-head">
      <div class="avatar" style="width:48px;height:48px;font-size:15px;border-radius:14px">${esc(initials(match.displayName || match.username))}</div>
      <div class="match-info">
        <h3>${esc(match.username)}</h3>
        <p>${match.site === "lichess" ? "Lichess" : "Chess.com"} · ${esc(rating)}<br/>${esc(count)}</p>
      </div>
    </div>
    <p class="hint" style="margin:10px 0 0">Is this the right player? Confirm only if the name and rating feel right.</p>
    <div class="match-actions">
      <button type="button" class="btn" data-act="confirm-match">Confirm and pull games</button>
      <button type="button" class="btn secondary" data-act="save-only">Save without pulling</button>
    </div>
  </div>`;
}

function emptyAccountHTML() {
  return `<div class="empty-card">
    <h3>No online account found</h3>
    <p>No Lichess or Chess.com account turned up for this username. You can still log your over-the-board games.</p>
    <button type="button" class="btn" data-act="save-only" style="margin-top:12px">Save card anyway</button>
  </div>`;
}

function treeTable(title, node, weakLine) {
  const kids = childrenSorted(node);
  if (!kids.length) return `<p class="hint">${esc(title)} — no moves in the cache.</p>`;
  const weakKey = weakLine ? weakLine.join(" ") : "";
  const rows = kids
    .map((ch) => {
      const pct = nodeScorePct(ch);
      const isTarget = weakKey && ch.line.join(" ") === weakKey.slice(0, ch.line.join(" ").length) && ch.move === weakLine[weakLine.length - 1] && ch.line.length === weakLine.length;
      const weakChild = weakLine && ch.line.join(" ") === weakLine.slice(0, ch.line.length).join(" ") && ch.games >= 8 && nodeScorePct(ch) === nodeScorePct({ games: ch.games, points: ch.points }) && formatMoveLine(ch.line) === formatMoveLine(weakLine);
      const target = formatMoveLine(ch.line) === formatMoveLine(weakLine || []);
      const barCls = pct == null ? "" : pct < 45 ? "weak" : pct < 50 ? "mid" : "";
      const name = openingName(ch.line);
      return `<tr class="${target ? "target" : ""}">
        <td><span class="san">${esc(ch.move)}</span>${name ? `<span class="sub">${esc(name)}</span>` : ""}</td>
        <td class="num">${ch.games}</td>
        <td class="score-cell"><div class="score"><b>${pct ?? "—"}%</b><div class="bar ${barCls}"><i style="width:${pct || 0}%"></i></div></div></td>
      </tr>`;
    })
    .join("");
  return `<div class="tree-label">${esc(title)}</div>
    <table class="tree-table">
      <thead><tr><th>Move</th><th class="num">Games</th><th class="score">Their score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderCard(opp, { otb, online }, { pulling = false, pullMsg = "", treeColor = "white" } = {}) {
  const mine = gamesFor(otb, opp.id);
  const rec = otbRecord(mine);
  const pulled = onlineFor(online, opp.id);
  const whiteGames = pulled.filter((g) => g.known && g.isWhite);
  const blackGames = pulled.filter((g) => g.known && !g.isWhite);
  const prep = prepNote({ whiteGames, blackGames, allGames: pulled, otbCount: mine.length, myOtb: mine });
  const focusTree = treeColor === "black" ? prep.blackTree : prep.whiteTree;
  const weak = prep.weak && prep.weak.color === (treeColor === "black" ? "Black" : "White") ? prep.weak : (treeColor === "black" ? (prep.weak && prep.weak.color === "Black" ? prep.weak : null) : (prep.weak && prep.weak.color === "White" ? prep.weak : null));
  const weakForColor = treeColor === "black"
    ? (prep.blackTree && weakestLine(prep.blackTree, 8))
    : (prep.whiteTree && weakestLine(prep.whiteTree, 8));

  const main = mainLine(focusTree, 8);
  const afterPrefix = main.slice(0, 6);
  let afterNode = focusTree;
  for (const mv of afterPrefix) {
    if (afterNode.children.has(mv)) afterNode = afterNode.children.get(mv);
    else break;
  }

  let boardBlock = "";
  if (weakForColor) {
    const pos = fenAfter(weakForColor.node.line);
    boardBlock = `<div class="section-gap board-block">${boardHTML(pos.fen, { lastMove: pos.lastMove, flipped: treeColor === "black", aria: "Target line from the opening tree" })}
      <p class="board-cap">Position after ${esc(formatMoveLine(weakForColor.node.line))} — their weakest line with at least 8 games (${weakForColor.pct}%). ${treeColor === "black" ? "Black" : "White"} at the bottom is their color in this tree.</p>
    </div>`;
  } else if (main.length) {
    const pos = fenAfter(main);
    boardBlock = `<div class="section-gap board-block">${boardHTML(pos.fen, { lastMove: pos.lastMove, flipped: treeColor === "black", aria: "Most common line" })}
      <p class="board-cap">Most common line in the pulled games as ${treeColor === "black" ? "Black" : "White"}: ${esc(formatMoveLine(main))}. No line yet has 8 or more games to mark as a weak spot.</p>
    </div>`;
  }

  const otbList = mine.length
    ? mine
        .map((g) => {
          const sug = g.analysis
            ? `<div class="suggestion"><strong>Default suggestion</strong> ${esc(g.analysis.swingText || "")} ${esc(g.analysis.departureText || "")}${g.analysis.openingName ? "" : ""}</div>`
            : g.analysisError
              ? `<div class="suggestion">${esc(g.analysisError)}</div>`
              : `<div class="suggestion muted">Engine suggestion not run yet. It starts automatically after you save a game, or you can <button type="button" class="btn ghost" data-act="analyze" data-id="${g.id}" style="display:inline;width:auto;padding:0 4px;height:auto">run it now</button>.</div>`;
          const analyzing = analyzingIds.has(g.id)
            ? `<p class="progress-line"><span class="spin"></span> ${esc(analyzeProgress[g.id] || "Analyzing…")}</p>`
            : "";
          return `<div class="otb-item card" style="margin-top:8px">
            <div class="game-top">
              <div>
                <div class="game-title">${esc(g.event || "Game")} ${g.date ? "· " + esc(fmtDate(g.date)) : ""}</div>
                <div class="game-meta">You: ${g.color === "white" ? "White" : "Black"}${g.moves?.length ? " · " + g.moves.length + " moves" : ""}</div>
              </div>
              <span class="result ${g.result === "win" ? "win" : g.result === "loss" ? "loss" : "draw"}">${esc(resultText(g.result))}</span>
            </div>
            ${g.notes ? `<p class="quote">${esc(g.notes)}</p>` : ""}
            <div class="chip-row" style="margin-top:8px">${(g.tags || []).map((t) => tagChip(t)).join("")}</div>
            ${analyzing}${sug}
            <div class="game-actions"><button type="button" class="btn tiny danger" data-act="delete-game" data-id="${g.id}">Delete game</button></div>
          </div>`;
        })
        .join("")
    : `<p class="hint">No over-the-board games logged against them yet.</p>`;

  $app.className = "";
  $app.innerHTML = `
    ${appbar({ sub: "Opponent card", back: true, active: "opponents" })}
    <main class="page has-tabs">
      <div class="opp-head" style="margin-bottom:12px">
        <div class="tag-row" style="margin-bottom:8px">${siteBadge(opp)}</div>
        <h1 class="page-title" style="margin-top:0">${esc(opp.name)}</h1>
        <p class="page-lead" style="margin-bottom:0">${opp.rating ? `Rated ${esc(opp.rating)} · ` : ""}vs you ${esc(rec.text)} · ${esc(lastPlayedLabel(opp, mine))}${opp.username ? ` · ${opp.site === "lichess" ? "Lichess" : "Chess.com"} ${esc(opp.username)}` : ""}</p>
      </div>
      <div class="card prep">
        <h2>Prep note</h2>
        <ol>${prep.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
        <div class="basis">
          <p>${esc(prep.basis)}</p>
          ${opp.username ? `<button type="button" class="btn tiny secondary" data-act="refresh" ${pulling ? "disabled" : ""}>${pulling ? "Pulling…" : "Refresh"}</button>` : ""}
        </div>
      </div>
      ${pullMsg ? `<div class="banner info" style="margin-top:10px">${esc(pullMsg)}</div>` : ""}
      ${opp.fetchError ? `<div class="banner warn" style="margin-top:10px">${esc(opp.fetchError)}</div>` : ""}
      ${boardBlock}
      <div class="card section-gap">
        <h2 class="section-title">Opening tree · they are ${treeColor === "black" ? "Black" : "White"}</h2>
        <div class="toggle" style="margin-bottom:12px">
          <button type="button" class="opt${treeColor === "white" ? " on" : ""}" data-act="tree-color" data-color="white">They are White</button>
          <button type="button" class="opt${treeColor === "black" ? " on" : ""}" data-act="tree-color" data-color="black">They are Black</button>
        </div>
        ${treeTable("First moves", focusTree, weakForColor && weakForColor.node.line)}
        ${afterPrefix.length >= 2 && afterNode !== focusTree ? treeTable("After " + formatMoveLine(afterPrefix), afterNode, weakForColor && weakForColor.node.line) : ""}
        <p class="hint">${pulled.length ? "From pulled online games cached on this device. Their score is from their point of view." : "Pull public games to fill this tree, or log over-the-board games."}</p>
      </div>
      <div class="card section-gap">
        <h2 class="section-title">Over-the-board vs you</h2>
        ${otbList}
      </div>
      <a class="btn secondary section-gap" style="margin-top:14px;text-decoration:none" href="#/game?opponent=${encodeURIComponent(opp.id)}">Add an OTB game</a>
      <div class="danger-zone">
        <p class="hint">Deleting this card also removes cached online games for them. You can keep your over-the-board games, unlinked.</p>
        <button type="button" class="btn danger" data-act="delete-opponent" data-id="${opp.id}">Delete opponent</button>
      </div>
    </main>
    ${tabbar("opponents")}`;
}

function renderAddGame(opponents, form, { error } = {}) {
  const oppOpts = opponents
    .map((o) => `<option value="${esc(o.id)}" ${form.opponentId === o.id ? "selected" : ""}>${esc(o.name)}${o.rating ? " (" + esc(o.rating) + ")" : ""}</option>`)
    .join("");
  const tags = new Set(form.tags || []);
  $app.className = "";
  $app.innerHTML = `
    ${appbar({ sub: "From the sheet", back: true, active: "add-game" })}
    <main class="page has-tabs">
      <h1 class="page-title">Add a game</h1>
      <p class="page-lead">Paste a PGN, or type the moves from the scoresheet. Only legal moves are saved.</p>
      ${error ? `<div class="banner error">${esc(error)}</div>` : ""}
      <form class="stack" data-form="add-game">
        <div>
          <label class="field-label" for="opponentId">Opponent</label>
          <select class="input" id="opponentId" name="opponentId" required>
            <option value="">Choose…</option>
            ${oppOpts}
          </select>
          ${opponents.length ? "" : `<p class="hint">Add an opponent first.</p>`}
        </div>
        <div>
          <label class="field-label">You played</label>
          <div class="toggle">
            <button type="button" class="opt${form.color !== "white" ? " on" : ""}" data-act="color" data-color="black">I’m Black</button>
            <button type="button" class="opt${form.color === "white" ? " on" : ""}" data-act="color" data-color="white">I’m White</button>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label class="field-label" for="event">Event</label>
            <input class="input" id="event" name="event" value="${esc(form.event || "")}"/>
          </div>
          <div>
            <label class="field-label" for="date">Date</label>
            <input class="input" id="date" name="date" type="date" value="${esc(form.date || "")}"/>
          </div>
        </div>
        <div class="pgn-block">
          <div class="pgn-field">
            <div class="field-head">
              <label class="field-label" for="pgn">Moves (PGN or typed)</label>
              <button type="button" class="btn tiny secondary" data-act="paste-pgn">Paste</button>
            </div>
            <textarea class="input" id="pgn" name="pgn" placeholder="1. e4 e5 2. Nf3 …">${esc(form.pgn || "")}</textarea>
          </div>
          <div class="scan-sheet">
            <div class="scan-title">Scan sheet</div>
            <div class="scan-actions">
              <a class="btn small secondary" href="https://inkpgn.com/" target="_blank" rel="noopener noreferrer">InkPGN</a>
              <a class="btn small secondary" href="https://scanchess.com/" target="_blank" rel="noopener noreferrer">ScanChess</a>
            </div>
            <p class="hint">Photograph the sheet there, fix any misread moves, copy the PGN, paste it here.</p>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label class="field-label" for="clock">Clock at the end</label>
            <input class="input" id="clock" name="clock" inputmode="numeric" placeholder="Optional" value="${esc(form.clock || "")}"/>
          </div>
          <div>
            <label class="field-label" for="result">Result</label>
            <select class="input" id="result" name="result">
              <option value="win" ${form.result === "win" ? "selected" : ""}>Win</option>
              <option value="draw" ${form.result === "draw" ? "selected" : ""}>Draw</option>
              <option value="loss" ${form.result === "loss" ? "selected" : ""}>Loss</option>
            </select>
          </div>
        </div>
        <div>
          <label class="field-label" for="notes">Your notes</label>
          <textarea class="input" id="notes" name="notes" style="min-height:96px;font-family:inherit;font-size:15px" placeholder="Type a note after the game">${esc(form.notes || "")}</textarea>
          <p class="hint">Type a note after the game, then tag it. Saved on this device.</p>
        </div>
        <div>
          <label class="field-label">Tags</label>
          <div class="chip-row">
            ${TAGS.map((t) => `<button type="button" class="tag-chip${tags.has(t.id) ? " on " + t.cls : ""}" data-act="tag" data-tag="${t.id}">${esc(t.label)}</button>`).join("")}
          </div>
        </div>
        <p class="privacy">Saved on this device.</p>
        <button class="btn" type="submit">Save game</button>
      </form>
    </main>
    ${tabbar("add-game")}`;
}

function renderLines({ opponents, otb }) {
  const byId = Object.fromEntries(opponents.map((o) => [o.id, o]));
  const asBlack = otb.filter((g) => g.color === "black");
  const asWhite = otb.filter((g) => g.color === "white");
  const recB = otbRecord(asBlack);
  const recW = otbRecord(asWhite);

  function groupByOpening(games) {
    const map = new Map();
    for (const g of games) {
      const first = (g.moves || [])[0];
      const key = openingName(g.moves || []) || (first ? `After 1.${first}` : "Unknown opening");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    }
    return [...map.entries()];
  }

  function block(title, games, rec) {
    if (!games.length) {
      return `<div class="card rep-block section-gap">
        <div class="rep-head"><h3>${esc(title)}</h3><div class="rep-stat">0 games</div></div>
        <p class="hint" style="margin:0">No games typed yet. Add one from a sheet and this section will fill in.</p>
      </div>`;
    }
    const groups = groupByOpening(games);
    const rows = groups
      .map(([name, gs]) => {
        const r = otbRecord(gs);
        const bits = gs
          .map((g) => {
            const name = gameOppName(g, byId);
            const note = g.notes ? ` Your note: “${g.notes}”.` : "";
            return `vs ${name || "unknown"}${g.result ? ", " + resultText(g.result).toLowerCase() : ""}.${note}`;
          })
          .join(" ");
        return `<div class="line-row"><div><div class="open">${esc(name)}</div><p>${esc(bits)}</p></div><div class="rep-stat">${esc(r.text)}</div></div>`;
      })
      .join("");
    return `<div class="card rep-block section-gap">
      <div class="rep-head"><h3>${esc(title)}</h3><div class="rep-stat">${games.length} game${games.length === 1 ? "" : "s"}${rec.w + rec.d + rec.l ? " · " + rec.text : ""}</div></div>
      ${rows}
    </div>`;
  }

  let board = "";
  const featured = otb.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (featured && featured.moves?.length) {
    const pos = fenAfter(featured.moves);
    const name = gameOppName(featured, byId);
    board = `<div class="section-gap board-block">${boardHTML(pos.fen, { lastMove: pos.lastMove, flipped: featured.color === "black", aria: "Latest typed game" })}
      <p class="board-cap">Latest typed game${name ? " vs " + name : ""}${featured.date ? ", " + fmtDate(featured.date) : ""}. You were ${featured.color === "white" ? "White" : "Black"}.</p>
    </div>`;
  }

  $app.className = "";
  $app.innerHTML = `
    ${appbar({ sub: "Your repertoire", active: "lines" })}
    <main class="page has-tabs">
      <h1 class="page-title">My lines</h1>
      <p class="page-lead">Built only from the over-the-board games you’ve typed in.${otb.length ? ` ${otb.length} game${otb.length === 1 ? "" : "s"} so far.` : ""}</p>
      ${otb.length ? `<div class="tag-row"><span class="tag quiet">From your sheets</span></div>` : ""}
      ${block("As Black", asBlack, recB)}
      ${board}
      ${block("As White", asWhite, recW)}
    </main>
    ${tabbar("lines")}`;
}

function renderPatterns({ opponents, otb, online }) {
  const byId = Object.fromEntries(opponents.map((o) => [o.id, o]));
  const counts = { "theory-gap": 0, blunder: 0, "time-trouble": 0, "new-line": 0 };
  for (const g of otb) for (const t of g.tags || []) if (counts[t] != null) counts[t]++;
  const theory = otb.filter((g) => (g.tags || []).includes("theory-gap"));
  const blunders = otb.filter((g) => (g.tags || []).includes("blunder"));
  const experiments = otb.filter((g) => (g.tags || []).includes("new-line"));

  const studyBits = [];
  for (const g of theory) {
    const name = openingName(g.moves || []) || "an un-named line";
    const oname = gameOppName(g, byId);
    studyBits.push(`${name}${oname ? " vs " + oname : ""}`);
  }
  const swings = otb.filter((g) => g.analysis && g.analysis.swing).slice(0, 2);
  const study = `<div class="card study">
    <h2>Study this week</h2>
    ${
      studyBits.length
        ? `<p>Your theory-gap tags point to: ${esc(studyBits.join("; "))}.</p>`
        : `<p>No theory-gap tags yet. When you tag a game, the opening you marked will show up here.</p>`
    }
    <p class="fallback">Default suggestion when no note: first big swing + the book line you left.${
      swings.length
        ? " " + swings.map((g) => {
            const oname = gameOppName(g, byId);
            return (oname ? oname + ": " : "") + (g.analysis.swingText || "");
          }).join(" ")
        : otb.length
          ? " Run the engine on a saved game to fill that in."
          : ""
    }</p>
  </div>`;

  function gameCard(g, extraChips = null) {
    const oname = gameOppName(g, byId);
    const chips = (extraChips || g.tags || []).map((t) => tagChip(t)).join("");
    let learn = "";
    if ((g.tags || []).includes("theory-gap") && g.moves?.length) {
      const pos = fenAfter(g.moves);
      learn = `<div class="learn"><h3>Learn this line</h3>
        <div class="board-block">${boardHTML(pos.fen, { lastMove: pos.lastMove, flipped: g.color === "black", aria: "Position from this game" })}
        <p class="board-cap">${esc(openingName(g.moves) || "Recorded position")}, after ${esc(formatMoveLine(g.moves))}. You were ${g.color === "white" ? "White" : "Black"}.</p></div>
        ${g.analysis ? `<p class="engine-note">${g.analysis.swingText ? esc(g.analysis.swingText) + " " : ""}${esc(g.analysis.departureText || "")}${g.analysis.depth ? " Sample depth " + g.analysis.depth + "." : ""}</p>` : `<p class="hint">Save and analyze to attach an engine note. Engine output is computed on this device.</p>`}
      </div>`;
    }
    return `<div class="card pattern-card">
      <div>
        <div class="game-title">${oname ? "vs " + esc(oname) : "Game"}</div>
        <div class="game-meta">You: ${g.color === "white" ? "White" : "Black"}${g.event ? " · " + esc(g.event) : ""}${g.date ? " · " + esc(fmtDate(g.date)) : ""}</div>
        <div class="chip-row" style="margin-top:8px">${chips}</div>
      </div>
      ${g.notes ? `<p class="quote">${esc(g.notes)}</p>` : `<p class="hint">No note typed for this game.</p>`}
      ${learn}
    </div>`;
  }

  $app.className = "";
  $app.innerHTML = `
    ${appbar({ sub: "From your notes", active: "patterns" })}
    <main class="page has-tabs">
      <h1 class="page-title">Your patterns</h1>
      <p class="page-lead">Counted from the tags you add after a game. Notes below are in your own words.</p>
      ${otb.length ? "" : `<div class="empty-card" style="margin-bottom:16px"><h3>No tagged games yet</h3><p>Add a game from a scoresheet, type a note, and tag it. Patterns are built only from what you save on this device.</p></div>`}
      ${study}
      <div class="count-row">
        <div class="count-card gap"><div class="n">${counts["theory-gap"]}</div><div class="lbl">Theory gaps</div>${theory.length && theory.every((g) => (g.moves || []).length <= 16) ? `<div class="sub">From your tags</div>` : ""}</div>
        <div class="count-card blunder"><div class="n">${counts.blunder}</div><div class="lbl">Blunders</div></div>
        <div class="count-card experiment"><div class="n">${counts["new-line"]}</div><div class="lbl">Experiments</div></div>
      </div>
      <div class="pattern-head"><h2>Theory gaps</h2><div class="n">${counts["theory-gap"]}</div></div>
      ${theory.length ? theory.map((g) => gameCard(g, ["theory-gap"])).join("") : `<p class="hint">No theory-gap tags yet.</p>`}
      <div class="pattern-head"><h2>Blunders</h2><div class="n">${counts.blunder}</div></div>
      ${blunders.length ? blunders.map((g) => gameCard(g)).join("") : `<p class="hint">No blunder tags yet.</p>`}
      <div class="pattern-head"><h2>Experiments</h2><div class="n">${counts["new-line"]} · trying a new line</div></div>
      ${experiments.length ? experiments.map((g) => gameCard(g, ["new-line"])).join("") : `<p class="hint">No “trying new line” tags yet.</p>`}
    </main>
    ${tabbar("patterns")}`;
}

/* ---------- analysis ---------- */
const analyzingIds = new Set();
const analyzeProgress = {};

async function runAnalysisFor(game) {
  if (!game?.moves?.length) return;
  analyzingIds.add(game.id);
  analyzeProgress[game.id] = "Starting engine…";
  rerenderQuiet();
  try {
    await initEngine();
    const online = game.opponentId ? await db.getByOpponent("online", game.opponentId) : [];
    const oppColorIsWhite = game.color === "black";
    const pool = online.filter((g) => g.known && g.isWhite === oppColorIsWhite);
    const tree = buildTree(pool);
    const ref = pool.length ? mainLine(tree, 12) : [];
    const result = await analyzeGame(game.moves, game.color === "white", {
      depth: 12,
      onProgress: (i, n) => {
        analyzeProgress[game.id] = `Analyzing move ${i} of ${n}…`;
        rerenderQuiet();
      },
    });
    const swingText = describeSwing(result.swing, game.color === "white");
    const departureText = describeDeparture(game.moves, ref);
    const still = await db.getById("otb", game.id);
    if (!still) return;
    const updated = {
      ...still,
      analysis: {
        depth: 12,
        swing: result.swing,
        swingText,
        departureText,
        openingName: result.openingName,
        fen: result.swing ? result.swing.fen : fenAfter(game.moves).fen,
        lastMove: result.swing ? result.swing.lastMove : fenAfter(game.moves).lastMove,
        analyzedAt: Date.now(),
      },
      analysisError: null,
    };
    await db.put("otb", updated);
  } catch (e) {
    const still = await db.getById("otb", game.id);
    if (!still) return;
    const updated = { ...still, analysisError: "The engine could not finish (“" + (e && e.message ? e.message : "error") + "”). You can try again. This runs entirely on this device." };
    await db.put("otb", updated);
  } finally {
    analyzingIds.delete(game.id);
    delete analyzeProgress[game.id];
    rerenderQuiet();
  }
}

/* ---------- page state ---------- */
let pageState = { addForm: { site: "lichess", color: "black", tags: [], result: "draw" }, treeColor: "white" };
let lastRoute = null;

async function render() {
  if (!isUnlocked()) {
    renderLock();
    return;
  }
  $app.className = "";
  const route = parseHash();
  lastRoute = route;
  const data = await loadLists();
  if (route.name === "add-opponent") {
    renderAddOpponent(pageState.addOpp || { form: pageState.addForm });
    return;
  }
  if (route.name === "card") {
    const opp = data.opponents.find((o) => o.id === route.id);
    if (!opp) {
      go("#/opponents");
      return;
    }
    renderCard(opp, data, { pulling: pageState.pullingId === opp.id, pullMsg: pageState.pullMsg || "", treeColor: pageState.treeColor || "white" });
    return;
  }
  if (route.name === "add-game") {
    const form = { ...pageState.addForm };
    if (route.query.opponent) form.opponentId = route.query.opponent;
    renderAddGame(data.opponents, form);
    return;
  }
  if (route.name === "lines") {
    renderLines(data);
    return;
  }
  if (route.name === "patterns") {
    renderPatterns(data);
    return;
  }
  renderOpponents(data, { q: pageState.search || "" });
}

let renderQueued = false;
function rerenderQuiet() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

/* ---------- events ---------- */
$app.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;

  if (kind === "unlock") {
    const pass = form.pass.value;
    const remember = form.remember.checked;
    form.pass.value = "";
    const ok = await verifyPasscode(pass);
    if (!ok) {
      renderLock("That passcode is not right.");
      return;
    }
    markUnlocked(remember);
    initEngine().catch(() => {});
    const h = location.hash || "";
    if (!h || h === "#" || h === "#/") go("#/opponents");
    render();
    return;
  }

  if (kind === "search") {
    pageState.search = form.q.value;
    render();
    return;
  }

  if (kind === "lookup") {
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const rating = String(fd.get("rating") || "").trim();
    const uscfId = String(fd.get("uscfId") || "").trim();
    const username = String(fd.get("username") || "").trim();
    const site = pageState.addForm.site || "lichess";
    pageState.addForm = { ...pageState.addForm, name, rating, uscfId, username, site };
    if (!name) {
      pageState.addOpp = { form: pageState.addForm, lookupMsg: "A name is needed to save a card.", lookupKind: "error" };
      render();
      return;
    }
    if (!username) {
      await saveOpponent({ pull: false });
      return;
    }
    pageState.addOpp = { form: pageState.addForm, looking: true };
    render();
    const look = site === "chesscom" ? await lookupChesscom(username) : await lookupLichess(username);
    if (!look.ok) {
      const empty = look.kind === "notfound" ? emptyAccountHTML() : "";
      pageState.addOpp = {
        form: pageState.addForm,
        looking: false,
        lookupMsg: look.message,
        lookupKind: look.kind === "notfound" ? "notfound" : "error",
        emptyCard: empty,
        match: null,
      };
      render();
      return;
    }
    pageState.addForm.username = look.username;
    pageState.addOpp = {
      form: pageState.addForm,
      looking: false,
      lookupKind: "ok",
      lookupMsg: "",
      match: look,
      matchCard: matchCardHTML(look),
    };
    render();
    return;
  }

  if (kind === "add-game") {
    readAddGameForm(form);
    await saveGame();
  }
});

$app.addEventListener("input", (e) => {
  if (e.target.matches("input[name=q]")) {
    pageState.search = e.target.value;
  }
});

$app.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "back") {
    history.length > 1 ? history.back() : go("#/opponents");
    return;
  }
  if (act === "site") {
    const f = $app.querySelector('[data-form="lookup"]');
    if (f) {
      const fd = new FormData(f);
      pageState.addForm = { ...pageState.addForm, name: fd.get("name"), rating: fd.get("rating"), uscfId: fd.get("uscfId"), username: fd.get("username") };
    }
    pageState.addForm.site = btn.dataset.site;
    if (pageState.addOpp) pageState.addOpp.form = pageState.addForm;
    render();
    return;
  }
  if (act === "color") {
    const f = $app.querySelector('[data-form="add-game"]');
    if (f) readAddGameForm(f);
    pageState.addForm.color = btn.dataset.color;
    render();
    return;
  }
  if (act === "tag") {
    const f = $app.querySelector('[data-form="add-game"]');
    if (f) readAddGameForm(f);
    const id = btn.dataset.tag;
    const tags = new Set(pageState.addForm.tags || []);
    if (tags.has(id)) tags.delete(id);
    else tags.add(id);
    pageState.addForm.tags = [...tags];
    render();
    return;
  }
  if (act === "tree-color") {
    pageState.treeColor = btn.dataset.color;
    render();
    return;
  }
  if (act === "save-only") {
    await saveOpponent({ pull: false });
    return;
  }
  if (act === "confirm-match") {
    await saveOpponent({ pull: true });
    return;
  }
  if (act === "refresh") {
    const route = parseHash();
    const opp = await db.getById("opponents", route.id);
    if (opp) await refreshOpponent(opp);
    return;
  }
  if (act === "export") {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "opponent-notebook-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Backup downloaded.");
    return;
  }
  if (act === "import") {
    $app.querySelector("#import-file")?.click();
    return;
  }
  if (act === "demo") {
    if (!confirm("Load the made-up demo? This replaces the notebook currently saved on this device.")) return;
    const demo = demoPayload();
    await db.replaceAll(demo);
    toast("Demo loaded. Names are made up.");
    go("#/opponents");
    render();
    return;
  }
  if (act === "analyze") {
    const g = await db.getById("otb", btn.dataset.id);
    if (g) runAnalysisFor(g);
    return;
  }
  if (act === "delete-opponent") {
    const id = btn.dataset.id;
    const opp = await db.getById("opponents", id);
    if (!opp) return;
    const mine = await db.getByOpponent("otb", opp.id);
    const choice = await confirmDeleteOpponent(opp, mine.length);
    if (!choice) return;
    await deleteOpponentRecord(opp, choice);
    toast(choice.deleteOtb ? "Opponent and their OTB games removed." : "Opponent removed. Your OTB games were kept.");
    go("#/opponents");
    render();
    return;
  }
  if (act === "delete-game") {
    const g = await db.getById("otb", btn.dataset.id);
    if (!g) return;
    const ok = await confirmDeleteGame(g);
    if (!ok) return;
    await deleteOtbGame(g.id);
    toast("Game removed from this device.");
    render();
    return;
  }
  if (act === "paste-pgn") {
    const form = $app.querySelector('[data-form="add-game"]');
    if (form) readAddGameForm(form);
    const ta = $app.querySelector("#pgn");
    if (!ta) return;
    const apply = (text) => {
      const value = String(text ?? "");
      if (!value.trim()) {
        toast("Clipboard is empty.");
        return false;
      }
      ta.value = value;
      pageState.addForm = { ...pageState.addForm, pgn: value };
      toast("Pasted.");
      return true;
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        const text = await navigator.clipboard.readText();
        apply(text);
        return;
      }
    } catch {
      /* fall through to a manual paste */
    }
    ta.focus();
    toast("Couldn’t read the clipboard. Long-press or tap the box and paste.");
    return;
  }
});

$app.addEventListener("change", async (e) => {
  if (e.target.id === "import-file" && e.target.files?.[0]) {
    try {
      const text = await e.target.files[0].text();
      const data = JSON.parse(text);
      if (!data || data.app !== "opponent-notebook" || !Array.isArray(data.opponents)) {
        toast("That file doesn’t look like a notebook backup.");
        return;
      }
      if (!confirm("Import this backup? It replaces the notebook currently saved on this device.")) return;
      await db.replaceAll(data);
      toast("Backup imported.");
      render();
    } catch {
      toast("Could not read that file.");
    }
    e.target.value = "";
  }
});

function readAddGameForm(form) {
  const fd = new FormData(form);
  pageState.addForm = {
    ...pageState.addForm,
    opponentId: String(fd.get("opponentId") || ""),
    event: String(fd.get("event") || ""),
    date: String(fd.get("date") || ""),
    pgn: String(fd.get("pgn") || ""),
    clock: String(fd.get("clock") || ""),
    result: String(fd.get("result") || "draw"),
    notes: String(fd.get("notes") || ""),
  };
}

async function saveGame() {
  const f = pageState.addForm;
  if (!f.opponentId) {
    const data = await loadLists();
    renderAddGame(data.opponents, f, { error: "Choose an opponent. Add one first if the list is empty." });
    return;
  }
  const text = String(f.pgn || "").trim();
  if (!text) {
    const data = await loadLists();
    renderAddGame(data.opponents, f, { error: "Paste a PGN or type at least one move." });
    return;
  }
  let parsed;
  if (/\[Event\b|\[White\b|\[Black\b/i.test(text) || text.includes("1.")) {
    parsed = parseMovesFromPgn(text);
    if (!parsed.ok || !parsed.moves.length) parsed = movesFromSanText(text);
  } else {
    parsed = movesFromSanText(text);
  }
  if (!parsed.ok || !parsed.moves.length) {
    const data = await loadLists();
    renderAddGame(data.opponents, f, { error: parsed.error || "Those moves could not be played on a board. Check the SAN or PGN." });
    return;
  }
  const game = {
    id: db.uid(),
    opponentId: f.opponentId,
    color: f.color === "white" ? "white" : "black",
    event: f.event || "",
    date: f.date || "",
    result: f.result || "draw",
    clockMinutes: f.clock || "",
    notes: (f.notes || "").trim(),
    tags: [...(f.tags || [])],
    pgn: parsed.pgn || text,
    moves: parsed.moves,
    createdAt: Date.now(),
  };
  await db.put("otb", game);
  toast("Saved on this device.");
  pageState.addForm = { ...pageState.addForm, pgn: "", notes: "", tags: [], clock: "" };
  go(`#/opponents/${f.opponentId}`);
  render();
  runAnalysisFor(game);
}

async function saveOpponent({ pull }) {
  const f = pageState.addForm;
  const opp = {
    id: db.uid(),
    name: f.name.trim(),
    rating: (f.rating || "").trim(),
    uscfId: (f.uscfId || "").trim(),
    fideId: "",
    site: pull || f.username ? f.site || "lichess" : "",
    username: (f.username || "").trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fetchError: null,
    lastFetchedAt: null,
    profile: pageState.addOpp?.match || null,
  };
  if (!opp.username) opp.site = "";
  await db.put("opponents", opp);
  pageState.addOpp = null;
  go(`#/opponents/${opp.id}`);
  render();
  if (pull && opp.username) await refreshOpponent(opp);
  else toast("Saved on this device.");
}

async function refreshOpponent(opp) {
  pageState.pullingId = opp.id;
  pageState.pullMsg = "Pulling public games…";
  render();
  const site = opp.site || "lichess";
  const result = site === "chesscom"
    ? await pullChesscomGames(opp.username, { months: 3 })
    : await pullLichessGames(opp.username, { max: 300 });
  const existing = await db.getByOpponent("online", opp.id);
  if (!result.ok && !result.partial) {
    opp.fetchError = result.message;
    opp.updatedAt = Date.now();
    await db.put("opponents", opp);
    pageState.pullingId = null;
    pageState.pullMsg = "";
    toast(result.message);
    render();
    return;
  }
  // Replace previous pull for this opponent when the new pull succeeded (or keep old + new if partial? Replace only if we got games or ok)
  if (result.ok || (result.games && result.games.length)) {
    for (const g of existing) await db.remove("online", g.id);
    for (const g of result.games) {
      await db.put("online", { ...g, id: db.uid(), opponentId: opp.id, rawId: g.id });
    }
  }
  opp.lastFetchedAt = Date.now();
  opp.fetchError = result.ok ? null : result.message;
  opp.updatedAt = Date.now();
  await db.put("opponents", opp);
  pageState.pullingId = null;
  pageState.pullMsg = "";
  toast(result.ok ? `Cached ${result.games.length} games on this device.` : result.message);
  render();
}

window.addEventListener("hashchange", () => render());

if (isUnlocked()) initEngine().catch(() => {});
render();
