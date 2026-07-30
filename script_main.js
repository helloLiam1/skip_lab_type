// ── SKIP LABS brand word animation ─────────────────────────────
// Cycles through anagram variations of "SKIP LABS" every second,
// picked randomly but never repeating the same word twice in a row.

const BRAND_WORDS = [
  "SLIK PAB",
  "PLIB KAS",
  "BASK LIP",
  "BLIP KAS",
  "SPIK LAB",
  "KLIP BAS",
  "PLAK BIS",
  "LIPS BAK",
  "SILK BAP",
  "BALK SIP",
  "BAPS LIK",
  "SILP BAK",
  "BLAK SIP",
  "PALS BIK",
  "SPAL BIK",
  "KABS LIP"
];

function initBrandWordCycle(elementId, words, intervalMs = 1000) {
  const el = document.getElementById(elementId);
  if (!el) return;

  let lastIndex = -1;

  function pickNextIndex() {
    if (words.length <= 1) return 0;
    let next;
    do {
      next = Math.floor(Math.random() * words.length);
    } while (next === lastIndex);
    return next;
  }

  function tick() {
    const nextIndex = pickNextIndex();
    lastIndex = nextIndex;
    el.textContent = words[nextIndex];
  }

  tick(); // set initial word immediately
  setInterval(tick, intervalMs);
}

document.addEventListener("DOMContentLoaded", () => {
  initBrandWordCycle("brandWord", BRAND_WORDS, 1000);

  // Hide edit controls for presentation
  const editWraps = document.querySelectorAll('.edit-wrap');
  editWraps.forEach(wrap => {
    wrap.style.display = 'none';
  });
});

// ── Preview canvas: line → dots → letter shapes ────────────────
// Model: one continuous line — a fixed anchor at the left edge,
// N movable points (N varies per letter), a fixed anchor at the
// right edge. With no text, there are zero movable points, so the
// polyline is just the two fixed anchors: a perfectly straight
// line. Typing a known letter's first character builds that
// letter's dots on the baseline, fades them in fast, then
// animates them into their final positions.
//
// NOTE: point coordinates below are estimated by eye from the
// design reference screenshots — treat as a first pass. Flag any
// point that's off and it can be adjusted directly (each point is
// listed in order, so "point 4 of B" etc. is enough to identify it).

const VIEW_W = 872;
const VIEW_H = 626;
const BASE_Y = 313; // vertical center of the canvas
let anim_time = 1000;
const CONTENT_MARGIN = 40;
let SPACE_WIDTH = 180;
const LETTER_GAP = 0;
const LETTER_PADDING = {
  't': { left: 15, right: 15 },
  'T': { left: 15, right: 15 }
};
let userFontSizeScale = 1.0;
let LINE_SPACING = 500;

const DEFAULT_LETTER_SHAPES = JSON.parse(JSON.stringify(LETTER_SHAPES));
const BASE_MIN_X = {};
Object.keys(DEFAULT_LETTER_SHAPES).forEach(key => {
  const pts = DEFAULT_LETTER_SHAPES[key];
  if (pts && pts.length > 0) {
    BASE_MIN_X[key] = Math.min(...pts.map(p => p.x));
  }
});

let letters = [];          // [{ key, points: [{x,y}...] (absolute canvas coords), opacity }]
let previewContainer = null;
let activeAnim = null;
let currentWordScale = 1;  // Tracks current layout scale factor for dynamic stroke/dot sizing
let userStrokeWeightScale = 1; // User controlled line thickness
let MAX_LINE_THICKNESS = 20; // Global max for line thickness slider
let userDotSizeScale = 1; // User controlled circle size
let MAX_CIRCLE_SIZE = 20; // Global max for circle size slider

function getScaledDotDiameter() {
  const canvasRatio = width ? (width / VIEW_W) : 1;
  return 10.504 * currentWordScale * canvasRatio * userDotSizeScale;
}

function getScaledStrokeWeight() {
  const canvasRatio = width ? (width / VIEW_W) : 1;
  return Math.max(0.15, 0.6283 * currentWordScale * canvasRatio * userStrokeWeightScale);
}

// ── Multiply / style controls ───────────────────────────────────
// Only "wave" is implemented for now — selecting sharp/dots/emoji
// just tracks the selection in the UI, no visual effect yet.
let selectedStyle = null; // null | 'wave' | 'sharp' | 'dots' | 'emoji'
let multiplyValue = 1;    // 1 = plain single line, no visible effect

function initMultiplyControls() {
  const slider = document.getElementById("multiplySlider");
  if (slider) {
    slider.addEventListener("input", () => {
      multiplyValue = parseInt(slider.value, 10);
    });
  }

  const styleButtons = document.querySelectorAll(".style-btn");
  styleButtons.forEach(btn => {
    const closeIcon = btn.querySelector(".close-icon");

    closeIcon.addEventListener("click", e => {
      e.stopPropagation();
      selectedStyle = null;
      updateStyleButtonUI(styleButtons);
    });

    btn.addEventListener("click", () => {
      const styleName = btn.dataset.style;
      if (selectedStyle === styleName) return; // already selected — only the close icon removes it
      selectedStyle = styleName;
      updateStyleButtonUI(styleButtons);
    });
  });
}

