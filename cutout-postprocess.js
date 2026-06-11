(function () {
  const DEFAULTS = {
    transparentAlpha: 18,
    softAlpha: 34,
    solidAlpha: 190,
    minIslandAreaRatio: 0.0007,
    minIslandToMainRatio: 0.004,
  };

  function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function cleanAlphaCurve(data, options) {
    let cleared = 0;
    let refined = 0;
    const span = Math.max(1, options.solidAlpha - options.softAlpha);

    for (let offset = 3; offset < data.length; offset += 4) {
      const alpha = data[offset];
      if (alpha <= options.transparentAlpha) {
        if (alpha) cleared++;
        data[offset] = 0;
        continue;
      }
      if (alpha >= options.solidAlpha) {
        if (alpha !== 255) refined++;
        data[offset] = 255;
        continue;
      }

      const mapped = Math.round(255 * smoothstep((alpha - options.softAlpha) / span));
      if (mapped !== alpha) refined++;
      data[offset] = mapped <= options.transparentAlpha ? 0 : mapped;
    }
    return { cleared, refined };
  }

  function removeSmallAlphaIslands(data, width, height, options) {
    const total = width * height;
    const visited = new Uint8Array(total);
    const components = [];
    const queue = new Int32Array(total);
    const isVisible = (index) => data[index * 4 + 3] > options.transparentAlpha;

    for (let start = 0; start < total; start += 1) {
      if (visited[start] || !isVisible(start)) continue;
      let head = 0;
      let tail = 0;
      let alphaSum = 0;
      queue[tail++] = start;
      visited[start] = 1;
      const pixels = [];

      while (head < tail) {
        const index = queue[head++];
        pixels.push(index);
        alphaSum += data[index * 4 + 3];
        const x = index % width;
        const y = Math.floor(index / width);
        const neighbors = [];
        if (x > 0) neighbors.push(index - 1);
        if (x + 1 < width) neighbors.push(index + 1);
        if (y > 0) neighbors.push(index - width);
        if (y + 1 < height) neighbors.push(index + width);
        for (const neighbor of neighbors) {
          if (visited[neighbor] || !isVisible(neighbor)) continue;
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
      components.push({ pixels, weight: alphaSum / 255 });
    }

    if (components.length < 2) return 0;
    components.sort((a, b) => b.weight - a.weight);
    const mainWeight = components[0].weight;
    const minimumWeight = Math.max(
      total * options.minIslandAreaRatio,
      mainWeight * options.minIslandToMainRatio,
    );
    let removed = 0;

    for (let index = 1; index < components.length; index += 1) {
      const component = components[index];
      if (component.weight >= minimumWeight) continue;
      for (const pixel of component.pixels) {
        data[pixel * 4 + 3] = 0;
      }
      removed++;
    }
    return removed;
  }

  function cleanCutoutCanvas(canvas, customOptions = {}) {
    const options = { ...DEFAULTS, ...customOptions };
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const curve = cleanAlphaCurve(imageData.data, options);
    const removedIslands = removeSmallAlphaIslands(
      imageData.data,
      canvas.width,
      canvas.height,
      options,
    );
    context.putImageData(imageData, 0, 0);
    return { ...curve, removedIslands };
  }

  window.CutoutPostprocess = {
    clean: cleanCutoutCanvas,
  };
})();
