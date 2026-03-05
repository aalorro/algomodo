import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  const s = v * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

interface Agent {
  x: number; y: number;
  vx: number; vy: number;
  energy: number;
  age: number;
  type: 'prey' | 'predator';
}

// Module-level persistent state for animation
let _ecoState: {
  key: string;
  agents: Agent[];
  rng: SeededRNG;
  step: number;
} | null = null;

function initAgents(
  nPrey: number, nPred: number, preySpd: number, predSpd: number,
  w: number, h: number, rng: SeededRNG
): Agent[] {
  const agents: Agent[] = [];
  for (let i = 0; i < nPrey; i++) {
    agents.push({
      x: rng.random() * w, y: rng.random() * h,
      vx: rng.gaussian(0, preySpd), vy: rng.gaussian(0, preySpd),
      energy: 1.0, age: 0, type: 'prey',
    });
  }
  for (let i = 0; i < nPred; i++) {
    agents.push({
      x: rng.random() * w, y: rng.random() * h,
      vx: rng.gaussian(0, predSpd), vy: rng.gaussian(0, predSpd),
      energy: 0.8, age: 0, type: 'predator',
    });
  }
  return agents;
}

function simulateStep(
  agents: Agent[], w: number, h: number, rng: SeededRNG,
  preySpd: number, predSpd: number, flockR: number, huntR: number, reproRate: number
): void {
  const maxPop = 400;
  const prey = agents.filter((a: Agent) => a.type === 'prey');
  const preds = agents.filter((a: Agent) => a.type === 'predator');

  for (const agent of agents) {
    // Flocking: steer toward same-species neighbors
    const same = agent.type === 'prey' ? prey : preds;
    let flockX = 0, flockY = 0, flockN = 0;
    for (const other of same) {
      if (other === agent) continue;
      const dx = other.x - agent.x, dy = other.y - agent.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < flockR * flockR && d2 > 1) {
        flockX += dx; flockY += dy; flockN++;
      }
    }
    if (flockN > 0) {
      agent.vx += (flockX / flockN) * 0.01;
      agent.vy += (flockY / flockN) * 0.01;
    }

    if (agent.type === 'prey') {
      // Flee from nearest predator
      let nearPred: Agent | null = null, nearDist = huntR * huntR;
      for (const p of preds) {
        const d2 = (p.x - agent.x) ** 2 + (p.y - agent.y) ** 2;
        if (d2 < nearDist) { nearDist = d2; nearPred = p; }
      }
      if (nearPred) {
        const d = Math.sqrt(nearDist) || 1;
        agent.vx -= ((nearPred.x - agent.x) / d) * preySpd * 0.3;
        agent.vy -= ((nearPred.y - agent.y) / d) * preySpd * 0.3;
      }
    } else {
      // Pursue nearest prey
      let nearPrey: Agent | null = null, nearDist = huntR * huntR;
      for (const p of prey) {
        const d2 = (p.x - agent.x) ** 2 + (p.y - agent.y) ** 2;
        if (d2 < nearDist) { nearDist = d2; nearPrey = p; }
      }
      if (nearPrey) {
        const d = Math.sqrt(nearDist) || 1;
        agent.vx += ((nearPrey.x - agent.x) / d) * predSpd * 0.2;
        agent.vy += ((nearPrey.y - agent.y) / d) * predSpd * 0.2;
      }
    }

    // Wander
    agent.vx += rng.gaussian(0, 0.3);
    agent.vy += rng.gaussian(0, 0.3);

    // Speed limit
    const spd = agent.type === 'prey' ? preySpd : predSpd;
    const v = Math.sqrt(agent.vx ** 2 + agent.vy ** 2);
    if (v > spd * 2) {
      agent.vx = (agent.vx / v) * spd * 2;
      agent.vy = (agent.vy / v) * spd * 2;
    }

    // Move
    agent.x += agent.vx;
    agent.y += agent.vy;

    // Bounce
    if (agent.x < 0) { agent.x = 0; agent.vx = Math.abs(agent.vx); }
    if (agent.x > w) { agent.x = w; agent.vx = -Math.abs(agent.vx); }
    if (agent.y < 0) { agent.y = 0; agent.vy = Math.abs(agent.vy); }
    if (agent.y > h) { agent.y = h; agent.vy = -Math.abs(agent.vy); }

    agent.age++;
    agent.energy -= agent.type === 'predator' ? 0.003 : 0.002;
  }

  // Predation
  const catchDist = 12;
  for (const pred of preds) {
    if (pred.energy <= 0) continue;
    for (let i = agents.length - 1; i >= 0; i--) {
      const a = agents[i];
      if (a.type !== 'prey') continue;
      const d2 = (pred.x - a.x) ** 2 + (pred.y - a.y) ** 2;
      if (d2 < catchDist * catchDist) {
        pred.energy = Math.min(1, pred.energy + 0.4);
        agents.splice(i, 1);
        break;
      }
    }
  }

  // Death
  for (let i = agents.length - 1; i >= 0; i--) {
    if (agents[i].energy <= 0) agents.splice(i, 1);
  }

  // Reproduction
  if (agents.length < maxPop) {
    const newAgents: Agent[] = [];
    for (const a of agents) {
      if (a.energy > 0.7 && rng.random() < reproRate && agents.length + newAgents.length < maxPop) {
        newAgents.push({
          x: a.x + rng.gaussian(0, 5),
          y: a.y + rng.gaussian(0, 5),
          vx: rng.gaussian(0, 1), vy: rng.gaussian(0, 1),
          energy: a.energy * 0.5,
          age: 0, type: a.type,
        });
        a.energy *= 0.5;
      }
    }
    agents.push(...newAgents);
  }

  // Population floors
  const preyNow = agents.filter((a: Agent) => a.type === 'prey').length;
  const predNow = agents.filter((a: Agent) => a.type === 'predator').length;
  if (preyNow === 0) {
    for (let i = 0; i < 5; i++) {
      agents.push({
        x: rng.random() * w, y: rng.random() * h,
        vx: rng.gaussian(0, preySpd), vy: rng.gaussian(0, preySpd),
        energy: 1, age: 0, type: 'prey',
      });
    }
  }
  if (predNow === 0) {
    for (let i = 0; i < 3; i++) {
      agents.push({
        x: rng.random() * w, y: rng.random() * h,
        vx: rng.gaussian(0, predSpd), vy: rng.gaussian(0, predSpd),
        energy: 0.8, age: 0, type: 'predator',
      });
    }
  }
}