function updateStyleButtonUI(styleButtons) {
  styleButtons.forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.style === selectedStyle);
  });
}

// ── Emoji style images ───────────────────────────────────────────
const EMOJI_IMAGE_COUNT = 21;
let emojiImages = [];

function preload() {
  for (let i = 1; i <= EMOJI_IMAGE_COUNT; i++) {
    emojiImages.push(loadImage(`images/emoji-${i}.png`));
  }
}

function setup() {

  const lineSlider = document.getElementById("lineThicknessSlider");
  if (lineSlider) {
    lineSlider.max = MAX_LINE_THICKNESS;
    lineSlider.addEventListener("input", (e) => {
      userStrokeWeightScale = parseFloat(e.target.value);
    });
  }

  const circleSlider = document.getElementById("circleSizeSlider");
  if (circleSlider) {
    circleSlider.max = MAX_CIRCLE_SIZE;
    circleSlider.addEventListener("input", (e) => {
      userDotSizeScale = parseFloat(e.target.value);
    });
  }

  previewContainer = document.getElementById("previewArea");
  const cnv = createCanvas(previewContainer.clientWidth, previewContainer.clientHeight);
  cnv.parent(previewContainer);

  initMultiplyControls();

  const input = document.getElementById("wordsInput");
  if (input) {
    input.addEventListener("input", () => {
      const linesOfKeys = getLinesOfKeysFromInput(input.value);
      handleRebuildAnimated(linesOfKeys);
    });
  }

  const fontSlider = document.getElementById("fontSizeSlider");
  if (fontSlider) {
    fontSlider.addEventListener("input", (e) => {
      userFontSizeScale = parseFloat(e.target.value);
      const val = input ? input.value : "";
      const linesOfKeys = getLinesOfKeysFromInput(val);
      handleRebuildAnimated(linesOfKeys);
    });
  }
}

function windowResized() {
  resizeCanvas(previewContainer.clientWidth, previewContainer.clientHeight);
}

function getScaleRatio() {
  return Math.min(width / VIEW_W, height / VIEW_H);
}
function getOffsetX() {
  return (width - VIEW_W * getScaleRatio()) / 2;
}
function getOffsetY() {
  return (height - VIEW_H * getScaleRatio()) / 2;
}

