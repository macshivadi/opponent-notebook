import { Chess } from "../vendor/chess/chess.js";
import { uid } from "./db.js";

function isCorsOrNetwork(err) {
  const m = String(err && err.message || err || "");
  return (
    err instanceof TypeError ||
    /failed to fetch|networkerror|load failed|cors/i.test(m)
  );
}

export function describeFetchError(err, site) {
  if (isCorsOrNetwork(err)) {
    return `${site} blocked this request in the browser (CORS or a network error). You can still log over-the-board games.`;
  }
  return String(err && err.message ? err.message : err);
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  return { res, status: res.status };
}

export async function lookupLichess(username) {
  const user = String(username || "").trim();
  if (!user) return { ok: false, kind: "empty", message: "Enter a username." };
  let res;
  try {
    res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(user)}`);
  } catch (err) {
    return { ok: false, kind: "cors", message: describeFetchError(err, "Lichess") };
  }
  if (res.status === 404) {
    return { ok: false, kind: "notfound", message: "No Lichess account turned up for this username. You can still log your over-the-board games." };
  }
  if (res.status === 429) {
    return { ok: false, kind: "rate", message: "Lichess asked us to slow down (rate limit). Try again in a minute." };
  }
  if (!res.ok) {
    return { ok: false, kind: "http", message: `Lichess returned ${res.status}. You can still log over-the-board games.` };
  }
  const u = await res.json();
  const perfs = u.perfs || {};
  const rapid = perfs.rapid || perfs.blitz || perfs.classical || null;
  return {
    ok: true,
    site: "lichess",
    username: u.username || user,
    displayName: (u.profile && (u.profile.realName || u.profile.name)) || u.username,
    rating: rapid ? rapid.rating : null,
    ratingLabel: rapid && perfs.rapid ? "rapid" : rapid && perfs.blitz ? "blitz" : "rating",
    seenAt: u.seenAt,
    count: u.count && u.count.all,
  };
}

export async function lookupChesscom(username) {
  const user = String(username || "").trim();
  if (!user) return { ok: false, kind: "empty", message: "Enter a username." };
  let res;
  try {
    res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}`);
  } catch (err) {
    return { ok: false, kind: "cors", message: describeFetchError(err, "Chess.com") };
  }
  if (res.status === 404) {
    return { ok: false, kind: "notfound", message: "No Chess.com account turned up for this username. You can still log your over-the-board games." };
  }
  if (res.status === 429) {
    return { ok: false, kind: "rate", message: "Chess.com asked us to slow down (rate limit). Try again in a minute." };
  }
  if (!res.ok) {
    return { ok: false, kind: "http", message: `Chess.com returned ${res.status}. You can still log over-the-board games.` };
  }
  const u = await res.json();
  let rating = null, ratingLabel = "rating";
  try {
    const st = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/stats`);
    if (st.ok) {
      const stats = await st.json();
      const pool = stats.chess_rapid || stats.chess_blitz || stats.chess_daily;
      if (pool && pool.last) {
        rating = pool.last.rating;
        ratingLabel = stats.chess_rapid ? "rapid" : stats.chess_blitz ? "blitz" : "daily";
      }
    }
  } catch { /* rating is optional */ }
  return {
    ok: true,
    site: "chesscom",
    username: u.username || user,
    displayName: u.name || u.username,
    rating,
    ratingLabel,
    url: u.url,
  };
}

function gameFromParsed({ pgn, source, sourceId, timeControl, timeClass, playedAt, opening, white, black, result }) {
  let moves = [];
  try {
    const c = new Chess();
    c.loadPgn(pgn, { strict: false });
    moves = c.history();
    const h = c.getHeaders ? c.getHeaders() : {};
    result = result || h.Result;
    white = white || h.White;
    black = black || h.Black;
    opening = opening || h.Opening || h.ECO;
    timeControl = timeControl || h.TimeControl;
  } catch {
    return null;
  }
  if (!moves.length) return null;
  return {
    id: `${source}:${sourceId || uid()}`,
    source,
    sourceId: sourceId || null,
    pgn,
    moves,
    white: white || "",
    black: black || "",
    result: result || "*",
    timeControl: timeControl || "",
    timeClass: timeClass || "",
    playedAt: playedAt || null,
    opening: opening || "",
  };
}

function oppIsWhite(game, username) {
  const u = String(username || "").toLowerCase();
  return String(game.white || "").toLowerCase() === u;
}

function oppIsBlack(game, username) {
  const u = String(username || "").toLowerCase();
  return String(game.black || "").toLowerCase() === u;
}

export function attachColor(game, username) {
  const asWhite = oppIsWhite(game, username);
  const asBlack = oppIsBlack(game, username);
  return { ...game, isWhite: asWhite, known: asWhite || asBlack };
}

export async function pullLichessGames(username, { max = 300, onProgress } = {}) {
  const user = String(username || "").trim();
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&opening=true&pgnInJson=true&moves=true&clocks=false&evals=false`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/x-ndjson" } });
  } catch (err) {
    return { ok: false, kind: "cors", message: describeFetchError(err, "Lichess"), games: [] };
  }
  if (res.status === 404) {
    return { ok: false, kind: "notfound", message: "No Lichess account found.", games: [] };
  }
  if (res.status === 429) {
    return { ok: false, kind: "rate", message: "Lichess rate limit. Try again in a minute.", games: [] };
  }
  if (!res.ok) {
    return { ok: false, kind: "http", message: `Lichess returned ${res.status}.`, games: [] };
  }
  const text = await res.text();
  const games = [];
  const lines = text.split("\n").filter((l) => l.trim());
  let i = 0;
  for (const line of lines) {
    i++;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const white = obj.players?.white?.user?.name || obj.players?.white?.userId || "";
    const black = obj.players?.black?.user?.name || obj.players?.black?.userId || "";
    let result = "*";
    if (obj.winner === "white") result = "1-0";
    else if (obj.winner === "black") result = "0-1";
    else if (obj.status === "draw" || obj.status === "stalemate") result = "1/2-1/2";
    const clock = obj.clock;
    const timeControl = clock ? `${clock.initial}+${clock.increment}` : (obj.daysPerTurn ? `${obj.daysPerTurn}d` : "");
    let g = null;
    if (obj.pgn) {
      g = gameFromParsed({
        pgn: obj.pgn,
        source: "lichess",
        sourceId: obj.id,
        timeControl,
        timeClass: obj.speed || "",
        playedAt: obj.lastMoveAt || obj.createdAt || null,
        opening: obj.opening?.name || "",
        white,
        black,
        result,
      });
    } else if (obj.moves) {
      const moves = String(obj.moves).trim().split(/\s+/).filter(Boolean);
      if (moves.length) {
        g = {
          id: `lichess:${obj.id}`,
          source: "lichess",
          sourceId: obj.id,
          pgn: "",
          moves,
          white, black, result,
          timeControl,
          timeClass: obj.speed || "",
          playedAt: obj.lastMoveAt || obj.createdAt || null,
          opening: obj.opening?.name || "",
        };
        g = attachColor(g, user);
      }
    }
    if (g) {
      if (!g.known) g = attachColor(g, user);
      games.push(g);
    }
    if (onProgress && i % 40 === 0) onProgress(i, lines.length);
  }
  return { ok: true, games };
}