const parameterSchema: ParameterSchema = {
  initialPrey: {
    name: 'Initial Prey', type: 'number', min: 20, max: 300, step: 10, default: 120,
    group: 'Composition',
  },
  initialPredators: {
    name: 'Initial Predators', type: 'number', min: 5, max: 100, step: 5, default: 25,
    group: 'Composition',
  },
  preySpeed: {
    name: 'Prey Speed', type: 'number', min: 0.5, max: 5, step: 0.5, default: 2,
    group: 'Flow/Motion',
  },
  predatorSpeed: {
    name: 'Predator Speed', type: 'number', min: 0.5, max: 5, step: 0.5, default: 1.5,
    group: 'Flow/Motion',
  },
  flockRadius: {
    name: 'Flock Radius', type: 'number', min: 30, max: 200, step: 10, default: 80,
    help: 'Max distance for same-species graph connections', group: 'Geometry',
  },
  huntRadius: {
    name: 'Hunt Radius', type: 'number', min: 40, max: 250, step: 10, default: 120,
    help: 'Max distance for predator-prey connections', group: 'Geometry',
  },
  reproductionRate: {
    name: 'Reproduction Rate', type: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.005,
    group: 'Texture',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 2, max: 16, step: 1, default: 6,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 4, step: 0.5, default: 1,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['species', 'energy', 'age', 'connections'],
    default: 'species', group: 'Color',
  },
  showTrails: {
    name: 'Show Trails', type: 'boolean', default: true, group: 'Texture',
  },
  stepsPerFrame: {
    name: 'Steps / Frame', type: 'number', min: 1, max: 5, step: 1, default: 2,
    group: 'Flow/Motion',
  },
};