function mapX(x) {
  return getOffsetX() + x * getScaleRatio();
}
function mapY(y) {
  return getOffsetY() + y * getScaleRatio();
}
function unmapX(screenX) {
  return (screenX - getOffsetX()) / getScaleRatio();
}
function unmapY(screenY) {
  return (screenY - getOffsetY()) / getScaleRatio();
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Only characters with a defined shape count toward the word;
// everything else (spaces, digits, unsupported letters) is skipped.
function getLinesOfKeysFromInput(value) {
  let doubleQuoteCount = 0;
  return value.split("\n").map(line => {
    const keys = [];
    for (const ch of line) {
      if (ch === " ") {
        keys.push(" ");
      } else if (ch === '"') {
        const smartQuoteKey = (doubleQuoteCount % 2 === 0) ? "“" : "”";
        doubleQuoteCount++;
        if (LETTER_SHAPES[smartQuoteKey]) {
          keys.push(smartQuoteKey);
        } else if (LETTER_SHAPES['"']) {
          keys.push('"');
        }
      } else if (LETTER_SHAPES[ch]) {
        keys.push(ch);
      }
    }
    return keys;
  });
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function computeLayout(linesOfWordKeys) {
  const lineMetas = linesOfWordKeys.map(wordKeys => {
    return wordKeys.map((key, keyIdx) => {
      if (key === " ") {
        return { key: " ", isSpace: true, width: SPACE_WIDTH, pts: [] };
      }

      let base_pts = LETTER_SHAPES[key] ? JSON.parse(JSON.stringify(LETTER_SHAPES[key])) : [];
      let pts_prev = base_pts;
      let pts_next = base_pts;

      // Check for entry connection from the previous letter pair
      if (keyIdx > 0 && wordKeys[keyIdx - 1] !== " ") {
        const prevKey = wordKeys[keyIdx - 1];
        const pairKey = prevKey + "-" + key;
        if (PAIR_SHAPES[pairKey] && PAIR_SHAPES[pairKey].secondLetterPts) {
          pts_prev = JSON.parse(JSON.stringify(PAIR_SHAPES[pairKey].secondLetterPts));
        }
      }

      // Check for exit connection to the next letter pair
      if (keyIdx < wordKeys.length - 1 && wordKeys[keyIdx + 1] !== " ") {
        const nextKey = wordKeys[keyIdx + 1];
        const pairKey = key + "-" + nextKey;
        if (PAIR_SHAPES[pairKey] && PAIR_SHAPES[pairKey].firstLetterPts) {
          pts_next = JSON.parse(JSON.stringify(PAIR_SHAPES[pairKey].firstLetterPts));
        }
      }

      let primary_pts = base_pts;
      if (pts_next !== base_pts) {
        primary_pts = pts_next;
      }

      let pts = primary_pts;
      // Merge entry (left) and exit (right) connection variable nodes while keeping constant nodes (the body) fixed
      if (pts_prev !== base_pts || pts_next !== base_pts) {
        const N = primary_pts.length;

        const mapPoints = (targetPts) => {
          if (targetPts === primary_pts || targetPts.length === N) return Array.from({ length: N }, (_, i) => i);

          const M = targetPts.length;
          const dp = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(Infinity));
          const path = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(null));

          dp[0][0] = 0;

          for (let i = 1; i <= N; i++) {
            for (let j = 1; j <= M; j++) {
              const dist = Math.hypot(primary_pts[i - 1].x - targetPts[j - 1].x, primary_pts[i - 1].y - targetPts[j - 1].y);

              const costDiag = dp[i - 1][j - 1] + dist;
              const costSkipTarget = dp[i - 1][j] + dist * 0.5;
              const costSkipBase = dp[i][j - 1] + dist * 0.5;

              if (costDiag <= costSkipTarget && costDiag <= costSkipBase) {
                dp[i][j] = costDiag;
                path[i][j] = 'diag';
              } else if (costSkipTarget <= costSkipBase) {
                dp[i][j] = costSkipTarget;
                path[i][j] = 'skip_target';
              } else {
                dp[i][j] = costSkipBase;
                path[i][j] = 'skip_base';
              }
            }
          }

          const mapping = new Array(N);
          let i = N, j = M;
          while (i > 0 && j > 0) {
            mapping[i - 1] = j - 1;
            const step = path[i][j];
            if (step === 'diag') {
              i--;
              j--;
            } else if (step === 'skip_target') {
              i--;
            } else {
              j--;
            }
          }
          while (i > 0) {
            mapping[i - 1] = 0;
            i--;
          }
          return mapping;
        };

        const map_prev = mapPoints(pts_prev);
        const map_next = mapPoints(pts_next);

        // Identify constant nodes range in primary_pts
        const constIndices = [];
        for (let i = 0; i < N; i++) {
          if (primary_pts[i].isConstant) constIndices.push(i);
        }
        const firstConstIdx = constIndices.length > 0 ? constIndices[0] : -1;
        const lastConstIdx = constIndices.length > 0 ? constIndices[constIndices.length - 1] : -1;

        // Find vertical shift of pts_prev and pts_next constant nodes relative to primary_pts to prevent misalignment warping
        let prevShiftY = 0;
        let prevConstCount = 0;
        if (pts_prev !== primary_pts) {
          for (let i = 0; i < N; i++) {
            if (primary_pts[i].isConstant && pts_prev[i]) {
              prevShiftY += (pts_prev[i].y - primary_pts[i].y);
              prevConstCount++;
            }
          }
          if (prevConstCount > 0) {
            prevShiftY /= prevConstCount;
          }
        }

        let nextShiftY = 0;
        let nextConstCount = 0;
        if (pts_next !== primary_pts) {
          for (let i = 0; i < N; i++) {
            if (primary_pts[i].isConstant && pts_next[i]) {
              nextShiftY += (pts_next[i].y - primary_pts[i].y);
              nextConstCount++;
            }
          }
          if (nextConstCount > 0) {
            nextShiftY /= nextConstCount;
          }
        }

        pts = [];
        for (let i = 0; i < N; i++) {
          if (primary_pts[i].isConstant) {
            // Constant nodes form the letter body and use the exact pair shape
            pts.push(JSON.parse(JSON.stringify(primary_pts[i])));
          } else {
            // Variable nodes: determine whether node is left (entry) or right (exit) relative to body
            let isLeft = false;
            let isRight = false;
            if (firstConstIdx !== -1) {
              if (i < firstConstIdx) {
                isLeft = true;
              } else if (i > lastConstIdx) {
                isRight = true;
              } else {
                if ((i - firstConstIdx) <= (lastConstIdx - i)) {
                  isLeft = true;
                } else {
                  isRight = true;
                }
              }
            } else {
              if (i < N / 2) {
                isLeft = true;
              } else {
                isRight = true;
              }
            }

            if (isLeft && pts_prev !== base_pts && pts_prev !== primary_pts) {
              const p_prev = pts_prev[map_prev[i]];
              pts.push({
                x: Number(p_prev.x.toFixed(5)),
                y: Number(p_prev.y.toFixed(5)),
                hideCircle: p_prev.hideCircle || primary_pts[i].hideCircle,
                disconnect: p_prev.disconnect || primary_pts[i].disconnect
              });
            } else if (isRight && pts_next !== base_pts && pts_next !== primary_pts) {
              const p_next = pts_next[map_next[i]];
              pts.push({
                x: Number(p_next.x.toFixed(5)),
                y: Number(p_next.y.toFixed(5)),
                hideCircle: p_next.hideCircle || primary_pts[i].hideCircle,
                disconnect: p_next.disconnect || primary_pts[i].disconnect
              });
            } else {
              pts.push(JSON.parse(JSON.stringify(primary_pts[i])));
            }
          }
        }
      }

      if (!pts) pts = [];
      const baseMinX = BASE_MIN_X[key] !== undefined ? BASE_MIN_X[key] : (base_pts.length > 0 ? Math.min(...base_pts.map(p => p.x)) : 0);
      const baseMaxX = base_pts.length > 0 ? Math.max(...base_pts.map(p => p.x)) : 10;
      return { key, isSpace: false, pts, baseMinX, minX: baseMinX, maxX: baseMaxX, width: Math.max(10, baseMaxX - baseMinX) };
    });
  });

  const lineNativeWidths = lineMetas.map(metas => {
    if (metas.length === 0) return 0;
    let currentX = 0;
    metas.forEach((m, i) => {
      m.yShift = 0;
      if (m.isSpace) {
        m.nativeX = currentX;
        currentX += m.width + LETTER_GAP;
      } else {
        const leftPad = LETTER_PADDING[m.key]?.left || 0;
        const rightPad = LETTER_PADDING[m.key]?.right || 0;

        let stepFromPrev = 0;
        if (i > 0 && !metas[i - 1].isSpace) {
          const prevKey = metas[i - 1].key;
          const pairKey = prevKey + "-" + m.key;

          if (PAIR_SHAPES[pairKey]) {
            if (PAIR_SHAPES[pairKey].offset !== undefined) {
              stepFromPrev = PAIR_SHAPES[pairKey].offset;
            } else if (PAIR_SHAPES[pairKey].secondLetterPts) {
              const basePts = LETTER_SHAPES[m.key];
              const pairPts = PAIR_SHAPES[pairKey].secondLetterPts;
              if (basePts && pairPts) {
                const cIdx = basePts.findIndex(p => p.isConstant);
                if (cIdx !== -1 && pairPts[cIdx]) {
                  const shiftX = pairPts[cIdx].x - basePts[cIdx].x;
                  const defaultPrevWidth = metas[i - 1].width + (LETTER_PADDING[metas[i - 1].key]?.right || 0) + LETTER_GAP + leftPad;
                  stepFromPrev = defaultPrevWidth + shiftX;
                }
              }
            }
          }
        }

        if (stepFromPrev !== 0) {
          m.nativeX = metas[i - 1].nativeX + stepFromPrev;
        } else {
          currentX += leftPad;
          m.nativeX = currentX;
        }
        currentX = m.nativeX + m.width + rightPad + LETTER_GAP;
      }
    });
    return Math.max(0, currentX - LETTER_GAP);
  });

  const maxNativeLineWidth = Math.max(0, ...lineNativeWidths);
  const availableWidth = VIEW_W - 2 * CONTENT_MARGIN;
  const availableHeight = VIEW_H - 2 * CONTENT_MARGIN;

  const widthScale = maxNativeLineWidth > 0 ? availableWidth / maxNativeLineWidth : 1;
  const lineCount = linesOfWordKeys.length;
  const nativeTotalHeight = (lineCount - 1) * LINE_SPACING + 320;
  const heightScale = availableHeight / nativeTotalHeight;

  const baseScale = Math.min(1, widthScale, heightScale);
  currentWordScale = baseScale * userFontSizeScale;

  const scaledLineSpacing = LINE_SPACING * currentWordScale;
  const totalHeight = (lineCount - 1) * scaledLineSpacing;
  const topLineBaseY = (VIEW_H / 2) - (totalHeight / 2);

  const allLetterLayouts = [];

  lineMetas.forEach((metas, lineIndex) => {
    const lineBaseY = topLineBaseY + lineIndex * scaledLineSpacing;
    const scaledTotalWidth = lineNativeWidths[lineIndex] * currentWordScale;
    let lineStartX = (VIEW_W - scaledTotalWidth) / 2;

    metas.forEach(m => {
      if (m.isSpace) {
        allLetterLayouts.push({ key: " ", isSpace: true, lineIndex, lineBaseY, points: [] });
      } else {
        const startCursorX = lineStartX + m.nativeX * currentWordScale;
        const yShift = m.yShift || 0;
        const targetPoints = m.pts.map(p => ({
          x: startCursorX + (p.x - m.baseMinX) * currentWordScale,
          y: lineBaseY + (p.y + yShift - BASE_Y) * currentWordScale,
          hideCircle: !!p.hideCircle,
          disconnect: !!p.disconnect,
          isConstant: !!p.isConstant
        }));

        if (allLetterLayouts.length > 0) {
          const prevLayout = allLetterLayouts[allLetterLayouts.length - 1];
          if (!prevLayout.isSpace && prevLayout.lineIndex === lineIndex) {
            const prevKey = prevLayout.key;
            const currKey = m.key;
            const pairKey = prevKey + "-" + currKey;

            // Only perform proximity snapping if pair is NOT explicitly defined in PAIR_SHAPES
            if (!PAIR_SHAPES[pairKey]) {
              const prevIsConnectable = (prevLayout.key >= 'a' && prevLayout.key <= 'z') || (prevLayout.key >= 'A' && prevLayout.key <= 'Z') || (prevLayout.key >= '0' && prevLayout.key <= '9');
              const currIsConnectable = (m.key >= 'a' && m.key <= 'z') || (m.key >= 'A' && m.key <= 'Z') || (m.key >= '0' && m.key <= '9');
              if (prevIsConnectable && currIsConnectable && prevLayout.points.length > 0 && targetPoints.length > 0) {
                const CLOSE_THRESHOLD = 18 * currentWordScale;
                for (let p1 of prevLayout.points) {
                  for (let p2 of targetPoints) {
                    if (dist(p1.x, p1.y, p2.x, p2.y) <= CLOSE_THRESHOLD) {
                      const mx = (p1.x + p2.x) / 2;
                      const my = (p1.y + p2.y) / 2;
                      p1.x = mx;
                      p1.y = my;
                      p2.x = mx;
                      p2.y = my;
                    }
                  }
                }
              } else if ((m.key === '.' || m.key === ',') && prevLayout.points.length > 0 && targetPoints.length > 0) {
                // For fullstop and comma, pull the previous letter's exit node to overlap the dot's entry node
                let exitScreenPt = null;
                for (let pi = prevLayout.points.length - 1; pi >= 0; pi--) {
                  if (!prevLayout.points[pi].isConstant) {
                    exitScreenPt = prevLayout.points[pi];
                    break;
                  }
                }
                let entryScreenPt = null;
                for (let pi = 0; pi < targetPoints.length; pi++) {
                  if (!targetPoints[pi].isConstant) {
                    entryScreenPt = targetPoints[pi];
                    break;
                  }
                }
                if (exitScreenPt && entryScreenPt) {
                  exitScreenPt.x = entryScreenPt.x;
                  exitScreenPt.y = entryScreenPt.y;
                }
              }
            } else {
              // For explicitly defined pairs, restore the overlap that was defined in pair-editing mode.
              //
              // Root cause of the bug: when a letter is in the MIDDLE of a word (has both a prev and
              // next pair), the layout engine computes prevShiftY to reconcile constant nodes between
              // the two pair shapes. This shift gets baked into the letter's native entry points,
              // causing the entry screen dot to drift away from the previous letter's exit dot.
              //
              // Fix: find the last non-constant screen point of prevLayout (exit node of letter 1)
              // and the first non-constant screen point of targetPoints (entry node of letter 2).
              // If they're within a generous threshold (prevShiftY can make them drift but not hugely),
              // force the entry node to exactly match the exit node — restoring the overlap.
              {
                let exitScreenPt = null;
                for (let pi = prevLayout.points.length - 1; pi >= 0; pi--) {
                  if (!prevLayout.points[pi].isConstant) {
                    exitScreenPt = prevLayout.points[pi];
                    break;
                  }
                }
                let entryScreenPt = null;
                for (let pi = 0; pi < targetPoints.length; pi++) {
                  if (!targetPoints[pi].isConstant) {
                    entryScreenPt = targetPoints[pi];
                    break;
                  }
                }
                // Use a generous threshold: prevShiftY can cause drift but never places them
                // far from each other (they were overlapping in pair mode, only shifted by prevShiftY)
                const PAIR_SNAP_THRESHOLD = 60 * currentWordScale;
                if (exitScreenPt && entryScreenPt) {
                  const d = Math.hypot(exitScreenPt.x - entryScreenPt.x, exitScreenPt.y - entryScreenPt.y);
                  if (d <= PAIR_SNAP_THRESHOLD) {
                    // Force entry to exactly match exit — restoring pair-mode overlap
                    entryScreenPt.x = exitScreenPt.x;
                    entryScreenPt.y = exitScreenPt.y;
                  }
                }
              }
            }
          }
        }

        allLetterLayouts.push({
          key: m.key,
          isSpace: false,
          lineIndex,
          lineBaseY,
          points: targetPoints,
          cursorX: startCursorX,
          baseMinX: m.baseMinX,
          minX: m.minX,
          scale: currentWordScale,
          yShift: yShift
        });
      }
    });
  });

  return allLetterLayouts;
}

