import { Chess } from "../vendor/chess/chess.js";
import { openingName, departureIndex } from "./eco.js";
import { formatMoveLine } from "./openings.js";

const WORKER_SRC = new URL("../vendor/stockfish/stockfish-19-lite-single.js", import.meta.url).href;

let worker = null;
let ready = null;
let queue = Promise.resolve();

function lineFromEvent(ev) {
  if (typeof ev === "string") return ev;
  if (ev && typeof ev.data === "string") return ev.data;
  if (ev && ev.data && typeof ev.data.text === "string") return ev.data.text;
  return ev && ev.data != null ? String(ev.data) : "";
}

export function initEngine() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    try {
      worker = new Worker(WORKER_SRC);
    } catch (e) {
      ready = null;
      reject(e);
      return;
    }
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("The engine did not start in time."));
      }
    }, 20000);
    worker.onerror = (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(t);
        reject(e.error || new Error("Engine worker error"));
      }
    };
    worker.onmessage = (ev) => {
      const line = lineFromEvent(ev);
      if (!settled && (line === "uciok" || /\buciok\b/.test(line))) {
        settled = true;
        clearTimeout(t);
        resolve(true);
      }
    };
    worker.postMessage("uci");
  }).then(async () => {
    await sendAndWait("isready", (l) => l === "readyok" || /\breadyok\b/.test(l));
    return true;
  });
  return ready;
}

function sendAndWait(cmd, predicate, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lines = [];
    const t = setTimeout(() => {
      worker.removeEventListener("message", onMsg);
      reject(new Error("Engine timed out."));
    }, timeoutMs);
    function onMsg(ev) {
      const line = lineFromEvent(ev);
      lines.push(line);
      if (predicate(line, lines)) {
        clearTimeout(t);
        worker.removeEventListener("message", onMsg);
        resolve(lines);
      }
    }
    worker.addEventListener("message", onMsg);
    worker.postMessage(cmd);
  });
}

export function evalFen(fen, depth = 12) {
  queue = queue.then(() => runEval(fen, depth), () => runEval(fen, depth));
  return queue;
}

async function runEval(fen, depth) {
  await initEngine();
  worker.postMessage("ucinewgame");
  await sendAndWait("isready", (l) => l === "readyok" || /\breadyok\b/.test(l), 10000);
  worker.postMessage(`position fen ${fen}`);
  const lines = await sendAndWait(
    `go depth ${depth}`,
    (l) => l.startsWith("bestmove") || /\bbestmove\b/.test(l),
    30000
  );
  let score = { type: "cp", value: 0 };
  let bestmove = "";
  for (const line of lines) {
    const sm = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
    if (sm) score = { type: sm[1], value: Number(sm[2]) };
    const bm = line.match(/\bbestmove\s+(\S+)/);
    if (bm) bestmove = bm[1];
  }
  return { score, bestmove };
}

/** Convert UCI score (White's POV) to pawns from a player's point of view. */
export function toPawns(score, playerIsWhite) {
  if (!score) return 0;
  let v;
  if (score.type === "mate") {
    const sign = score.value >= 0 ? 1 : -1;
    v = sign * 100;
  } else {
    v = score.value / 100;
  }
  return playerIsWhite ? v : -v;
}

const SWING_PAWNS = 0.8;

/**
 * Walk the game, evaluate after each ply, find the first move by `playerIsWhite`
 * that drops the player's eval by at least 0.8 pawns.
 */
export async function analyzeGame(moves, playerIsWhite, { depth = 12, onProgress } = {}) {
  await initEngine();
  const chess = new Chess();
  const start = await evalFen(chess.fen(), depth);
  const trail = [{ ply: 0, san: null, fen: chess.fen(), lastMove: null, pawns: toPawns(start.score, playerIsWhite), score: start.score }];
  const list = moves || [];
  for (let i = 0; i < list.length; i++) {
    const mv = chess.move(list[i]);
    if (!mv) break;
    if (onProgress) onProgress(i + 1, list.length);
    const ev = await evalFen(chess.fen(), depth);
    trail.push({
      ply: i + 1,
      san: mv.san,
      fen: chess.fen(),
      lastMove: { from: mv.from, to: mv.to },
      pawns: toPawns(ev.score, playerIsWhite),
      score: ev.score,
      byPlayer: mv.color === (playerIsWhite ? "w" : "b"),
    });
  }
  let swing = null;
  for (let i = 1; i < trail.length; i++) {
    const cur = trail[i];
    if (!cur.byPlayer) continue;
    const drop = trail[i - 1].pawns - cur.pawns;
    if (drop >= SWING_PAWNS) {
      swing = {
        ply: cur.ply,
        san: cur.san,
        moveNumber: Math.ceil(cur.ply / 2),
        fen: cur.fen,
        lastMove: cur.lastMove,
        before: trail[i - 1].pawns,
        after: cur.pawns,
        drop,
      };
      break;
    }
  }

  const name = openingName(list);
  return { trail, swing, openingName: name, depth };
}

export function describeSwing(swing, playerIsWhite) {
  if (!swing) {
    return "No single move by you dropped the engine’s evaluation by 0.8 pawns or more (at this depth). That is not a claim the game was accurate — only that no swing of that size showed up.";
  }
  const fmt = (n) => (n >= 0 ? "+" : "") + n.toFixed(2);
  const color = playerIsWhite ? "White" : "Black";
  return `First big swing (your move, as ${color}): ${swing.moveNumber}.… ${swing.san} went from ${fmt(swing.before)} to ${fmt(swing.after)} (a drop of ${swing.drop.toFixed(2)} pawns, engine’s view, modest depth).`;
}

export function describeDeparture(moves, referenceLine) {
  if (!referenceLine || !referenceLine.length) {
    const name = openingName(moves);
    return name
      ? `Opening (from a small bundled name table): ${name}.`
      : "No opening name was found in the bundled table for this move sequence.";
  }
  const idx = departureIndex(moves, referenceLine);
  const name = openingName(moves);
  const named = name ? ` Opening name (bundled table): ${name}.` : "";
  if (idx < 0) {
    return `You stayed on the most common line in the pulled games through ${formatMoveLine(referenceLine)}.${named}`;
  }
  if (idx === 0) {
    return `You left the most common pulled line at move 1 (that line starts ${formatMoveLine(referenceLine.slice(0, 4))}).${named}`;
  }
  const left = moves[idx];
  return `You left the most common pulled line at ${formatMoveLine(referenceLine.slice(0, idx))}, where that set usually continues ${referenceLine[idx]} and you played ${left}.${named}`;
}
