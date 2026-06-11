(function () {
  "use strict";

  const PRECISION_LEVELS = {
    1: { columns: 3, rows: 2 },
    2: { columns: 3, rows: 3 },
    3: { columns: 4, rows: 3 },
    4: { columns: 5, rows: 4 },
    5: { columns: 6, rows: 5 },
    6: { columns: 7, rows: 5 },
    7: { columns: 7, rows: 6 },
    8: { columns: 8, rows: 6 },
    9: { columns: 9, rows: 7 },
    10: { columns: 10, rows: 8 },
  };

  const SIZE_RATIO_RANGE = {
    min: 0.1,
    max: 0.85,
  };

  const SIZE_SEARCH_LEVELS = {
    1: { coarseCount: 4, refineCount: 2, finalistCount: 1 },
    2: { coarseCount: 4, refineCount: 3, finalistCount: 2 },
    3: { coarseCount: 5, refineCount: 4, finalistCount: 2 },
    4: { coarseCount: 5, refineCount: 5, finalistCount: 2 },
    5: { coarseCount: 5, refineCount: 6, finalistCount: 3 },
    6: { coarseCount: 6, refineCount: 7, finalistCount: 3 },
    7: { coarseCount: 6, refineCount: 8, finalistCount: 3 },
    8: { coarseCount: 6, refineCount: 9, finalistCount: 4 },
    9: { coarseCount: 7, refineCount: 10, finalistCount: 4 },
    10: { coarseCount: 7, refineCount: 11, finalistCount: 5 },
  };

  const TONE_SEARCH_LEVELS = {
    1: [-12, -6, 0, 6, 12],
    2: [-24, -12, 0, 12, 24],
    3: [-36, -18, 0, 18, 36],
    4: [-50, -25, 0, 25, 50],
    5: [-70, -35, 0, 35, 70],
  };

  const OPACITY_SEARCH_LEVELS = {
    1: [1, 0.98, 0.96],
    2: [1, 0.96, 0.92],
    3: [1, 0.95, 0.9, 0.85],
    4: [1, 0.92, 0.84, 0.76],
    5: [1, 0.9, 0.8, 0.7, 0.6],
  };

  const MODELARTS_BATCH_SIZE = 100;

  const EDGE_SCHEMES = [
    { id: "original", label: "保持原样", widthRatio: 0, edgeAlpha: 1 },
    { id: "hard", label: "窄硬边", widthRatio: 0.008, edgeAlpha: 0.82 },
    { id: "very-light", label: "极轻羽化", widthRatio: 0.012, edgeAlpha: 0.62 },
    { id: "light", label: "轻羽化", widthRatio: 0.018, edgeAlpha: 0.45 },
    { id: "balanced", label: "平衡羽化", widthRatio: 0.026, edgeAlpha: 0.3 },
    { id: "soft", label: "柔和羽化", widthRatio: 0.036, edgeAlpha: 0.18 },
    { id: "deep", label: "深度羽化", widthRatio: 0.05, edgeAlpha: 0.08 },
    { id: "solid", label: "边缘强化", widthRatio: 0.018, edgeAlpha: 1, strengthen: true },
  ];

  function clampLevel(value, max = 10, fallback = 3) {
    return Math.max(1, Math.min(max, Math.round(Number(value) || fallback)));
  }

  function evenlySpaced(min, max, count) {
    if (count <= 1) return [(min + max) / 2];
    return Array.from(
      { length: count },
      (_, index) => min + ((max - min) * index) / (count - 1),
    );
  }

  function buildCoarseSizeRatios(sizeLevel) {
    const config = SIZE_SEARCH_LEVELS[clampLevel(sizeLevel)];
    return evenlySpaced(SIZE_RATIO_RANGE.min, SIZE_RATIO_RANGE.max, config.coarseCount);
  }

  function dimensionsFromShortEdgeRatio({
    ratio,
    foreground,
    outputWidth,
    outputHeight,
  }) {
    const foregroundLongEdge = Math.max(foreground.width, foreground.height);
    const targetLongEdge = Math.max(16, Math.min(outputWidth, outputHeight) * ratio);
    const scale = targetLongEdge / foregroundLongEdge;
    const desiredWidth = foreground.width * scale;
    const desiredHeight = foreground.height * scale;
    const fitScale = Math.min(
      1,
      outputWidth / desiredWidth,
      outputHeight / desiredHeight,
    );
    return {
      width: desiredWidth * fitScale,
      height: desiredHeight * fitScale,
    };
  }

  function placementAroundCandidate(candidate, width, height, outputWidth, outputHeight) {
    const centerX = candidate.placement.x + candidate.placement.w / 2;
    const baseY = candidate.placement.y + candidate.placement.h;
    return {
      x: Math.max(0, Math.min(outputWidth - width, centerX - width / 2)),
      y: Math.max(0, Math.min(outputHeight - height, baseY - height)),
      w: width,
      h: height,
    };
  }

  function canvasToBlob(canvas, type = "image/jpeg", quality = 0.86) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("候选合成图生成失败"));
        }
      }, type, quality);
    });
  }

  function healthUrlFromEndpoint(endpoint) {
    const url = new URL(endpoint, window.location.href);
    url.pathname = "/health";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async function checkBackend(endpoint, timeoutMs = 6000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const healthUrl = healthUrlFromEndpoint(endpoint);

    try {
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`OPA 健康检查返回 HTTP ${response.status}`);
      }
      if (data.status !== "ok") {
        throw new Error(`OPA 服务已启动，但模型状态为 ${data.status || "未知"}`);
      }
      if (endpoint.includes("/api/modelarts/") && !data.modelarts?.configured) {
        throw new Error("ModelArts APP_CODE 未配置，请在后端 .env 中设置 MODELARTS_APP_CODE");
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`OPA 服务连接超时：${healthUrl}`);
      }
      if (error instanceof TypeError) {
        throw new Error(
          `无法连接 OPA 服务 ${healthUrl}。请确认后端已启动，并检查浏览器跨域或网络限制`,
        );
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function buildPositions(width, height, foregroundWidth, foregroundHeight, precisionLevel) {
    const { columns, rows } = PRECISION_LEVELS[clampLevel(precisionLevel)];
    const maxX = Math.max(0, width - foregroundWidth);
    const maxY = Math.max(0, height - foregroundHeight);
    const positions = [];

    for (let row = 0; row < rows; row += 1) {
      const yRatio = rows === 1 ? 0.5 : row / (rows - 1);
      for (let column = 0; column < columns; column += 1) {
        const xRatio = columns === 1 ? 0.5 : column / (columns - 1);
        positions.push({
          x: maxX * xRatio,
          y: maxY * yRatio,
        });
      }
    }

    return positions;
  }

  function createCandidateCanvas({
    background,
    foreground,
    outputWidth,
    outputHeight,
    placement,
    previewScale,
  }) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(outputWidth * previewScale));
    canvas.height = Math.max(1, Math.round(outputHeight * previewScale));
    const context = canvas.getContext("2d");

    context.drawImage(background, 0, 0, canvas.width, canvas.height);
    context.drawImage(
      foreground,
      placement.x * previewScale,
      placement.y * previewScale,
      placement.w * previewScale,
      placement.h * previewScale,
    );
    return canvas;
  }

  function createCandidateMaskCanvas({
    foreground,
    outputWidth,
    outputHeight,
    placement,
    previewScale,
  }) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(outputWidth * previewScale));
    canvas.height = Math.max(1, Math.round(outputHeight * previewScale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const source = document.createElement("canvas");
    source.width = foreground.width;
    source.height = foreground.height;
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    sourceContext.drawImage(foreground, 0, 0);
    const imageData = sourceContext.getImageData(0, 0, source.width, source.height);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const alpha = imageData.data[index + 3];
      const value = alpha >= 24 ? 255 : 0;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
    sourceContext.putImageData(imageData, 0, 0);
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      source,
      placement.x * previewScale,
      placement.y * previewScale,
      placement.w * previewScale,
      placement.h * previewScale,
    );
    return canvas;
  }

  function createTonedForeground(foreground, tone) {
    if (!tone) return foreground;
    const canvas = document.createElement("canvas");
    canvas.width = foreground.width;
    canvas.height = foreground.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(foreground, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    const amount = Math.abs(tone) / 100;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 0) continue;
      if (tone > 0) {
        data[index] = Math.min(255, Math.round(data[index] + 34 * amount));
        data[index + 1] = Math.min(255, Math.round(data[index + 1] + 12 * amount));
        data[index + 2] = Math.max(0, Math.round(data[index + 2] - 22 * amount));
      } else {
        data[index] = Math.max(0, Math.round(data[index] - 18 * amount));
        data[index + 1] = Math.min(255, Math.round(data[index + 1] + 8 * amount));
        data[index + 2] = Math.min(255, Math.round(data[index + 2] + 38 * amount));
      }
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  function createOpacityForeground(foreground, opacity) {
    if (opacity >= 1) return cloneCanvas(foreground);
    const canvas = cloneCanvas(foreground);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < imageData.data.length; index += 4) {
      imageData.data[index] = Math.round(imageData.data[index] * opacity);
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  function cloneCanvas(source) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d").drawImage(source, 0, 0);
    return canvas;
  }

  function createEdgeVariant(foreground, scheme) {
    if (scheme.id === "original") return cloneCanvas(foreground);

    const canvas = cloneCanvas(foreground);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    const width = canvas.width;
    const height = canvas.height;
    const pixelCount = width * height;
    const maxDistance = Math.max(
      1,
      Math.min(32, Math.round(Math.min(width, height) * scheme.widthRatio)),
    );
    const distance = new Int16Array(pixelCount);
    distance.fill(-1);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;
    const isVisible = (index) => data[index * 4 + 3] > 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!isVisible(index)) continue;
        const touchesTransparent =
          x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          !isVisible(index - 1) ||
          !isVisible(index + 1) ||
          !isVisible(index - width) ||
          !isVisible(index + width);
        if (touchesTransparent) {
          distance[index] = 0;
          queue[tail++] = index;
        }
      }
    }

    while (head < tail) {
      const index = queue[head++];
      const currentDistance = distance[index];
      if (currentDistance >= maxDistance) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);
      for (const neighbor of neighbors) {
        if (!isVisible(neighbor) || distance[neighbor] !== -1) continue;
        distance[neighbor] = currentDistance + 1;
        queue[tail++] = neighbor;
      }
    }

    for (let index = 0; index < pixelCount; index += 1) {
      const alphaIndex = index * 4 + 3;
      const originalAlpha = data[alphaIndex];
      if (!originalAlpha || distance[index] < 0 || distance[index] > maxDistance) continue;
      const normalized = distance[index] / maxDistance;
      const smooth = normalized * normalized * (3 - 2 * normalized);
      if (scheme.strengthen) {
        const minimumAlpha = 255 * (0.58 + 0.42 * smooth);
        data[alphaIndex] = Math.min(255, Math.max(originalAlpha, Math.round(minimumAlpha)));
      } else {
        const factor = scheme.edgeAlpha + (1 - scheme.edgeAlpha) * smooth;
        data[alphaIndex] = Math.round(originalAlpha * factor);
      }
    }

    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  async function predictCandidates({
    candidates,
    endpoint,
    timeoutMs,
    onProgress,
    stage = "placement",
    requiresMasks = false,
  }) {
    const preparedCandidates = [];
    for (let index = 0; index < candidates.length; index += 1) {
      onProgress?.({
        phase: "render",
        stage,
        completed: index + 1,
        total: candidates.length,
      });
      const blob = await canvasToBlob(candidates[index].canvas);
      let maskBlob = null;
      if (requiresMasks) {
        const mask = candidates[index].mask;
        if (!mask) throw new Error("云端评分候选缺少对应掩码");
        maskBlob = await canvasToBlob(mask, "image/jpeg", 0.95);
      }
      preparedCandidates.push({ index, blob, maskBlob });
    }

    const batchSize = requiresMasks ? MODELARTS_BATCH_SIZE : preparedCandidates.length;
    const batches = [];
    for (let start = 0; start < preparedCandidates.length; start += batchSize) {
      batches.push(preparedCandidates.slice(start, start + batchSize));
    }
    const allScores = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const formData = new FormData();
      for (const candidate of batch) {
        formData.append(
          "images",
          candidate.blob,
          `placement-${String(candidate.index).padStart(4, "0")}.jpg`,
        );
        if (requiresMasks) {
          formData.append(
            "masks",
            candidate.maskBlob,
            `mask-${String(candidate.index).padStart(4, "0")}.jpg`,
          );
        }
      }

      onProgress?.({
        phase: "predict",
        stage,
        completed: allScores.length,
        total: candidates.length,
        batch: batchIndex + 1,
        batchCount: batches.length,
        batchSize: batch.length,
      });

      const maxAttempts = requiresMasks ? 3 : 1;
      let lastError;
      let batchScores = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            body: formData,
            signal: controller.signal,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.code !== 0 || !Array.isArray(data.scores)) {
            throw new Error(
              data.detail ||
                data.message ||
                `OPA 评分接口返回 HTTP ${response.status}`,
            );
          }
          if (data.scores.length !== batch.length) {
            throw new Error(
              `第 ${batchIndex + 1} 批返回 ${data.scores.length} 个评分，预期 ${batch.length} 个`,
            );
          }
          batchScores = data.scores;
          break;
        } catch (error) {
          if (error.name === "AbortError") {
            lastError = new Error(`OPA 评分请求超时，当前批次为 ${batch.length} 个候选`);
          } else if (error instanceof TypeError) {
            lastError = new Error(
              `浏览器无法访问 OPA 评分接口 ${endpoint}。请检查后端、CORS 和网页协议`,
            );
          } else {
            lastError = error;
          }
        } finally {
          window.clearTimeout(timeout);
        }

        if (attempt < maxAttempts) {
          onProgress?.({
            phase: "retry",
            stage,
            attempt: attempt + 1,
            maxAttempts,
            completed: allScores.length,
            total: candidates.length,
            batch: batchIndex + 1,
            batchCount: batches.length,
            message: lastError?.message || "云端评分暂时失败",
          });
          await new Promise((resolve) => window.setTimeout(resolve, 1200 * attempt));
        }
      }

      if (!batchScores) {
        throw new Error(
          `第 ${batchIndex + 1}/${batches.length} 批连续 ${maxAttempts} 次评分失败，连接可能已断开：${lastError?.message || "未知错误"}`,
        );
      }
      allScores.push(...batchScores);
      onProgress?.({
        phase: "batch-done",
        stage,
        completed: allScores.length,
        total: candidates.length,
        batch: batchIndex + 1,
        batchCount: batches.length,
      });
    }

    return allScores;
  }

  async function search(options) {
    const {
      background,
      foreground,
      outputWidth,
      outputHeight,
      precisionLevel = 3,
      sizeLevel = 3,
      toneLevel = 3,
      opacityLevel = 3,
      requiresMasks = false,
      endpoint = "http://127.0.0.1:8000/api/predict",
      timeoutMs = 300000,
      onProgress,
    } = options;

    if (!background || !foreground || !outputWidth || !outputHeight) {
      throw new Error("OPA 搜索缺少背景图、前景图或画布尺寸");
    }

    onProgress?.({ phase: "health", completed: 0, total: 0 });
    await checkBackend(endpoint);

    const previewScale = Math.min(1, 448 / outputWidth, 448 / outputHeight);
    const normalizedSizeLevel = clampLevel(sizeLevel);
    const sizeConfig = SIZE_SEARCH_LEVELS[normalizedSizeLevel];
    const coarseSizeRatios = buildCoarseSizeRatios(normalizedSizeLevel);
    const candidates = [];
    const usedSizes = new Set();

    for (const sizeRatio of coarseSizeRatios) {
      const dimensions = dimensionsFromShortEdgeRatio({
        ratio: sizeRatio,
        foreground,
        outputWidth,
        outputHeight,
      });
      const foregroundWidth = dimensions.width;
      const foregroundHeight = dimensions.height;
      const sizeKey = `${Math.round(foregroundWidth)}x${Math.round(foregroundHeight)}`;
      if (usedSizes.has(sizeKey)) continue;
      usedSizes.add(sizeKey);

      const positions = buildPositions(
        outputWidth,
        outputHeight,
        foregroundWidth,
        foregroundHeight,
        precisionLevel,
      );
      for (const position of positions) {
        const placement = {
          x: position.x,
          y: position.y,
          w: foregroundWidth,
          h: foregroundHeight,
        };
        candidates.push({
          placement,
          sizeRatio,
          canvas: createCandidateCanvas({
            background,
            foreground,
            outputWidth,
            outputHeight,
            placement,
            previewScale,
          }),
          mask: requiresMasks
            ? createCandidateMaskCanvas({
                foreground,
                outputWidth,
                outputHeight,
                placement,
                previewScale,
              })
            : null,
        });
      }
    }

    const scores = await predictCandidates({
      candidates,
      endpoint,
      timeoutMs,
      onProgress,
      stage: "placement",
      requiresMasks,
    });
    if (scores.length !== candidates.length) {
      throw new Error("OPA 返回的评分数量与候选图数量不一致");
    }

    const rankedCoarseCandidates = candidates
      .map(({ canvas, mask, ...candidate }, index) => ({
        ...candidate,
        score: Number(scores[index]),
      }))
      .sort((a, b) => b.score - a.score);
    for (const candidate of candidates) candidate.canvas = null;
    const coarseStep =
      (SIZE_RATIO_RANGE.max - SIZE_RATIO_RANGE.min) /
      Math.max(1, coarseSizeRatios.length - 1);
    const refineAnchors = [];
    const anchorSizeKeys = new Set();
    for (const candidate of rankedCoarseCandidates) {
      const key = candidate.sizeRatio.toFixed(5);
      if (anchorSizeKeys.has(key)) continue;
      anchorSizeKeys.add(key);
      refineAnchors.push(candidate);
      if (refineAnchors.length >= sizeConfig.finalistCount) break;
    }

    const refineCandidates = [];
    const refinePlacementKeys = new Set();
    for (const anchor of refineAnchors) {
      const minimum = Math.max(SIZE_RATIO_RANGE.min, anchor.sizeRatio - coarseStep);
      const maximum = Math.min(SIZE_RATIO_RANGE.max, anchor.sizeRatio + coarseStep);
      const refinedRatios = evenlySpaced(minimum, maximum, sizeConfig.refineCount + 2)
        .slice(1, -1);
      for (const sizeRatio of refinedRatios) {
        const dimensions = dimensionsFromShortEdgeRatio({
          ratio: sizeRatio,
          foreground,
          outputWidth,
          outputHeight,
        });
        const placement = placementAroundCandidate(
          anchor,
          dimensions.width,
          dimensions.height,
          outputWidth,
          outputHeight,
        );
        const sizeKey = `${Math.round(dimensions.width)}x${Math.round(dimensions.height)}`;
        usedSizes.add(sizeKey);
        const placementKey =
          `${Math.round(placement.x)}:${Math.round(placement.y)}:${sizeKey}`;
        if (refinePlacementKeys.has(placementKey)) continue;
        refinePlacementKeys.add(placementKey);
        refineCandidates.push({
          placement,
          sizeRatio,
          canvas: createCandidateCanvas({
            background,
            foreground,
            outputWidth,
            outputHeight,
            placement,
            previewScale,
          }),
          mask: requiresMasks
            ? createCandidateMaskCanvas({
                foreground,
                outputWidth,
                outputHeight,
                placement,
                previewScale,
              })
            : null,
        });
      }
    }

    let rankedRefineCandidates = [];
    if (refineCandidates.length) {
      const refineScores = await predictCandidates({
        candidates: refineCandidates,
        endpoint,
        timeoutMs,
        onProgress,
        stage: "size-refine",
        requiresMasks,
      });
      if (refineScores.length !== refineCandidates.length) {
        throw new Error("OPA 返回的大小复评数量与候选图数量不一致");
      }
      rankedRefineCandidates = refineCandidates
        .map(({ canvas, mask, ...candidate }, index) => ({
          ...candidate,
          score: Number(refineScores[index]),
        }))
        .sort((a, b) => b.score - a.score);
      for (const candidate of refineCandidates) candidate.canvas = null;
    }

    const rankedCandidates = [...rankedCoarseCandidates, ...rankedRefineCandidates]
      .sort((a, b) => b.score - a.score);
    const finalists = rankedCandidates.slice(0, Math.min(8, rankedCandidates.length));
    const toneValues = TONE_SEARCH_LEVELS[clampLevel(toneLevel, 5, 3)];
    const tonedForegrounds = new Map(
      toneValues.map((tone) => [tone, createTonedForeground(foreground, tone)]),
    );
    const toneCandidates = [];

    for (const finalist of finalists) {
      for (const tone of toneValues) {
        const tonedForeground = tonedForegrounds.get(tone);
        toneCandidates.push({
          placement: finalist.placement,
          sizeRatio: finalist.sizeRatio,
          tone,
          foreground: tonedForeground,
          canvas: createCandidateCanvas({
            background,
            foreground: tonedForeground,
            outputWidth,
            outputHeight,
            placement: finalist.placement,
            previewScale,
          }),
          mask: requiresMasks
            ? createCandidateMaskCanvas({
                foreground: tonedForeground,
                outputWidth,
                outputHeight,
                placement: finalist.placement,
                previewScale,
              })
            : null,
        });
      }
    }

    const toneScores = await predictCandidates({
      candidates: toneCandidates,
      endpoint,
      timeoutMs,
      onProgress,
      stage: "tone",
      requiresMasks,
    });
    if (toneScores.length !== toneCandidates.length) {
      throw new Error("OPA 返回的色调评分数量与候选图数量不一致");
    }
    const rankedToneCandidates = toneCandidates
      .map(({ canvas, mask, ...candidate }, index) => ({
        ...candidate,
        score: Number(toneScores[index]),
      }))
      .sort((a, b) => b.score - a.score);
    for (const candidate of toneCandidates) candidate.canvas = null;

    const opacityValues = OPACITY_SEARCH_LEVELS[clampLevel(opacityLevel, 5, 3)];
    const opacityFinalists = rankedToneCandidates.slice(
      0,
      Math.min(4, rankedToneCandidates.length),
    );
    const opacityCandidates = [];
    for (const finalist of opacityFinalists) {
      for (const opacity of opacityValues) {
        const opacityForeground = createOpacityForeground(finalist.foreground, opacity);
        opacityCandidates.push({
          placement: finalist.placement,
          sizeRatio: finalist.sizeRatio,
          tone: finalist.tone,
          opacity,
          foreground: opacityForeground,
          canvas: createCandidateCanvas({
            background,
            foreground: opacityForeground,
            outputWidth,
            outputHeight,
            placement: finalist.placement,
            previewScale,
          }),
          mask: requiresMasks
            ? createCandidateMaskCanvas({
                foreground: opacityForeground,
                outputWidth,
                outputHeight,
                placement: finalist.placement,
                previewScale,
              })
            : null,
        });
      }
    }

    const opacityScores = await predictCandidates({
      candidates: opacityCandidates,
      endpoint,
      timeoutMs,
      onProgress,
      stage: "opacity",
      requiresMasks,
    });
    if (opacityScores.length !== opacityCandidates.length) {
      throw new Error("OPA 返回的透明度评分数量与候选图数量不一致");
    }
    let bestIndex = 0;
    for (let index = 1; index < opacityScores.length; index += 1) {
      if (Number(opacityScores[index]) > Number(opacityScores[bestIndex])) bestIndex = index;
    }
    const bestCandidate = opacityCandidates[bestIndex];

    onProgress?.({
      phase: "done",
      stage: "opacity",
      completed:
        candidates.length +
        refineCandidates.length +
        toneCandidates.length +
        opacityCandidates.length,
      total:
        candidates.length +
        refineCandidates.length +
        toneCandidates.length +
        opacityCandidates.length,
    });

    return {
      ...bestCandidate.placement,
      foreground: bestCandidate.foreground,
      tone: bestCandidate.tone,
      opacity: bestCandidate.opacity,
      score: Number(opacityScores[bestIndex]),
      candidateCount:
        candidates.length +
        refineCandidates.length +
        toneCandidates.length +
        opacityCandidates.length,
      placementCandidateCount: candidates.length + refineCandidates.length,
      coarseCandidateCount: candidates.length,
      refinedCandidateCount: refineCandidates.length,
      toneCandidateCount: toneCandidates.length,
      opacityCandidateCount: opacityCandidates.length,
      searchedSizeCount: usedSizes.size,
      selectedSizeRatio: bestCandidate.sizeRatio,
      precisionLevel: clampLevel(precisionLevel),
      sizeLevel: normalizedSizeLevel,
      toneLevel: clampLevel(toneLevel, 5, 3),
      opacityLevel: clampLevel(opacityLevel, 5, 3),
    };
  }

  async function optimizeEdges(options) {
    const {
      background,
      foreground,
      placement,
      outputWidth,
      outputHeight,
      endpoint = "http://127.0.0.1:8000/api/predict",
      timeoutMs = 300000,
      onProgress,
      requiresMasks = false,
    } = options;

    if (!background || !foreground || !placement || !outputWidth || !outputHeight) {
      throw new Error("边缘优化缺少合成图或前景位置数据");
    }

    onProgress?.({ phase: "health", stage: "edge", completed: 0, total: 0 });
    await checkBackend(endpoint);
    const previewScale = Math.min(1, 448 / outputWidth, 448 / outputHeight);
    const candidates = EDGE_SCHEMES.map((scheme) => {
      const edgeForeground = createEdgeVariant(foreground, scheme);
      return {
        scheme,
        foreground: edgeForeground,
        canvas: createCandidateCanvas({
          background,
          foreground: edgeForeground,
          outputWidth,
          outputHeight,
          placement,
          previewScale,
        }),
        mask: requiresMasks
          ? createCandidateMaskCanvas({
              foreground: edgeForeground,
              outputWidth,
              outputHeight,
              placement,
              previewScale,
            })
          : null,
      };
    });
    const scores = await predictCandidates({
      candidates,
      endpoint,
      timeoutMs,
      onProgress,
      stage: "edge",
      requiresMasks,
    });
    let bestIndex = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if (Number(scores[index]) > Number(scores[bestIndex])) bestIndex = index;
    }
    const best = candidates[bestIndex];
    onProgress?.({
      phase: "done",
      stage: "edge",
      completed: candidates.length,
      total: candidates.length,
    });
    return {
      foreground: best.foreground,
      scheme: best.scheme.id,
      schemeLabel: best.scheme.label,
      score: Number(scores[bestIndex]),
      candidateCount: candidates.length,
    };
  }

  window.OPAPlacement = {
    search,
    optimizeEdges,
    checkBackend,
    precisionLevels: PRECISION_LEVELS,
    sizeRatioRange: SIZE_RATIO_RANGE,
    sizeSearchLevels: SIZE_SEARCH_LEVELS,
    toneSearchLevels: TONE_SEARCH_LEVELS,
    opacitySearchLevels: OPACITY_SEARCH_LEVELS,
    edgeSchemes: EDGE_SCHEMES,
  };
})();
