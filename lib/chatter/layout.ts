import type { Point2 } from './types';

export interface Obstacle { id: string; x: number; z: number; width: number; depth: number }
export const OFFICE_LAYOUT = {
  bounds: { minX: -9.6, maxX: 9.6, minZ: -6.6, maxZ: 6.6 },
  desks: [
    { id: 'hermes', position: [-7, -4.5] as Point2, seat: [-7, -3.5] as Point2 },
    { id: 'luna', position: [-7, 4.2] as Point2, seat: [-7, 5.2] as Point2 },
    ...['diego', 'mateo', 'valentina', 'ana', 'lucia', 'jorge', 'pablo', 'carlos'].map((id, i) => ({
      id, position: [-3 + (i % 4) * 2, i < 4 ? 1 : 4] as Point2,
      seat: [-3 + (i % 4) * 2, i < 4 ? 2 : 5] as Point2,
    })),
  ],
  meeting: [-1, -4.5] as Point2,
  meetingSeats: [[-2.5, -3.25], [-1, -3.25], [.5, -3.25], [-2.5, -5.75], [-1, -5.75], [.5, -5.75], [-3.4, -4.5], [1.4, -4.5], [-3.5, -3], [1.5, -3]] as Point2[],
  coffeeSeats: [[6, 3.5], [7.6, 4.5], [6, 5.5], [7, 2.5], [5.2, 4.5], [7, 5.7], [5.2, 5.7], [5.2, 3], [7.5, 3.5], [5.2, 2]] as Point2[],
  loungeSeats: [[5.5, -4], [7, -4], [8, -4], [4.5, -3], [5.5, -2.3], [7.5, -2.3], [8.5, -3], [4, -4], [3.8, -5.2], [8.9, -5.2]] as Point2[],
  gameSeats: [[5, 0], [8, 0], [5, 1], [8, 1], [5, -1], [8, -1], [6, 1.5], [7, 1.5], [6, -1.5], [7, -1.5]] as Point2[],
};

/** Shared with the renderer. Clearance accounts for a character's body radius. */
export const NAVIGATION_CLEARANCE = .22;
export const OFFICE_OBSTACLES: Obstacle[] = [
  ...OFFICE_LAYOUT.desks.map(desk => ({ id: `desk-${desk.id}`, x: desk.position[0], z: desk.position[1], width: ['hermes','luna'].includes(desk.id)?2.4:1.65, depth: .8 })),
  { id: 'meeting-table', x: -1, z: -4.5, width: 3.6, depth: 1.2 },
  { id: 'hermes-wall', x: -5, z: -4.15, width: .15, depth: 3.7 },
  { id: 'meeting-wall', x: 2.5, z: -4.15, width: .15, depth: 3.7 },
  { id: 'reception-wall', x: -5, z: 4.75, width: .15, depth: 3.5 },
  { id: 'sofa', x: 6.65, z: -5.25, width: 3.8, depth: 1.15 },
  { id: 'lounge-table', x: 6.5, z: -2.7, width: 1, depth: 1 },
  { id: 'cafe-table', x: 6.6, z: 4.5, width: 1.3, depth: 1.3 },
  { id: 'reception-front', x: -7, z: 3.72, width: 2.65, depth: .19 },
  { id: 'fridge', x: 9.65, z: 2.85, width: .56, depth: 1 },
  { id: 'hermes-shelf', x: -9.2, z: -6.5, width: 1.1, depth: .45 },
  { id: 'lounge-shelf', x: 9.1, z: -6.5, width: 1.2, depth: .45 },
  { id: 'lounge-lamp', x: 4.25, z: -5.7, width: .56, depth: .56 },
  { id: 'coffee-counter', x: 8.8, z: 4, width: .8, depth: 3 },
  { id: 'foosball', x: 6.5, z: 0, width: 1.8, depth: 1 },
  ...[[-5.7,-6.15,1.15],[-9.25,-2.3,.95],[1.75,-6.25,.9],[3.3,-6.1,1.1],[9.2,-2.6,.8],[-4.2,1,.8],[-4.2,4.1,.8],[4.25,1,.8],[4.25,4.1,.8],[-9.2,5.7,1.1],[-5.7,3.3,.65],[9.15,6.2,.9],[-8.7,.4,.9]].map(([x,z,scale],index)=>({id:`plant-${index}`,x,z,width:.65*scale,depth:.65*scale})),
];

export function isWalkable(point: Point2): boolean {
  const [x, z] = point; const b = OFFICE_LAYOUT.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  return !OFFICE_OBSTACLES.some(o => Math.abs(x - o.x) < o.width / 2 + NAVIGATION_CLEARANCE && Math.abs(z - o.z) < o.depth / 2 + NAVIGATION_CLEARANCE);
}

function segmentCrosses(from: Point2, to: Point2, obstacle: Obstacle): boolean {
  let entry = 0; let exit = 1;
  const mins = [obstacle.x - obstacle.width / 2 - NAVIGATION_CLEARANCE, obstacle.z - obstacle.depth / 2 - NAVIGATION_CLEARANCE];
  const maxs = [obstacle.x + obstacle.width / 2 + NAVIGATION_CLEARANCE, obstacle.z + obstacle.depth / 2 + NAVIGATION_CLEARANCE];
  for (let axis = 0; axis < 2; axis++) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-8) { if (from[axis] <= mins[axis] || from[axis] >= maxs[axis]) return false; }
    else {
      const a = (mins[axis] - from[axis]) / delta; const b = (maxs[axis] - from[axis]) / delta;
      entry = Math.max(entry, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      if (entry >= exit) return false;
    }
  }
  return entry < exit && exit > 0 && entry < 1;
}

export function isSegmentWalkable(from: Point2, to: Point2): boolean {
  return isWalkable(from) && isWalkable(to) && !OFFICE_OBSTACLES.some(o => segmentCrosses(from, to, o));
}

const corners: Point2[] = OFFICE_OBSTACLES.flatMap(o => {
  const dx = o.width / 2 + NAVIGATION_CLEARANCE + .025; const dz = o.depth / 2 + NAVIGATION_CLEARANCE + .025;
  return [[o.x - dx, o.z - dz], [o.x + dx, o.z - dz], [o.x - dx, o.z + dz], [o.x + dx, o.z + dz]] as Point2[];
}).filter(isWalkable);
const distance = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Visibility-graph shortest path. No diagonal shortcuts through desks or walls. */
export function findPath(from: Point2, to: Point2): Point2[] {
  if (!isWalkable(from) || !isWalkable(to)) return [];
  if (isSegmentWalkable(from, to)) return [[...to]];
  const nodes = [from, to, ...corners]; const scores = nodes.map(() => Infinity);
  const previous = nodes.map(() => -1); const visited = new Set<number>(); scores[0] = 0;
  for (let step = 0; step < nodes.length; step++) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || scores[i] < scores[current])) current = i;
    if (current < 0 || !Number.isFinite(scores[current])) break;
    if (current === 1) {
      const path: Point2[] = []; let cursor = 1;
      while (cursor !== 0 && cursor >= 0) { path.unshift([...nodes[cursor]]); cursor = previous[cursor]; }
      return path;
    }
    visited.add(current);
    for (let next = 0; next < nodes.length; next++) {
      if (visited.has(next)) continue;
      const candidate = scores[current] + distance(nodes[current], nodes[next]);
      if (candidate < scores[next] && isSegmentWalkable(nodes[current], nodes[next])) { scores[next] = candidate; previous[next] = current; }
    }
  }
  return [];
}
