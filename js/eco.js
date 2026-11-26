/** Small bundled opening-name table. Longest move-sequence match wins. */
const LINES = [
  ["e4 e5", "King’s Pawn Game"],
  ["e4 e5 Nf3", "King’s Knight Opening"],
  ["e4 e5 Nf3 Nc6", "King’s Knight Opening"],
  ["e4 e5 Nf3 Nc6 Bb5", "Ruy Lopez"],
  ["e4 e5 Nf3 Nc6 Bb5 a6", "Ruy Lopez, Morphy Defense"],
  ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6", "Ruy Lopez, Morphy Defense"],
  ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O b5 Bb3 Bc5", "Ruy Lopez, Arkhangelsk / Møller"],
  ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O d6", "Ruy Lopez, Steinitz Deferred"],
  ["e4 e5 Nf3 Nc6 Bb5 a6 Bxc6", "Ruy Lopez, Exchange"],
  ["e4 e5 Nf3 Nc6 Bc4", "Italian Game"],
  ["e4 e5 Nf3 Nc6 Bc4 Bc5", "Italian Game, Giuoco Piano"],
  ["e4 e5 Nf3 Nc6 Bc4 Bc5 c3", "Italian Game, Giuoco Piano"],
  ["e4 e5 Nf3 Nc6 Bc4 Nf6", "Two Knights Defense"],
  ["e4 e5 Nf3 Nc6 d4", "Scotch Game"],
  ["e4 e5 Nf3 Nf6", "Petrov’s Defense"],
  ["e4 e5 Nc3", "Vienna Game"],
  ["e4 e5 f4", "King’s Gambit"],
  ["e4 e5 f4 d5", "King’s Gambit, Falkbeer Countergambit"],
  ["e4 e5 f4 d5 exd5 c6", "King’s Gambit, Falkbeer, …c6"],
  ["e4 e5 f4 exf4", "King’s Gambit Accepted"],
  ["e4 e5 d4", "Center Game"],
  ["e4 c5", "Sicilian Defense"],
  ["e4 c5 Nf3 d6", "Sicilian Defense"],
  ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "Sicilian, Najdorf"],
  ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6", "Sicilian, Dragon"],
  ["e4 c5 Nf3 Nc6", "Sicilian Defense"],
  ["e4 c5 Nf3 e6", "Sicilian, French Variation"],
  ["e4 c6", "Caro-Kann Defense"],
  ["e4 e6", "French Defense"],
  ["e4 d6", "Pirc Defense"],
  ["e4 d5", "Scandinavian Defense"],
  ["e4 Nf6", "Alekhine’s Defense"],
  ["e4 g6", "Modern Defense"],
  ["e4 c5 Nc3", "Sicilian, Closed"],
  ["d4 d5", "Queen’s Pawn Game"],
  ["d4 d5 c4", "Queen’s Gambit"],
  ["d4 d5 c4 e6", "Queen’s Gambit Declined"],
  ["d4 d5 c4 c6", "Slav Defense"],
  ["d4 d5 c4 dxc4", "Queen’s Gambit Accepted"],
  ["d4 Nf6", "Indian Defense"],
  ["d4 Nf6 c4 e6", "Indian Defense, …e6"],
  ["d4 Nf6 c4 e6 Nc3 Bb4", "Nimzo-Indian Defense"],
  ["d4 Nf6 c4 e6 Nf3 b6", "Queen’s Indian Defense"],
  ["d4 Nf6 c4 g6", "King’s Indian / Grünfeld"],
  ["d4 Nf6 c4 g6 Nc3 d5", "Grünfeld Defense"],
  ["d4 Nf6 c4 g6 Nc3 Bg7", "King’s Indian Defense"],
  ["d4 f5", "Dutch Defense"],
  ["d4 e6", "Horwitz Defense / French transposition"],
  ["c4", "English Opening"],
  ["c4 e5", "English Opening, Reversed Sicilian"],
  ["Nf3", "Réti / Zukertort"],
  ["Nf3 d5", "Réti Opening"],
  ["g3", "Benko’s Opening / King’s Fianchetto"],
];

export function openingName(moves) {
  if (!moves || !moves.length) return null;
  const seq = moves.map(normalizeSan).join(" ");
  let best = null;
  for (const [key, name] of LINES) {
    if (seq === key || seq.startsWith(key + " ")) {
      if (!best || key.length > best[0].length) best = [key, name];
    }
  }
  return best ? best[1] : null;
}

export function normalizeSan(san) {
  return String(san || "").replace(/[+#?!]/g, "").trim();
}

/** First index in `moves` that leaves `mainLine` (array of SAN). 0-based. -1 if never leaves or mainLine empty. */
export function departureIndex(moves, mainLine) {
  if (!mainLine || !mainLine.length) return -1;
  const m = (moves || []).map(normalizeSan);
  const line = mainLine.map(normalizeSan);
  for (let i = 0; i < line.length; i++) {
    if (m[i] !== line[i]) return i;
  }
  return -1;
}
