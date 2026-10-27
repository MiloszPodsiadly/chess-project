// Original illustrative composition: an Italian opening after 3...Bc5.
// Coordinates project a stone board into an oblique view; this is never live game state.
type PieceKind = 'rook' | 'knight' | 'bishop' | 'queen' | 'king' | 'pawn';
const project = (file: number, rank: number) => ({ x: 500 + (file - rank) * 47, y: 250 + (file + rank) * 20.5 });

export const ARENA_SQUARES = Array.from({ length: 64 }, (_, index) => {
  const file = index % 8, rank = Math.floor(index / 8);
  const corners = [project(file, rank), project(file + 1, rank), project(file + 1, rank + 1), project(file, rank + 1)];
  return { index, light: (file + rank) % 2 === 0, points: corners.map(p => `${p.x},${p.y}`).join(' '), delay: `${(file + rank) * 95}ms` };
});

const backRank: PieceKind[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
export const ARENA_PIECES = (['black', 'white'] as const).flatMap(side => {
  const home = side === 'black' ? 0 : 7;
  return [home, side === 'black' ? 1 : 6].flatMap(rank => backRank.map((kind, file) => {
    let row = rank, col = file;
    const isPawn = rank !== home;
    if (isPawn && file === 4) row += side === 'black' ? 2 : -2;
    if (!isPawn && kind === 'knight' && file === (side === 'black' ? 1 : 6)) {
      row += side === 'black' ? 2 : -2;
      col += side === 'black' ? 1 : -1;
    }
    if (!isPawn && kind === 'bishop' && file === 5) {
      row += side === 'black' ? 3 : -3;
      col = 2;
    }
    const position = project(col + .5, row + .5);
    return { id: `${side}-${file}-${rank}`, side, kind: isPawn ? 'pawn' as const : kind,
      x: position.x, y: position.y, depth: col + row,
      champion: !isPawn && kind === 'bishop' && file === 5,
      delay: `${650 + (col + row) * 90}ms` };
  }));
}).sort((a, b) => a.depth - b.depth || a.x - b.x);