export const ecosystems: Generator = {
  id: 'graph-ecosystems',
  family: 'graphs',
  styleName: 'Ecosystems',
  definition: 'Agent-based predator/prey simulation visualized as a graph network',
  algorithmNotes:
    'Agents (prey and predators) move on the canvas with flocking, fleeing, and pursuit behaviors. ' +
    'Same-species agents within flock radius form graph bonds; predator-prey pairs within hunt radius ' +
    'form hunt connections. Agents consume energy, reproduce when well-fed, and die when depleted. ' +
    'Population floors prevent extinction. The result is an organic, shifting network graph.',
  parameterSchema,
  defaultParams: {
    initialPrey: 120, initialPredators: 25, preySpeed: 2, predatorSpeed: 1.5,
    flockRadius: 80, huntRadius: 120, reproductionRate: 0.005, nodeSize: 6,
    edgeWidth: 1, colorMode: 'species', showTrails: true, stepsPerFrame: 2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const colors = palette.colors.map(hexToRgb);

    const nPrey = params.initialPrey ?? 120;
    const nPred = params.initialPredators ?? 25;
    const preySpd = params.preySpeed ?? 2;
    const predSpd = params.predatorSpeed ?? 1.5;
    const flockR = params.flockRadius ?? 80;
    const huntR = params.huntRadius ?? 120;
    const reproRate = params.reproductionRate ?? 0.005;
    const nodeSize = params.nodeSize ?? 6;
    const edgeWidth = params.edgeWidth ?? 1;
    const colorMode = params.colorMode ?? 'species';
    const showTrails = params.showTrails ?? true;
    const stepsPerFrame = params.stepsPerFrame ?? 2;

    const key = `${seed}|${nPrey}|${nPred}|${w}|${h}|${params._renderKey ?? 0}`;

    // Initialize or re-initialize state
    if (!_ecoState || _ecoState.key !== key) {
      const rng = new SeededRNG(seed);
      _ecoState = {
        key,
        agents: initAgents(nPrey, nPred, preySpd, predSpd, w, h, rng),
        rng,
        step: 0,
      };
    }

    const { agents, rng } = _ecoState;

    // For static render: warm-up simulation
    if (time <= 0 && _ecoState.step === 0) {
      const warmup = quality === 'draft' ? 50 : 200;
      for (let i = 0; i < warmup; i++) {
        simulateStep(agents, w, h, rng, preySpd, predSpd, flockR, huntR, reproRate);
      }
      _ecoState.step = warmup;
    }

    // Simulate steps for animation
    if (time > 0) {
      for (let s = 0; s < stepsPerFrame; s++) {
        simulateStep(agents, w, h, rng, preySpd, predSpd, flockR, huntR, reproRate);
        _ecoState.step++;
      }
    }

    // Background
    if (showTrails && time > 0) {
      ctx.fillStyle = 'rgba(5,5,5,0.15)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);
    }

    // Compute connection counts for 'connections' color mode
    const connCounts = new Map<Agent, number>();
    if (colorMode === 'connections') {
      for (const a of agents) connCounts.set(a, 0);
    }

    // Draw edges (skip in draft for performance)
    if (quality !== 'draft') {
      const midColors = Math.floor(colors.length / 2);
      const preyColor = colors[0];
      const predColor = colors[Math.min(colors.length - 1, midColors)];

      ctx.lineWidth = edgeWidth;

      // Flock edges
      for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
          const a = agents[i], b = agents[j];
          if (a.type !== b.type) continue;
          const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (d2 > flockR * flockR) continue;

          if (colorMode === 'connections') {
            connCounts.set(a, (connCounts.get(a) ?? 0) + 1);
            connCounts.set(b, (connCounts.get(b) ?? 0) + 1);
          }

          const c = a.type === 'prey' ? preyColor : predColor;
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.15)`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Hunt edges
      const huntColor = colors[colors.length - 1];
      for (const pred of agents.filter((a: Agent) => a.type === 'predator')) {
        for (const prey of agents.filter((a: Agent) => a.type === 'prey')) {
          const d2 = (pred.x - prey.x) ** 2 + (pred.y - prey.y) ** 2;
          if (d2 > huntR * huntR) continue;

          ctx.strokeStyle = `rgba(${huntColor[0]},${huntColor[1]},${huntColor[2]},0.1)`;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(pred.x, pred.y);
          ctx.lineTo(prey.x, prey.y);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    // Draw nodes
    const midIdx = Math.floor(colors.length / 2);
    for (const agent of agents) {
      let r: number, g: number, b: number;
      let alpha = 0.9;

      if (colorMode === 'energy') {
        [r, g, b] = paletteSample(agent.energy, colors);
      } else if (colorMode === 'age') {
        [r, g, b] = paletteSample(Math.min(1, agent.age / 500), colors);
      } else if (colorMode === 'connections') {
        const conn = connCounts.get(agent) ?? 0;
        [r, g, b] = paletteSample(Math.min(1, conn / 10), colors);
      } else {
        // species
        if (agent.type === 'prey') {
          [r, g, b] = colors[0];
        } else {
          [r, g, b] = colors[Math.min(midIdx, colors.length - 1)];
        }
      }

      const radius = nodeSize * (0.7 + agent.energy * 0.3);
      ctx.beginPath();
      ctx.arc(agent.x, agent.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fill();

      // Glow for predators
      if (agent.type === 'predator') {
        ctx.beginPath();
        ctx.arc(agent.x, agent.y, radius * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.1)`;
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = (params.initialPrey ?? 120) + (params.initialPredators ?? 25);
    return Math.round(n * n * (params.stepsPerFrame ?? 2) * 0.02);
  },
};