function baselineSlotsForLetter(points, startX, lineBaseY = BASE_Y) {
  if (!points || points.length === 0) return [];
  const count = points.length;
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const letterWidth = Math.max(10, maxX - minX);
  const targetY = lineBaseY !== undefined ? lineBaseY : BASE_Y;
  if (count === 1) return [{ x: startX + letterWidth / 2, y: targetY }];
  const step = letterWidth / (count - 1);
  return Array.from({ length: count }, (_, i) => ({ x: startX + step * i, y: targetY }));
}

function startPositionAnim(entries, duration, onDone, delay = 0) {
  activeAnim = {
    kind: "position",
    startTime: millis(),
    duration,
    delay,
    entries: entries.map(e => ({
      letterIndex: e.letterIndex,
      startPoints: letters[e.letterIndex].points.map(p => ({ ...p })),
      targetPoints: e.targetPoints.map(p => ({ ...p }))
    })),
    onDone
  };
}

function startOpacityAnim(letterIndex, targetOpacity, duration, onDone) {
  activeAnim = {
    kind: "opacity",
    startTime: millis(),
    duration,
    delay: 0,
    letterIndex,
    startVal: letters[letterIndex].opacity,
    targetVal: targetOpacity,
    onDone
  };
}

function updateAnim() {
  if (!activeAnim) return;
  const elapsed = millis() - activeAnim.startTime;
  const delay = activeAnim.delay || 0;

  if (elapsed < delay) {
    return; // Wait for the delay to pass
  }

  const activeElapsed = elapsed - delay;
  const t = Math.min(1, activeElapsed / activeAnim.duration);
  const e = easeOutCubic(t);

  if (activeAnim.kind === "position") {
    for (const entry of activeAnim.entries) {
      letters[entry.letterIndex].points = entry.startPoints.map((p, i) => ({
        x: p.x + (entry.targetPoints[i].x - p.x) * e,
        y: p.y + (entry.targetPoints[i].y - p.y) * e
      }));
    }
  } else {
    letters[activeAnim.letterIndex].opacity =
      activeAnim.startVal + (activeAnim.targetVal - activeAnim.startVal) * e;
  }

  if (t >= 1) {
    const done = activeAnim.onDone;
    activeAnim = null;
    if (done) done();
  }
}

