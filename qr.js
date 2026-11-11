'use strict';
// Minimal QR code generator for short links (byte mode, error correction level M, versions 1–10).
// Written for Guitar Mate; follows the QR Code specification (ISO/IEC 18004).
// gmQr.matrix(text) → array of rows of booleans (true = dark); gmQr.svg(text) → SVG markup.
(function (root) {
  const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]; // level M, by version
  const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const MAX_VERSION = 10;

  function rawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const align = Math.floor(ver / 7) + 2;
      result -= (25 * align - 10) * align - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  const totalCodewords = ver => Math.floor(rawDataModules(ver) / 8);
  const dataCodewords = ver => totalCodewords(ver) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    const count = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  // GF(256) with polynomial 0x11D.
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
  }

  function encodeData(bytes, ver) {
    const bits = [];
    const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    const capacity = dataCodewords(ver) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) push(pad, 8);
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    return codewords;
  }

  function addEcc(data, ver) {
    const blocks = BLOCKS[ver], ecc = ECC_PER_BLOCK[ver], raw = totalCodewords(ver);
    const shortBlocks = blocks - raw % blocks, shortLen = Math.floor(raw / blocks);
    const divisor = rsDivisor(ecc);
    const all = [];
    for (let i = 0, k = 0; i < blocks; i++) {
      const take = shortLen - ecc + (i < shortBlocks ? 0 : 1);
      const chunk = data.slice(k, k + take);
      k += take;
      const block = chunk.concat(rsRemainder(chunk, divisor));
      if (i < shortBlocks) block.splice(shortLen - ecc, 0, null); // keeps columns aligned
      all.push(block);
    }
    const result = [];
    for (let i = 0; i < all[0].length; i++) all.forEach(block => { if (block[i] !== null && block[i] !== undefined) result.push(block[i]); });
    return result;
  }

  function build(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let ver = 1;
    while (ver <= MAX_VERSION && dataCodewords(ver) < bytes.length + (ver <= 9 ? 2 : 3)) ver++;
    if (ver > MAX_VERSION) throw new Error('Text too long for QR');
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

    // Timing patterns
    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    // Finder patterns with separators
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    // Alignment patterns
    const pos = alignmentPositions(ver), n = pos.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // Reserve format areas (drawn for real after masking) and version info
    const drawFormat = mask => {
      const data = (0b00 << 3) | mask; // level M = 00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = i => ((bits >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
      setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
        setFn(a, b, dark); setFn(b, a, dark);
      }
    }

    // Data in the zigzag order
    const codewords = addEcc(encodeData(bytes, ver), ver);
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }

    const masks = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
    ];
    const applyMask = m => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y][x] && masks[m](x, y)) modules[y][x] = !modules[y][x];
    };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const score = penalty(modules);
      if (score < bestScore) { best = m; bestScore = score; }
      applyMask(m); // undo (XOR)
    }
    applyMask(best); drawFormat(best);
    return modules;
  }

  // Standard penalty score used to pick the most readable mask.
  function penalty(m) {
    const size = m.length;
    let score = 0;
    const lines = [];
    for (let y = 0; y < size; y++) lines.push(m[y]);
    for (let x = 0; x < size; x++) lines.push(m.map(row => row[x]));
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      const s = line.map(v => (v ? 1 : 0)).join('');
      for (const p of ['10111010000', '00001011101']) for (let k = s.indexOf(p); k !== -1; k = s.indexOf(p, k + 1)) score += 40;
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    const dark = m.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return score;
  }

  function svg(text, { border = 4 } = {}) {
    const modules = build(text), size = modules.length + border * 2;
    let path = '';
    modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + border},${y + border}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  root.gmQr = { matrix: build, svg };
})(typeof window !== 'undefined' ? window : globalThis);
