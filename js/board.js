const FILES = "abcdefgh";

function squareColor(file, rank) {
  return (file + rank) % 2 === 0 ? "dark" : "light";
}

function pieceFile(ch) {
  const color = ch === ch.toUpperCase() ? "w" : "b";
  const map = { p: "P", n: "N", b: "B", r: "R", q: "Q", k: "K" };
  return `pieces/${color}${map[ch.toLowerCase()]}.svg`;
}

/** Parse FEN placement into a 8x8 array of piece letters or "". Rank 8 first. */
export function fenToGrid(fen) {
  const placement = (fen || "").split(" ")[0] || "8/8/8/8/8/8/8/8";
  const rows = placement.split("/");
  const grid = [];
  for (const row of rows) {
    const cells = [];
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) cells.push("");
      } else {
        cells.push(ch);
      }
    }
    while (cells.length < 8) cells.push("");
    grid.push(cells.slice(0, 8));
  }
  while (grid.length < 8) grid.push(Array(8).fill(""));
  return grid.slice(0, 8);
}

/**
 * Render a chessboard. No coordinate labels.
 * lastMove: { from: "e2", to: "e4" } or ["e2","e4"]
 * flipped: true shows Black at the bottom.
 */
export function boardHTML(fen, { lastMove = null, flipped = false, aria = "Chessboard", sizeClass = "" } = {}) {
  const grid = fenToGrid(fen);
  const hi = new Set();
  let from = null, to = null;
  if (Array.isArray(lastMove)) {
    from = lastMove[0];
    to = lastMove[1];
  } else if (lastMove && typeof lastMove === "object") {
    from = lastMove.from;
    to = lastMove.to;
  }
  const ranks = flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  let cells = "";
  for (const r of ranks) {
    for (const f of files) {
      const name = FILES[f] + (r + 1);
      const cls = ["sq", squareColor(f, r)];
      if (from && name === from) cls.push("hi-from");
      if (to && name === to) cls.push("hi-to");
      const piece = grid[7 - r][f];
      const img = piece ? `<img src="${pieceFile(piece)}" alt=""/>` : "";
      cells += `<div class="${cls.join(" ")}">${img}</div>`;
    }
  }
  const frameCls = sizeClass ? `board-frame ${sizeClass}` : "board-frame";
  return `<div class="${frameCls}"><div class="board" role="img" aria-label="${escapeAttr(aria)}">${cells}</div></div>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