function handleRebuildAnimated(linesOfKeys) {
  const newLayout = computeLayout(linesOfKeys);
  const animEntries = [];
  const newLetters = [];

  for (let i = 0; i < newLayout.length; i++) {
    const item = newLayout[i];
    const oldLetter = letters[i];

    if (item.isSpace) {
      newLetters.push({
        key: item.key,
        isSpace: true,
        lineIndex: item.lineIndex,
        lineBaseY: item.lineBaseY,
        points: [],
        opacity: 1
      });
      continue;
    }

    let startPoints;

    // Reuse old letter if same key for smooth transition
    if (oldLetter && oldLetter.key === item.key && !oldLetter.isSpace && oldLetter.points.length === item.points.length) {
      startPoints = oldLetter.points.map(p => ({ ...p }));
    } else {
      // New letter, start from baseline
      let prevMaxX = 0;
      if (i > 0) {
        const prevL = newLetters[i - 1];
        if (prevL.points.length > 0) {
          prevMaxX = Math.max(...prevL.points.map(p => p.x));
        } else {
          prevMaxX = prevL.cursorX || 0;
        }
      }

      let startX = item.cursorX;
      if (startX < prevMaxX + 5) {
        startX = prevMaxX + 5;
      }

      const slots = baselineSlotsForLetter(item.points, startX, item.lineBaseY);
      startPoints = item.points.map((p, pIdx) => ({
        x: slots[pIdx].x,
        y: slots[pIdx].y,
        hideCircle: !!p.hideCircle,
        disconnect: !!p.disconnect,
        isConstant: !!p.isConstant
      }));
    }

    newLetters.push({
      key: item.key,
      isSpace: false,
      lineIndex: item.lineIndex,
      lineBaseY: item.lineBaseY,
      cursorX: item.cursorX,
      minX: item.minX,
      baseMinX: item.baseMinX,
      scale: item.scale,
      yShift: item.yShift,
      points: startPoints,
      opacity: 1
    });

    animEntries.push({
      letterIndex: i,
      targetPoints: item.points.map(p => ({ ...p }))
    });
  }

  letters = newLetters;

  if (animEntries.length > 0) {
    // 150ms pause before starting the movement
    startPositionAnim(animEntries, anim_time, null, 150);
  } else {
    activeAnim = null;
  }
}

