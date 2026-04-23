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

function _drawLabelBox(ctx, boxX, boxY, boxW, boxH, isHovered) {
  if (isHovered) {
    // Big glow behind the box to make it visually pop forward.
    ctx.save();
    ctx.shadowColor = 'rgba(249, 168, 212, 0.9)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = 'rgba(35, 21, 53, 0.97)';
    ctx.beginPath();
    ctx.roundRect(boxX - 4, boxY - 4, boxW + 8, boxH + 8, 6);
    ctx.fill();
    ctx.restore();

    // Bright pink border.
    ctx.strokeStyle = 'rgba(249, 168, 212, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boxX - 4, boxY - 4, boxW + 8, boxH + 8, 6);
    ctx.stroke();

    // Fully opaque main box.
    ctx.fillStyle = 'rgba(35, 21, 53, 0.97)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(249, 168, 212, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    // Dimmed: semi-transparent background so it recedes.
    ctx.fillStyle = 'rgba(35, 21, 53, 0.2)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();

    ctx.strokeStyle = 'rgba(249, 168, 212, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Boxed edit-summary labels near each improvement point.
const labelPlugin = {
  id: 'improvementLabels',

  beforeDraw(chart) {
    const { ctx, scales: { x: xScale, y: yScale }, chartArea } = chart;
    const maximize = StateLoader.getMaximize();
    const OFFSET = 12;
    const MAX_TEXT_W = 110;

    // Collect all label info first.
    const labels = [];
    ctx.save();
    ctx.font = '9px sans-serif';

    for (const p of currentProgression) {
      if (!p.isImprovement || !p.editSummary || p.score === null) continue;
      const px = xScale.getPixelForValue(p.iter);
      const py = yScale.getPixelForValue(p.runningBest);

      const lines = wrapText(ctx, p.editSummary, MAX_TEXT_W);
      const boxW = Math.min(Math.max(...lines.map((l) => ctx.measureText(l).width)), MAX_TEXT_W) + 12;
      const boxH = lines.length * 12 + (lines.length - 1) * 2 + 10;
      let boxX = Math.max(chartArea.left, Math.min(px - boxW / 2, chartArea.right - boxW));
      const boxY = maximize ? py + OFFSET : py - OFFSET - boxH;

      const idx = currentProgression.indexOf(p);
      labels.push({ idx, boxX, boxY, boxW, boxH, lines });
    }
    ctx.restore();

    _labelBounds = labels.map((l) => ({ x: l.boxX, y: l.boxY, w: l.boxW, h: l.boxH, idx: l.idx }));

    const hoveredIdx = labelPlugin._hoveredIdx;

    // First pass: draw all non-hovered labels (dimmed).
    for (const l of labels) {
      if (l.idx === hoveredIdx) continue;
      _drawLabelBox(ctx, l.boxX, l.boxY, l.boxW, l.boxH, false);

      ctx.save();
      ctx.font = '9px sans-serif';
      ctx.fillStyle = 'rgba(249, 168, 212, 0.35)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      l.lines.forEach((line, i) => {
        ctx.fillText(line, l.boxX + 6, l.boxY + 5 + i * 14 + 6);
      });
      ctx.restore();
    }

    // Second pass: draw hovered label last so it's always on top of overlaps.
    if (hoveredIdx !== null) {
      const l = labels.find((l) => l.idx === hoveredIdx);
      if (l) {
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
      chart.options.plugins.tooltip.enabled = labelHit === null;
      chart.canvas.style.cursor = labelHit !== null ? 'pointer' : '';
      chart.draw();
    }

    // Click handling.
    if (event.type === 'click') {
      // Label box click — show node details.
      if (labelHit !== null) {
        showNodeForIteration(currentProgression[labelHit].iter);
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
            const hitR = di === 1 ? 10 : 6;
            const dx = x - px, dy = y - py;
            if (dx * dx + dy * dy <= hitR * hitR) {
              showNodeForIteration(pt.x);
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
  currentProgression = StateLoader.getBestProgression();
  if (currentProgression.length === 0) return;

  _chartImprovements = currentProgression.filter((p) => p.isImprovement && p.score !== null);
  _chartDiscarded = currentProgression.filter((p) => !p.isImprovement && p.score !== null);

  const allValues = currentProgression.flatMap((p) =>
    [p.score, p.runningBest].filter((v) => v !== null)
  );
  const range = Math.max(...allValues) - Math.min(...allValues);
  const pad = range * 0.05 || 0.001;
  const yMin = Math.min(...allValues) - pad;
  const yMax = Math.max(...allValues) + pad;

  // Step line: improvement points + trailing point at last iter if needed.
  const stepData = _chartImprovements.map((p) => ({ x: p.iter, y: p.runningBest }));
  const lastEntry = currentProgression[currentProgression.length - 1];
  const lastImpr = _chartImprovements[_chartImprovements.length - 1];
  if (lastEntry && lastImpr && lastEntry.iter > lastImpr.iter) {
    stepData.push({ x: lastEntry.iter, y: lastEntry.runningBest });
  }

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
          label: 'All runs',
          data: _chartDiscarded.map((p) => ({ x: p.iter, y: p.score })),
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: 'rgba(196, 168, 224, 0.2)',
          pointBorderColor: 'transparent',
          showLine: false,
        },
        {
          label: 'Improvements',
          data: _chartImprovements.map((p) => ({ x: p.iter, y: p.score })),
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: _chartImprovements.map((p) =>
            p.runningBest === StateLoader.getBestScore() ? '#80f0b0' : 'rgba(255, 176, 224, 0.9)'
          ),
          pointBorderColor: 'rgba(255,255,255,0.25)',
          pointBorderWidth: 1,
          showLine: false,
        },
        {
          label: 'Running best',
          data: stepData,
          showLine: true,
          stepped: 'after',
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
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: '#ddbdf0',
            usePointStyle: true,
            pointStyleWidth: 10,
            padding: 15,
            font: { size: 11 },
          },
        },
        title: {
          display: true,
          text: `Progress: ${currentProgression.length} Experiments, ${_chartImprovements.length} Kept Improvements`,
          color: '#ddbdf0',
          font: { size: 13, weight: 'normal' },
          padding: { bottom: 12 },
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(35, 21, 53, 0.95)',
          titleColor: '#ffffff',
          bodyColor: '#ddbdf0',
          borderColor: 'rgba(249, 168, 212, 0.3)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          displayColors: false,
          callbacks: {
            title(items) {
              if (!items?.length) return '';
              const item = items[0];
              const p = item.datasetIndex === 0
                ? _chartDiscarded[item.dataIndex]
                : _chartImprovements[item.dataIndex];
              return p ? `Iteration ${p.iter} ✨` : '';
            },
            label(item) {
              if (item.datasetIndex === 2) return null;
              const p = item.datasetIndex === 0
                ? _chartDiscarded[item.dataIndex]
                : _chartImprovements[item.dataIndex];
              if (!p) return '';
              const lines = [];
              if (p.score !== null) lines.push(`Score: ${p.score.toFixed(6)}`);
              if (p.runningBest !== null) lines.push(`Running best: ${p.runningBest.toFixed(6)}`);
              if (p.editSummary) lines.push(`Change: ${p.editSummary}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          ticks: {
            color: '#ddbdf0',
            font: { size: 10 },
            maxTicksLimit: 20,
          },
          grid: { color: 'rgba(61, 42, 92, 0.4)', drawBorder: false },
          border: { display: false },
        },
        y: {
          min: yMin,
          max: yMax,
          ticks: { color: '#ddbdf0', font: { size: 11 }, padding: 8 },
          grid: { color: 'rgba(61, 42, 92, 0.4)', drawBorder: false },
          border: { display: false },
        },
      },
    },
    plugins: [labelPlugin],
  });
}
