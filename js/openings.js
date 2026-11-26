import { Chess } from "../vendor/chess/chess.js";
import { openingName, normalizeSan, departureIndex } from "./eco.js";

export function parseMovesFromPgn(pgn) {
  const chess = new Chess();
  try {
    chess.loadPgn(String(pgn || ""), { strict: false });
  } catch {
    return { ok: false, moves: [], headers: {}, error: "Could not parse PGN." };
  }
  return {
    ok: true,
    moves: chess.history(),
    headers: chess.getHeaders ? chess.getHeaders() : chess.header(),
    fen: chess.fen(),
  };
}

export function movesFromSanText(text) {
  const chess = new Chess();
  const raw = String(text || "")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\d+\.(\.\.)?/g, " ")
    .replace(/[0-9]+-[0-9]+|1\/2-1\/2|\*/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const moves = [];
  for (const tok of raw) {
    const san = tok.replace(/[?!]+$/, "");
    if (!san || san === "…" || san === "...") continue;
    try {
      const mv = chess.move(san);
      if (!mv) return { ok: false, moves, error: `Could not play “${san}”.` };
      moves.push(mv.san);
    } catch {
      return { ok: false, moves, error: `Could not play “${san}”.` };
    }
  }
  return { ok: true, moves, pgn: chess.pgn(), fen: chess.fen(), chess };
}

export function fenAfter(moves, n) {
  const chess = new Chess();
  const list = moves || [];
  const upto = n == null ? list.length : n;
  for (let i = 0; i < upto && i < list.length; i++) {
    try { chess.move(list[i]); } catch { break; }
  }
  const hist = chess.history({ verbose: true });
  const last = hist[hist.length - 1];
  return { fen: chess.fen(), lastMove: last ? { from: last.from, to: last.to } : null };
}

function resultScore(result, isWhite) {
  if (result === "1-0") return isWhite ? 1 : 0;
  if (result === "0-1") return isWhite ? 0 : 1;
  if (result === "1/2-1/2") return 0.5;
  return null;
}

export function classifyTime(game) {
  if (game.timeClass) return game.timeClass;
  const tc = String(game.timeControl || "");
  const m = tc.match(/^(\d+)(?:\+(\d+))?/);
  if (!m) return game.timeControl || "unknown";
  const base = Number(m[1]);
  const inc = Number(m[2] || 0);
  const est = base + 40 * inc;
  if (est < 30) return "ultrabullet";
  if (est < 180) return "bullet";
  if (est < 480) return "blitz";
  if (est < 1500) return "rapid";
  return "classical";
}

export function formatTimeControl(game) {
  const tc = game.timeControl;
  if (tc && /^\d+(\+\d+)?$/.test(tc)) {
    const [b, i] = tc.split("+");
    const min = Math.round(Number(b) / 60);
    if (Number(b) % 60 === 0) return i ? `${min}+${i}` : `${min}+0`;
    return tc;
  }
  return classifyTime(game);
}

/**
 * Build an opening tree for games of one color (opponent as white or black).
 * games: { moves: string[], result, isWhite: boolean (opponent's color) }
 */
export function buildTree(games) {
  const root = { move: null, games: 0, points: 0, children: new Map(), parent: null, line: [] };
  for (const g of games) {
    const score = resultScore(g.result, g.isWhite);
    if (score == null) continue;
    let node = root;
    node.games += 1;
    node.points += score;
    const moves = g.moves || [];
    for (const raw of moves.slice(0, 24)) {
      const san = normalizeSan(raw);
      if (!san) break;
      if (!node.children.has(san)) {
        const child = { move: san, games: 0, points: 0, children: new Map(), parent: node, line: node.line.concat(san) };
        node.children.set(san, child);
      }
      node = node.children.get(san);
      node.games += 1;
      node.points += score;
    }
  }
  return root;
}

export function nodeScorePct(node) {
  if (!node.games) return null;
  return Math.round((node.points / node.games) * 100);
}

export function childrenSorted(node) {
  return [...node.children.values()].sort((a, b) => b.games - a.games);
}

/** Weakest child at any depth with games >= minGames, preferring deeper / more specific lines. */
export function weakestLine(root, minGames = 8) {
  let best = null;
  function walk(node, depth) {
    if (depth > 0 && node.games >= minGames) {
      const pct = nodeScorePct(node);
      if (best == null || pct < best.pct || (pct === best.pct && node.games > best.node.games)) {
        best = { node, pct, depth };
      }
    }
    for (const ch of node.children.values()) walk(ch, depth + 1);
  }
  walk(root, 0);
  return best;
}

export function formatLine(moves) {
  const parts = [];
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) parts.push(`${Math.floor(i / 2) + 1}.${moves[i]}`);
    else parts.push(moves[i]);
  }
  return parts.join(" ");
}