// Draws one edge between two (already screen-mapped) points. A
// plain single line unless a multiply style is active — wave and
// sharp only kick in once the slider is above 1, but dots replaces
// the line entirely the moment it's selected (getting thicker as
// the slider rises).
function drawEdge(sx1, sy1, sx2, sy2, allowMultiply, edgeIndex = 0) {
  if (allowMultiply && selectedStyle === "dots") {
    drawDotsEdge(sx1, sy1, sx2, sy2, multiplyValue);
    return;
  }

  if (allowMultiply && selectedStyle === "emoji") {
    drawEmojiEdge(sx1, sy1, sx2, sy2, multiplyValue, edgeIndex);
    return;
  }

  const count = allowMultiply && (selectedStyle === "wave" || selectedStyle === "sharp") ? multiplyValue : 1;

  if (count <= 1) {
    stroke(0);
    strokeWeight(getScaledStrokeWeight());
    noFill();
    line(sx1, sy1, sx2, sy2);
    return;
  }

  if (selectedStyle === "wave") {
    drawWaveEdge(sx1, sy1, sx2, sy2, count);
  } else if (selectedStyle === "sharp") {
    drawSharpEdge(sx1, sy1, sx2, sy2, count);
  }
}

// Wavy, sketchy lines that all still meet exactly at both endpoints
// (the "vesica" look from the wave icon), each with its own gentle
// oscillation and hand-drawn wobble rather than a single clean
// geometric arc.
function drawWaveEdge(sx1, sy1, sx2, sy2, count) {
  const dx = sx2 - sx1;
  const dy = sy2 - sy1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len;
  const perpY = dx / len;

  const bulgeStep = 4;      // spacing between each line's main bulge (kept small so 50 lines still fits)
  const waveCycles = 3;     // extra up/down oscillations along each line, for a real "wave" look
  const waveAmp = 7;        // size of that oscillation
  const jitterAmp = 5;      // hand-sketched wobble, not a clean curve
  const segments = 32;      // sample points per line, for smoothness

  for (let i = 0; i < count; i++) {
    const centered = i - (count - 1) / 2;
    const baseAmp = centered * bulgeStep;
    const phase = noise(i * 3.7) * Math.PI * 2; // distinct phase per line so they don't all wave in sync

    noFill();
    beginShape();
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const px = sx1 + dx * t;
      const py = sy1 + dy * t;

      // envelope that's exactly 0 at both ends, so every line still
      // meets the two dots precisely, no matter what rides on top of it
      const envelope = Math.sin(t * Math.PI);

      const bulge = baseAmp * envelope;
      const wave = waveAmp * Math.sin(t * Math.PI * waveCycles + phase) * envelope;
      const jitter = (noise(i * 12.3, t * 6.1) - 0.5) * jitterAmp * envelope;

      const offset = bulge + wave + jitter;
      vertex(px + perpX * offset, py + perpY * offset);
    }
    endShape();
  }
}

