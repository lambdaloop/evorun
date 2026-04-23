let scoreChart = null;
let currentProgression = [];
let _chartDiscarded = [];
let _chartImprovements = [];

// Map an iteration number to the corresponding tree node and show its details.
function showNodeForIteration(iter) {
  const nodes = StateLoader.getNodesByStep();
  const node = nodes.find((n) => n.step === iter);
  if (node && typeof showNodeDetailToBottom === 'function') {
    showNodeDetailToBottom(node);
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Store label bounding boxes for hit-testing.
let _labelBounds = [];
// Store computed label positions for use in afterDraw.
let _labelPositions = [];

function _drawLabelBox(ctx, boxX, boxY, boxW, boxH, isHovered) {
  if (isHovered) {
    // Big glow behind the box to make it visually pop forward.
    ctx.save();
    ctx.shadowColor = 'rgba(249, 168, 212, 0.9)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = 'rgba(35, 21, 53, 1.0)';
    ctx.beginPath();
    ctx.roundRect(boxX - 4, boxY - 4, boxW + 8, boxH + 8, 6);
    ctx.fill();
    ctx.restore();

    // Bright pink border.
    ctx.strokeStyle = 'rgba(249, 168, 212, 1.0)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boxX - 4, boxY - 4, boxW + 8, boxH + 8, 6);
    ctx.stroke();

    // Fully opaque main box.
    ctx.fillStyle = 'rgba(35, 21, 53, 1.0)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(249, 168, 212, 1.0)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    // Non-hovered: fully opaque but darker background.
    ctx.fillStyle = 'rgba(25, 15, 40, 1.0)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(249, 168, 212, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// AABB overlap test for two label boxes.
function _boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Check if a box overlaps a point (with a small radius).
function _boxOverlapsPoint(box, px, py, radius) {
  // Expand the box by the radius and test AABB against a point-expanded box.
  const expanded = { x: box.x - radius, y: box.y - radius, w: box.w + 2 * radius, h: box.h + 2 * radius };
  return expanded.x <= px && expanded.x + expanded.w >= px && expanded.y <= py && expanded.y + expanded.h >= py;
}

// Shift a label box away from an obstacle (another box or a point).
function _shiftAway(label, obstacle, maximize, bounds) {
  const labelBox = { x: label.boxX, y: label.boxY, w: label.boxW, h: label.boxH };
  if (!_boxesOverlap(labelBox, obstacle)) return false;

  // Push label away from obstacle based on relative position, not maximize direction.
  const labelCenterY = label.boxY + label.boxH / 2;
  const obstacleCenterY = obstacle.y + obstacle.h / 2;

  let shiftedY;
  if (labelCenterY <= obstacleCenterY) {
    // Label is above obstacle — push it further up.
    shiftedY = obstacle.y - label.boxH - 8;
  } else {
    // Label is below obstacle — push it further down.
    shiftedY = obstacle.y + obstacle.h + 8;
  }
  const clampedY = Math.max(bounds.top, Math.min(shiftedY, bounds.bottom - label.boxH));
  label.boxY = clampedY;
  return true;
}

// Boxed edit-summary labels near each improvement point, with leader lines.
const labelPlugin = {
  id: 'improvementLabels',

  beforeDraw(chart) {
    const { ctx, scales: { x: xScale, y: yScale }, chartArea } = chart;
    const maximize = StateLoader.getMaximize();
    const OFFSET = 12;
    const MAX_TEXT_W = 110;

    // Use CSS-pixel dimensions (chart.width/height), not physical pixels
    // (chart.canvas.width/height), since Chart.js draws in CSS-pixel space.
    const CANVAS_MARGIN = 10;
    const BOTTOM_MARGIN = 30;
    const canvasBounds = {
      top: CANVAS_MARGIN,
      bottom: chart.height - BOTTOM_MARGIN,
      left: CANVAS_MARGIN,
      right: chart.width - CANVAS_MARGIN
    };

    // Collect all label info.
    const all_iters = currentProgression.map(p => p.iter).filter(i => i !== null);
    const midIter = (Math.min(...all_iters) + Math.max(...all_iters)) / 2;
    const labels = [];
    ctx.save();
    ctx.font = '9px sans-serif';

    for (const p of currentProgression) {
      if (p.isRoot || !p.editSummary || p.score === null) continue;
      const px = xScale.getPixelForValue(p.iter);
      const py = yScale.getPixelForValue(p.score);

      const lines = wrapText(ctx, p.editSummary, MAX_TEXT_W);
      const boxW = Math.min(Math.max(...lines.map((l) => ctx.measureText(l).width)), MAX_TEXT_W) + 12;
      const boxH = lines.length * 12 + (lines.length - 1) * 2 + 10;

      // Horizontal: deterministic side choice based on data point position,
      // never flips on resize. Right side for iter >= midpoint, left otherwise.
      let boxX;
      if (p.iter >= midIter) {
        boxX = px + OFFSET;
      } else {
        boxX = px - boxW - OFFSET;
      }

      // Vertical: snug against the data point, above when minimizing, below when maximizing.
      const preferBelow = maximize;
      let boxY;
      if (preferBelow) {
        boxY = py + OFFSET;
      } else {
        boxY = py - OFFSET - boxH;
      }

      const idx = currentProgression.indexOf(p);
      labels.push({ idx, iter: p.iter, boxX, boxY, boxW, boxH, lines, px, py });
    }
    ctx.restore();

    // --- Deterministic label placement with canonical overlap resolution ---
    // No force simulation — side choice and overlap detection are width-independent.
    // This eliminates resize instability (labels don't wiggle on window resize).
    const GAP = 12;

    // Compute canonical horizontal positions for overlap detection.
    // These are based on iteration ordering, not canvas width.
    const canonX = {};
    labels.forEach((l, i) => {
      if (l.iter >= midIter) {
        canonX[i] = l.iter * 20 + 12;
      } else {
        canonX[i] = l.iter * 20 - l.boxW - 12;
      }
    });

    // Resolve label-label overlaps by shifting labels vertically only.
    // Uses canonical horizontal positions for width-independent detection.
    let changed = true;
    let iterCount = 0;
    while (changed && iterCount < 50) {
      changed = false;
      iterCount++;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const li = labels[i], lj = labels[j];
          const cxI = canonX[i], cxJ = canonX[j];
          // Horizontal overlap using canonical positions
          if (cxI + li.boxW <= cxJ + GAP) continue;
          if (cxJ + lj.boxW <= cxI + GAP) continue;
          // Vertical overlap
          if (li.boxY + li.boxH + GAP <= lj.boxY) continue;
          if (lj.boxY + lj.boxH + GAP <= li.boxY) continue;
          // Push lower-score label down
          if (lj.score >= li.score) {
            lj.boxY = li.boxY + li.boxH + GAP;
          } else {
            li.boxY = lj.boxY + lj.boxH + GAP;
          }
          changed = true;
        }
      }
    }

    // Final clamp: ensure all labels are within canvas bounds.
    for (const l of labels) {
      l.boxX = Math.max(canvasBounds.left, Math.min(l.boxX, canvasBounds.right - l.boxW));
      l.boxY = Math.max(canvasBounds.top, Math.min(l.boxY, canvasBounds.bottom - l.boxH));
    }

    _labelBounds = labels.map((l) => ({ x: l.boxX, y: l.boxY, w: l.boxW, h: l.boxH, idx: l.idx }));
    _labelPositions = labels;
  },

  afterDraw(chart) {
    const { ctx } = chart;
    const hoveredIdx = labelPlugin._hoveredIdx;
    const labels = _labelPositions;

    // Draw leader line from data point to label box.
    function drawLeader(px, py, bx, by, bw, bh, alpha) {
      ctx.save();
      ctx.strokeStyle = `rgba(249, 168, 212, ${alpha * 0.5})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      let ex, ey;
      if (px < bx) { ex = bx; ey = by + bh / 2; }
      else if (px > bx + bw) { ex = bx + bw; ey = by + bh / 2; }
      else if (py < by) { ex = cx; ey = by; }
      else { ex = cx; ey = by + bh; }
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // First pass: draw all non-hovered labels.
    for (const l of labels) {
      if (l.idx === hoveredIdx) continue;
      drawLeader(l.px, l.py, l.boxX, l.boxY, l.boxW, l.boxH, 0.8);
      _drawLabelBox(ctx, l.boxX, l.boxY, l.boxW, l.boxH, false);

      ctx.save();
      ctx.font = '9px sans-serif';
      ctx.fillStyle = 'rgba(249, 168, 212, 0.95)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      l.lines.forEach((line, i) => {
        ctx.fillText(line, l.boxX + 6, l.boxY + 5 + i * 14 + 6);
      });
      ctx.restore();
    }

    // Second pass: draw hovered label last so it's always on top.
    if (hoveredIdx !== null) {
      const l = labels.find((l) => l.idx === hoveredIdx);
      if (l) {
        drawLeader(l.px, l.py, l.boxX, l.boxY, l.boxW, l.boxH, 1);
        _drawLabelBox(ctx, l.boxX, l.boxY, l.boxW, l.boxH, true);

        ctx.save();
        ctx.font = '9px sans-serif';
        ctx.fillStyle = 'rgba(249, 168, 212, 0.95)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        l.lines.forEach((line, i) => {
          ctx.fillText(line, l.boxX + 6, l.boxY + 5 + i * 14 + 6);
        });
        ctx.restore();
      }
    }
  },

  afterEvent(chart, args) {
    const { event } = args;
    const { x, y } = event;

    // Check label box hit first (they're on top).
    let labelHit = null;
    for (const b of _labelBounds) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        labelHit = b.idx;
        break;
      }
    }

    // Hover tracking for labels.
    if (labelHit !== labelPlugin._hoveredIdx) {
      labelPlugin._hoveredIdx = labelHit;
      chart.canvas.style.cursor = labelHit !== null ? 'pointer' : '';
      chart.draw();
    }

    // Click handling.
    if (event.type === 'click') {
      // Label box click — show node details.
      if (labelHit !== null) {
        const p = currentProgression[labelHit];
        if (p && p.isRoot) {
          const root = StateLoader.getNodes().find((n) => n.stage === 'root');
          if (root && typeof showNodeDetailToBottom === 'function') showNodeDetailToBottom(root);
        } else if (p) {
          showNodeForIteration(p.iter);
        }
        return;
      }

      // Scatter point click — check all datasets.
      const { data: { datasets } } = chart;
      for (let di = 0; di < datasets.length; di++) {
        const ds = datasets[di];
        if (!ds.showLine) {
          for (let pi = 0; pi < ds.data.length; pi++) {
            const pt = ds.data[pi];
            const px = chart.scales.x.getPixelForValue(pt.x);
            const py = chart.scales.y.getPixelForValue(pt.y);
            const hitR = 10;
            const dx = x - px, dy = y - py;
            if (dx * dx + dy * dy <= hitR * hitR) {
              const p = currentProgression[pi];
              if (p && p.isRoot) {
                const root = StateLoader.getNodes().find((n) => n.stage === 'root');
                if (root && typeof showNodeDetailToBottom === 'function') showNodeDetailToBottom(root);
              } else {
                showNodeForIteration(pt.x);
              }
              return;
            }
          }
        }
      }
    }
  },
};
labelPlugin._hoveredIdx = null;

function renderScoreChart() {
  currentProgression = StateLoader.getProgressionImprovements();
  if (currentProgression.length === 0) return;

  _chartImprovements = currentProgression.filter((p) => !p.isRoot);
  _chartDiscarded = [];

  const pathValues = currentProgression.map((p) => p.score).filter((v) => v !== null);
  const dataMin = Math.min(...pathValues);
  const dataMax = Math.max(...pathValues);
  const range = dataMax - dataMin;

  // Add symmetric padding for visual breathing room (8% on each side)
  // Labels use canvasBounds and don't need axis padding
  const pad = range * 0.08 || 0.001;
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;

  // Step line: connect all improvement nodes in order.
  const stepData = currentProgression.map((p) => ({ x: p.iter, y: p.score }));

  if (scoreChart) scoreChart.destroy();

  const canvas = document.getElementById('score-chart');
  const ctx = canvas.getContext('2d');

  // Pink → lavender → sky-blue gradient for the step line.
  const lineGradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  lineGradient.addColorStop(0, 'rgba(249, 168, 212, 0.9)');
  lineGradient.addColorStop(0.5, 'rgba(196, 168, 224, 0.95)');
  lineGradient.addColorStop(1, 'rgba(135, 206, 235, 1)');

  scoreChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Improvements',
          data: currentProgression.map((p) => ({ x: p.iter, y: p.score })),
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: currentProgression.map((p) =>
            p.isRoot ? '#ffb347' :
              p.score === StateLoader.getBestScore() ? '#80f0b0' :
              'rgba(255, 176, 224, 0.9)'
          ),
          pointBorderColor: 'rgba(255,255,255,0.25)',
          pointBorderWidth: 1,
          showLine: false,
        },
        {
          label: 'Path',
          data: stepData,
          showLine: true,
          stepped: 'before',
          borderColor: lineGradient,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      interaction: { intersect: true, mode: 'nearest' },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `${_chartImprovements.length} improvements along the path`,
          color: '#f0e0ff',
          font: { size: 13, weight: 'normal' },
          padding: { bottom: 12 },
        },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          type: 'linear',
          min: -2,
          ticks: {
            color: '#f0e0ff',
            font: { size: 10 },
            maxTicksLimit: 20,
            callback: (value) => value >= 0 ? value : '',
          },
          title: { display: true, text: 'Iteration', color: '#f0e0ff', font: { size: 12 } },
          grid: { color: 'rgba(80, 60, 110, 0.25)', drawBorder: false },
          border: { display: false },
        },
        y: {
          min: yMin,
          max: yMax,
          ticks: { color: '#f0e0ff', font: { size: 11 }, padding: 8 },
          title: { display: true, text: 'Score', color: '#f0e0ff', font: { size: 12 } },
          grid: { color: 'rgba(80, 60, 110, 0.25)', drawBorder: false },
          border: { display: false },
        },
      },
    },
    plugins: [labelPlugin],
  });
}