export async function pullChesscomGames(username, { months = 3, onProgress } = {}) {
  const user = String(username || "").trim().toLowerCase();
  let res;
  try {
    res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  } catch (err) {
    return { ok: false, kind: "cors", message: describeFetchError(err, "Chess.com"), games: [] };
  }
  if (res.status === 404) {
    return { ok: false, kind: "notfound", message: "No Chess.com account found.", games: [] };
  }
  if (res.status === 429) {
    return { ok: false, kind: "rate", message: "Chess.com rate limit. Try again in a minute.", games: [] };
  }
  if (!res.ok) {
    return { ok: false, kind: "http", message: `Chess.com returned ${res.status}.`, games: [] };
  }
  const data = await res.json();
  const archives = Array.isArray(data.archives) ? data.archives : [];
  const slice = archives.slice(-Math.max(1, months));
  const games = [];
  for (let i = 0; i < slice.length; i++) {
    const url = slice[i];
    if (onProgress) onProgress(i, slice.length, url);
    let ar;
    try {
      ar = await fetch(url);
    } catch (err) {
      return { ok: false, kind: "cors", message: describeFetchError(err, "Chess.com"), games, partial: true };
    }
    if (ar.status === 429) {
      return { ok: false, kind: "rate", message: "Chess.com rate limit while reading archives. Games already read were kept.", games, partial: true };
    }
    if (!ar.ok) continue;
    const body = await ar.json();
    for (const item of body.games || []) {
      const pgn = item.pgn;
      if (!pgn) continue;
      const g = gameFromParsed({
        pgn,
        source: "chesscom",
        sourceId: item.uuid || item.url || item.end_time,
        timeControl: item.time_control,
        timeClass: item.time_class,
        playedAt: item.end_time ? item.end_time * 1000 : null,
        opening: item.eco || "",
        white: item.white && (item.white.username || item.white),
        black: item.black && (item.black.username || item.black),
        result: resultFromChesscom(item),
      });
      if (g) games.push(attachColor(g, user));
    }
  }
  return { ok: true, games, archivesUsed: slice.length, archivesTotal: archives.length };
}

function resultFromChesscom(item) {
  const wr = item.white && item.white.result;
  const br = item.black && item.black.result;
  if (wr === "win") return "1-0";
  if (br === "win") return "0-1";
  if (wr && /draw|stalemate|agreed|repetition|insufficient|timevsinsufficient|50move/.test(wr)) return "1/2-1/2";
  return "*";
}

export async function lookupAndPull(site, username, opts) {
  if (site === "lichess") {
    const look = await lookupLichess(username);
    if (!look.ok) return { lookup: look, pull: null };
    const pull = await pullLichessGames(look.username, opts);
    return { lookup: look, pull };
  }
  if (site === "chesscom") {
    const look = await lookupChesscom(username);
    if (!look.ok) return { lookup: look, pull: null };
    const pull = await pullChesscomGames(look.username, opts);
    return { lookup: look, pull };
  }
  return { lookup: { ok: false, message: "Choose Lichess or Chess.com." }, pull: null };
}