// Angular zigzag lines, clearly distinct from the wave style: few
// vertices (sharp corners, not a curve) and randomness applied
// BOTH perpendicular to the line AND along its own direction — that
// second part is what makes it disperse in the x-axis like a
// lightning bolt, instead of just wobbling above/below a straight
// path like the wave style does.
function drawSharpEdge(sx1, sy1, sx2, sy2, count) {
  const dx = sx2 - sx1;
  const dy = sy2 - sy1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len; // unit vector along the line
  const uy = dy / len;
  const perpX = -uy;   // unit vector perpendicular to the line
  const perpY = ux;

  const segments = 12;        // more vertices -> more corners between the two dots
  const bulgeStep = 4;        // overall fan-out spacing between lines
  const perpJitter = 22;      // corner jaggedness across the line
  const tangentJitter = 34;   // dispersion along the line's own axis (the requested x-axis spread)

  for (let i = 0; i < count; i++) {
    const centered = i - (count - 1) / 2;
    const baseAmp = centered * bulgeStep;
    const seed = i * 23.7; // distinct randomness per line

    noFill();
    beginShape();
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;

      // envelope that's exactly 0 at both ends, so every zigzag
      // still meets the two dots precisely
      const envelope = Math.sin(t * Math.PI);

      const perpRand = (noise(seed + s * 1.7) - 0.5) * 2 * perpJitter * envelope;
      const tangentRand = (noise(seed + 50 + s * 2.3) - 0.5) * 2 * tangentJitter * envelope;

      const baseX = sx1 + dx * t;
      const baseY = sy1 + dy * t;
      const totalPerp = baseAmp * envelope + perpRand;

      const px = baseX + perpX * totalPerp + ux * tangentRand;
      const py = baseY + perpY * totalPerp + uy * tangentRand;

      vertex(px, py);
    }
    endShape();
  }
}

// Dots style: replaces the line entirely with a scattered cloud of
// small dots. No dot is ever smaller than the original letter-anchor
// dots (12px), and about 60% of them get randomly scaled up an
// extra 30-50% on top of that. Density scales up enough with the
// multiply slider that even wide scatter doesn't leave visible gaps.
function drawDotsEdge(sx1, sy1, sx2, sy2, multiplier) {
  const dx = sx2 - sx1;
  const dy = sy2 - sy1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len; // unit vector along the path
  const uy = dy / len;
  const perpX = -uy;   // unit vector perpendicular to the path
  const perpY = ux;

  const numDots = Math.max(10, Math.round(10 + multiplier * 4)); // dense enough to avoid gaps as scatter widens
  const scatterAmp = (1 + (multiplier - 1) * 2.5) * currentWordScale; // spreads well away from the stroke at high multiplier
  const baseDotSize = getScaledDotDiameter(); // matches the original letter-anchor dots scaled proportionally

  noStroke();
  fill(0);
  for (let s = 1; s < numDots; s++) {
    const t = s / numDots;
    const baseX = sx1 + dx * t;
    const baseY = sy1 + dy * t;

    // random scatter both across the path and along it — deterministic
    // per dot (via noise) so it doesn't flicker frame to frame
    const perpRand = (noise(s * 3.1, multiplier * 0.37) - 0.5) * 2 * scatterAmp;
    const tangentRand = (noise(s * 5.3 + 100, multiplier * 0.29) - 0.5) * scatterAmp;

    const px = baseX + perpX * perpRand + ux * tangentRand;
    const py = baseY + perpY * perpRand + uy * tangentRand;

    // ~60% of dots get a random 30-50% size boost on top of the base;
    // the rest stay exactly at the base (never smaller than it)
    const bucketRoll = noise(s * 17.7 + 900, multiplier * 0.11);
    let size = baseDotSize;
    if (bucketRoll < 0.6) {
      const boost = 1.3 + noise(s * 23.3 + 700, multiplier * 0.19) * 0.2; // 1.3-1.5x
      size = baseDotSize * boost;
    }

    circle(px, py, size);
  }
}