export function dominantTime(games) {
  const counts = new Map();
  for (const g of games) {
    const k = formatTimeControl(g);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let top = null, n = 0;
  for (const [k, c] of counts) if (c > n) { top = k; n = c; }
  return top ? { label: top, count: n } : null;
}

/**
 * Five-line prep note from real stats only. No invented claims.
 * myOtb: his games vs this opponent, used only to mention overlap with a weak line.
 */
export function prepNote({ whiteGames, blackGames, allGames, otbCount, myOtb }) {
  const lines = [];
  const wTree = buildTree(whiteGames);
  const bTree = buildTree(blackGames);

  if (whiteGames.length === 0 && blackGames.length === 0) {
    return {
      lines: ["No online games are stored for this opponent yet, so there is no opening tree to summarize.",
        otbCount ? `You have ${otbCount} over-the-board game${otbCount === 1 ? "" : "s"} logged against them.` : "You can still log over-the-board games."],
      basis: basisLine(allGames, otbCount),
      whiteTree: wTree,
      blackTree: bTree,
      weak: null,
    };
  }

  // 1. As White
  if (whiteGames.length === 0) {
    lines.push("No games were pulled with this opponent as White, so their White repertoire is unknown here.");
  } else {
    const first = childrenSorted(wTree)[0];
    if (first) {
      const name = openingName(first.line);
      const extra = name ? `, heading for the ${name}` : "";
      lines.push(`As White they most often open ${formatLine(first.line)}${extra} (${first.games} of ${whiteGames.length} White games).`);
    }
  }

  // 2. As Black vs 1.e4 / 1.d4
  if (blackGames.length === 0) {
    lines.push("No games were pulled with this opponent as Black, so their Black replies are unknown here.");
  } else {
    const e4 = (wMove) => wMove === "e4";
    // black games start with opponent as black, so first move is White's
    const vs = { e4: [], d4: [], other: 0 };
    for (const g of blackGames) {
      const wm = (g.fullMoves && g.fullMoves[0]) || (g.boardMoves && g.boardMoves[0]);
      // We only stored opponent's moves? We store full game moves from move 1 (White first).
      const first = (g.moves && g.moves[0]) ? normalizeSan(g.moves[0]) : null;
      const reply = g.moves && g.moves[1] ? normalizeSan(g.moves[1]) : null;
      if (first === "e4" && reply) vs.e4.push(reply);
      else if (first === "d4" && reply) vs.d4.push(reply);
      else vs.other++;
    }
    if (vs.e4.length) {
      const tally = countMap(vs.e4);
      const [reply, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      lines.push(`As Black they answer 1.e4 with 1…${reply} (${n} of ${vs.e4.length} games against 1.e4).`);
    } else if (vs.d4.length) {
      const tally = countMap(vs.d4);
      const [reply, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      lines.push(`As Black they answer 1.d4 with 1…${reply} (${n} of ${vs.d4.length} games against 1.d4).`);
    } else {
      lines.push(`As Black they have ${blackGames.length} pulled game${blackGames.length === 1 ? "" : "s"}, but not enough 1.e4 or 1.d4 replies to name a defense.`);
    }
  }

  // 3. Weakest line >= 8
  const weakW = weakestLine(wTree, 8);
  const weakB = weakestLine(bTree, 8);
  let weak = null;
  if (weakW && weakB) weak = weakW.pct <= weakB.pct ? { ...weakW, color: "White" } : { ...weakB, color: "Black" };
  else if (weakW) weak = { ...weakW, color: "White" };
  else if (weakB) weak = { ...weakB, color: "Black" };

  if (weak) {
    lines.push(`They score worst as ${weak.color} after ${formatLine(weak.node.line)} (${weak.node.games} games, ${weak.pct}%).`);
  } else {
    const most = whiteGames.length >= blackGames.length ? whiteGames.length : blackGames.length;
    lines.push("No line has 8 or more games in the pulled set, so a weak-spot line is not clear yet.");
  }

  // 4. Steer toward — only if we have a weak line, optionally mention his OTB overlap
  if (weak) {
    let overlap = "";
    if (myOtb && myOtb.length) {
      const hit = myOtb.find((g) => prefixMatch(g.moves, weak.node.line));
      if (hit) overlap = " You have already reached this line against them over the board.";
    }
    lines.push(`A line the numbers suggest steering toward: ${formatLine(weak.node.line)}.${overlap}`);
  } else if ((whiteGames.length + blackGames.length) < 20) {
    lines.push(`Only ${whiteGames.length + blackGames.length} online games are in the cache — too few to recommend a line with confidence.`);
  } else {
    lines.push("There is no statistically weak line (8+ games) to steer toward from this pull.");
  }

  // 5. Time-control warning
  const dom = dominantTime(allGames);
  if (dom) {
    lines.push(`Most of the pulled games are ${dom.label} (${dom.count} of ${allGames.length}). Online habits at that speed may not match a slower over-the-board time control.`);
  } else {
    lines.push("Time controls are mixed or unmarked in the pulled games, so any pattern should be treated cautiously.");
  }

  return {
    lines: lines.slice(0, 5),
    basis: basisLine(allGames, otbCount, dom),
    whiteTree: wTree,
    blackTree: bTree,
    weak,
  };
}

function basisLine(allGames, otbCount, dom) {
  const n = allGames.length;
  const otb = otbCount || 0;
  const timeBit = dom ? ` (mostly ${dom.label})` : "";
  const onlineBit = n ? `${n} online game${n === 1 ? "" : "s"}${timeBit}` : "no online games";
  const otbBit = `${otb} OTB game${otb === 1 ? "" : "s"}`;
  return `Based on ${onlineBit} + ${otbBit}.`;
}

function countMap(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

function prefixMatch(moves, line) {
  if (!moves || moves.length < line.length) return false;
  for (let i = 0; i < line.length; i++) {
    if (normalizeSan(moves[i]) !== normalizeSan(line[i])) return false;
  }
  return true;
}

/** Most common move sequence from a tree, up to `maxPlies`. */
export function mainLine(tree, maxPlies = 12) {
  const line = [];
  let node = tree;
  for (let i = 0; i < maxPlies; i++) {
    const kids = childrenSorted(node);
    if (!kids.length) break;
    line.push(kids[0].move);
    node = kids[0];
  }
  return line;
}

export { openingName, departureIndex, formatLine as formatMoveLine };
