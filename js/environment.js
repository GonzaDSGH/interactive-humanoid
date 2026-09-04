// Independent atmospheric particle field: background ambience + a sparse
// foreground depth layer. This system never touches the anatomy rotation -
// it drifts on its own and only gently parallaxes with the pointer, giving
// the whole page a sense of a living environment without ever suggesting
// the figure itself is turning.

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function buildLayer(count, opts) {
  const basePos = new Float32Array(count * 3);
  const amp = new Float32Array(count * 3);
  const attribs = new Float32Array(count * 4); // size, alpha, seed, isForeground

  for (let i = 0; i < count; i++) {
    basePos[i * 3] = rand(opts.xRange[0], opts.xRange[1]);
    basePos[i * 3 + 1] = rand(opts.yRange[0], opts.yRange[1]);
    basePos[i * 3 + 2] = rand(opts.zRange[0], opts.zRange[1]);

    amp[i * 3] = rand(opts.ampRange[0], opts.ampRange[1]);
    amp[i * 3 + 1] = rand(opts.ampRange[0], opts.ampRange[1]);
    amp[i * 3 + 2] = rand(opts.ampRange[0], opts.ampRange[1]);

    attribs[i * 4] = rand(opts.sizeRange[0], opts.sizeRange[1]);
    attribs[i * 4 + 1] = rand(opts.alphaRange[0], opts.alphaRange[1]);
    attribs[i * 4 + 2] = Math.random();
    attribs[i * 4 + 3] = opts.isForeground ? 1 : 0;
  }

  return { basePos, amp, attribs, count };
}

export function buildFieldParticles(backgroundCount, foregroundCount) {
  const background = buildLayer(backgroundCount, {
    xRange: [-11, 11],
    yRange: [-8, 7],
    zRange: [-14, -1.5],
    ampRange: [0.15, 0.55],
    sizeRange: [0.8, 2.2],
    alphaRange: [0.08, 0.3],
    isForeground: false,
  });

  const foreground = buildLayer(foregroundCount, {
    xRange: [-6, 6],
    yRange: [-4, 4],
    zRange: [3, 7],
    ampRange: [0.2, 0.6],
    sizeRange: [2.5, 5.5],
    alphaRange: [0.1, 0.28],
    isForeground: true,
  });

  const count = background.count + foreground.count;
  const basePos = new Float32Array(count * 3);
  const amp = new Float32Array(count * 3);
  const attribs = new Float32Array(count * 4);

  basePos.set(background.basePos, 0);
  basePos.set(foreground.basePos, background.count * 3);
  amp.set(background.amp, 0);
  amp.set(foreground.amp, background.count * 3);
  attribs.set(background.attribs, 0);
  attribs.set(foreground.attribs, background.count * 4);

  return { count, basePos, amp, attribs };
}