// Emoji style: replaces the line entirely with randomly chosen emoji
// images scattered along the path, big enough to freely overlap.
// Base size is 5x the original connector dot (12px -> 60px). About
// half of them get scaled down to 20-50% of that; the rest range
// from base size up to an occasional extra 5x on top, all as one
// continuous distribution so nothing pops suddenly as the slider moves.
function drawEmojiEdge(sx1, sy1, sx2, sy2, multiplier, edgeIndex) {
  if (!emojiImages.length) return; // images still loading

  const dx = sx2 - sx1;
  const dy = sy2 - sy1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const perpX = -uy;
  const perpY = ux;

  const numImages = Math.max(4, Math.round(4 + multiplier * 1.2));
  const scatterAmp = (40 + (multiplier - 1) * 4) * currentWordScale; // meaningful separation from the path even at multiplier 1
  const baseSize = getScaledDotDiameter() * 5; // 5x the connector dot size scaled proportionally
  const seed = edgeIndex * 1000; // each segment samples a different part of the noise field

  imageMode(CENTER);
  for (let s = 1; s < numImages; s++) {
    const t = s / numImages;
    const baseX = sx1 + dx * t;
    const baseY = sy1 + dy * t;

    const perpRand = (noise(seed + s * 4.1 + 300, multiplier * 0.41) - 0.5) * 2 * scatterAmp;
    const tangentRand = (noise(seed + s * 6.7 + 400, multiplier * 0.33) - 0.5) * scatterAmp;

    const px = baseX + perpX * perpRand + ux * tangentRand;
    const py = baseY + perpY * perpRand + uy * tangentRand;

    // Continuous size distribution: half the range shrinks down to
    // 20-50% of base size, the other half stays near base with a
    // smooth, rarer tail up toward 5x — no sudden jumps either way.
    const sizeNoise = noise(seed + s * 19.3 + 800, multiplier * 0.17); // 0-1
    let scale;
    if (sizeNoise < 0.5) {
      const localT = sizeNoise / 0.5; // 0-1 across the shrink half
      scale = 0.5 - localT * 0.3; // 0.5x down to 0.2x
    } else {
      const localT = (sizeNoise - 0.5) / 0.5; // 0-1 across the grow half
      const biased = Math.pow(localT, 3); // skews toward 1x, rare tail toward 5x
      scale = 1 + biased * 4;
    }
    const size = baseSize * scale;

    // Decorrelated image pick: a large, irregular step per dot index
    // (rather than a small one) so neighboring dots don't sample
    // nearby, similar noise values and keep landing on the same
    // emoji — this spreads usage across all of them, not just a few.
    const imgIndex = Math.floor(noise(seed + s * 37.13, multiplier * 0.01) * emojiImages.length) % emojiImages.length;
    image(emojiImages[imgIndex], px, py, size, size);
  }
  imageMode(CORNER); // restore p5 default
}

function getExitPoint(points) {
  if (!points || points.length === 0) return null;
  let exitPt = points[points.length - 1];
  for (let j = 1; j < points.length; j++) {
    if (points[j].disconnect) {
      exitPt = points[j - 1];
      break;
    }
  }
  return exitPt;
}

function draw() {
  updateAnim();
  clear();

  stroke(0);
  strokeWeight(getScaledStrokeWeight());
  noFill();

  const lineMap = {};
  letters.forEach(letter => {
    const lineIdx = letter.lineIndex !== undefined ? letter.lineIndex : 0;
    if (!lineMap[lineIdx]) lineMap[lineIdx] = [];
    lineMap[lineIdx].push(letter);
  });

  const lineIndices = Object.keys(lineMap).map(Number).sort((a, b) => a - b);
  let edgeIndex = 0;

  if (letters.length === 0 || letters.every(l => l.isSpace)) {
  } else {
    lineIndices.forEach(lineIdx => {
      const lineLetters = lineMap[lineIdx];
      const nonSpaceLetters = lineLetters.filter(l => !l.isSpace && l.points && l.points.length > 0);
      const lineBaseY = lineLetters.find(l => l.lineBaseY !== undefined)?.lineBaseY ?? BASE_Y;

      if (nonSpaceLetters.length === 0) {
      } else {
        const firstPoint = nonSpaceLetters[0].points[0];
        drawEdge(mapX(0), mapY(lineBaseY), mapX(firstPoint.x), mapY(firstPoint.y), false, edgeIndex++);

        for (let k = 0; k < lineLetters.length; k++) {
          const current = lineLetters[k];
          if (!current.isSpace && current.points.length > 0) {
            for (let i = 0; i < current.points.length - 1; i++) {
              const a = current.points[i];
              const b = current.points[i + 1];
              if (!b.disconnect) {
                drawEdge(mapX(a.x), mapY(a.y), mapX(b.x), mapY(b.y), true, edgeIndex++);
              }
            }

            // Find the next non-space letter to connect to
            let nextNonSpace = null;
            for (let j = k + 1; j < lineLetters.length; j++) {
              if (!lineLetters[j].isSpace && lineLetters[j].points.length > 0) {
                nextNonSpace = lineLetters[j];
                break;
              }
            }
            if (nextNonSpace) {
              const pLast = getExitPoint(current.points);
              const pNextFirst = nextNonSpace.points[0];
              if (pLast && pNextFirst) {
                drawEdge(mapX(pLast.x), mapY(pLast.y), mapX(pNextFirst.x), mapY(pNextFirst.y), true, edgeIndex++);
              }
            }
          }
        }

        const lastLetter = nonSpaceLetters[nonSpaceLetters.length - 1];
        const lastPoint = getExitPoint(lastLetter.points);
        if (lastPoint) {
          drawEdge(mapX(lastPoint.x), mapY(lastPoint.y), mapX(VIEW_W), mapY(lineBaseY), false, edgeIndex++);
        }
      }
    });
  }

  const dotDiameter = getScaledDotDiameter();
  for (let lIdx = 0; lIdx < letters.length; lIdx++) {
    const letter = letters[lIdx];
    if (!letter.isSpace && letter.opacity > 0.001) {
      for (let pIdx = 0; pIdx < letter.points.length; pIdx++) {
        const p = letter.points[pIdx];


        // In normal mode: omit drawing the circle if hideCircle is true
        if (!p.hideCircle) {
          fill(0, 0, 0, letter.opacity * 255);
          noStroke();
          circle(mapX(p.x), mapY(p.y), dotDiameter);
        }
      }
    }
  }

}