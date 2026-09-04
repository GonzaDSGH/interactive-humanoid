// Minimal OBJ parser: extracts vertex positions and triangulated face indices.
// Only handles what the source model actually uses (v / f, quads or tris, 1-based indices).
export function parseOBJ(text) {
  const positions = [];
  const faces = []; // flat array of triangle vertex indices (0-based)

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.charCodeAt(0) !== 118 && line.charCodeAt(0) !== 102) continue; // fast skip: not 'v' or 'f'

    if (line.startsWith('v ')) {
      const parts = line.trim().split(/\s+/);
      positions.push(
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      );
    } else if (line.startsWith('f ')) {
      const parts = line.trim().split(/\s+/);
      // face vertex refs look like "12", "12/5", "12/5/7" or "12//7" - only need the vertex index.
      const idx = [];
      for (let k = 1; k < parts.length; k++) {
        const token = parts[k];
        const slash = token.indexOf('/');
        const vRef = slash === -1 ? token : token.slice(0, slash);
        idx.push(parseInt(vRef, 10) - 1);
      }
      // fan-triangulate (works for tris and the quads this model uses)
      for (let k = 1; k < idx.length - 1; k++) {
        faces.push(idx[0], idx[k], idx[k + 1]);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    faces: new Uint32Array(faces),
  };
}
