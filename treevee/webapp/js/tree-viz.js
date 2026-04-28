const rootDiffCache = {};

const stageColors = {
  root: '#f7c2e0',
  improve: '#d4b0e8',
  fusion: '#a8e6e0',
  debug: '#f7d0c7',
  draft: '#c2d8f2',
};

const stageColorsDark = {
  root:    '#5c1f3a',
  improve: '#3a1f5c',
  fusion:  '#1a3d42',
  debug:   '#5c2a1a',
  draft:   '#1a3358',
};

const defaultColor = '#d4b0e8';
const defaultColorDark = '#3a1f5c';

const stageEmojis = {
  root: '🌸',
  improve: '✨',
  fusion: '🧬',
  debug: '💬',
  draft: '🌟',
};

function getNodeColor(node) {
  return stageColors[node.stage] || defaultColor;
}

function buildTree(nodes) {
  const nodeMap = new Map();
  const roots = [];

  for (const node of nodes) {
    nodeMap.set(node.id, { ...node, children: [] });
  }

  for (const node of nodes) {
    const mapped = nodeMap.get(node.id);
    if (node.parent_id === null || node.parent_id === undefined) {
      roots.push(mapped);
    } else {
      const parent = nodeMap.get(node.parent_id);
      if (parent) {
        parent.children.push(mapped);
      }
    }
  }

  return roots;
}

function getBestPathNodeIds(bestNodeId, nodes) {
  const nodeMap = new Map();
  for (const n of nodes) nodeMap.set(n.id, n);
  const path = new Set();
  let current = bestNodeId;
  while (current) {
    path.add(current);
    const node = nodeMap.get(current);
    current = node?.parent_id ?? null;
  }
  return path;
}

function getOrCreateTooltip() {
  let tt = document.getElementById('tree-node-tooltip');
  if (!tt) {
    tt = document.createElement('div');
    tt.id = 'tree-node-tooltip';
    tt.style.display = 'none';
    document.body.appendChild(tt);
  }
  return tt;
}

function positionTooltip(tt, event) {
  const pad = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + 260 > vw) x = event.clientX - 260 - pad;
  if (y + tt.offsetHeight + pad > vh) y = event.clientY - tt.offsetHeight - pad;
  tt.style.left = x + 'px';
  tt.style.top  = y + 'px';
}

// D3 tree layout constants
const NODE_W = 48;
const NODE_H = 100;
const MARGIN = { top: 30, right: 60, bottom: 40, left: 60 };

function renderTree() {
  const nodes = StateLoader.getNodes();
  const container = document.getElementById('tree-container');
  container.innerHTML = '';

  if (nodes.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); padding:16px; text-align:center;">No tree data yet~ (｡•́︿•̀｡) <br><span style="font-size:15px;opacity:0.6;">the tree is sleeping... 🌸💤</span></p>';
    return;
  }

  const roots = buildTree(nodes);
  const bestNodeId = StateLoader.getBestNodeId();
  const pathSet = bestNodeId ? getBestPathNodeIds(bestNodeId, nodes) : new Set();

  // Legend
  const legend = document.createElement('div');
  legend.className = 'tree-legend';
  const allScores = nodes.filter(n => n.score !== null).map(n => n.score);
  if (allScores.length > 0) {
    const rangeItem = document.createElement('div');
    rangeItem.className = 'legend-item';
    rangeItem.style.cssText = 'color:#e8d4f4;font-size:15px;font-family:monospace;';
    rangeItem.textContent = `score ${Math.min(...allScores).toFixed(3)}–${Math.max(...allScores).toFixed(3)}`;
    legend.appendChild(rangeItem);
  }
  const stages = [...new Set(nodes.map(n => n.stage))];
  for (const stage of stages) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = getNodeColor({ stage });
    item.appendChild(dot);
    const count = nodes.filter(n => n.stage === stage).length;
    item.appendChild(document.createTextNode(`${stageEmojis[stage] || ''} ${stage} (${count})`));
    legend.appendChild(item);
  }
  container.appendChild(legend);

  // Wrap multiple roots under a hidden synthetic root if needed
  let hierarchyData;
  if (roots.length === 1) {
    hierarchyData = roots[0];
  } else {
    hierarchyData = { id: '__synthetic__', stage: 'root', score: null, depth: -1, visits: 0, total_reward: 0, children: roots };
  }

  const root = d3.hierarchy(hierarchyData);
  const treeLayout = d3.tree().nodeSize([NODE_W, NODE_H]);
  treeLayout(root);

  // Compute bounds
  let xMin = Infinity, xMax = -Infinity;
  root.each(d => { xMin = Math.min(xMin, d.x); xMax = Math.max(xMax, d.x); });
  const svgW = (xMax - xMin) + MARGIN.left + MARGIN.right;
  const svgH = (root.height + 1) * NODE_H + MARGIN.top + MARGIN.bottom;

  const svg = d3.select(container)
    .append('svg')
    .attr('class', 'tree-svg')
    .attr('width', '100%')
    .attr('height', '100%');

  const zoomG = svg.append('g').attr('class', 'zoom-group');

  const zoom = d3.zoom()
    .scaleExtent([0.05, 4])
    .on('zoom', (event) => zoomG.attr('transform', event.transform));

  svg.call(zoom);

  // Group offset so xMin maps to MARGIN.left
  const g = zoomG.append('g')
    .attr('transform', `translate(${-xMin + MARGIN.left},${MARGIN.top})`);

  // Build position lookup for fusion lines
  const posMap = new Map();
  root.each(d => posMap.set(d.data.id, { x: d.x, y: d.y }));

  // Links
  const linkGen = d3.linkVertical().x(d => d.x).y(d => d.y);

  g.append('g').attr('class', 'tree-links')
    .selectAll('path')
    .data(root.links())
    .join('path')
    .attr('class', d => {
      const onPath = pathSet.has(d.source.data.id) && pathSet.has(d.target.data.id);
      return 'tree-link' + (onPath ? ' on-best-path' : '');
    })
    .attr('d', linkGen);

  // Fusion source lines (dotted, from fusion node back to each source node)
  const fusionLinks = [];
  root.each(d => {
    if (d.data.stage === 'fusion' && d.data.fusion_source_ids?.length) {
      for (const srcId of d.data.fusion_source_ids) {
        const srcPos = posMap.get(srcId);
        if (srcPos) fusionLinks.push({ source: srcPos, target: { x: d.x, y: d.y } });
      }
    }
  });

  g.append('g').attr('class', 'fusion-links')
    .selectAll('line')
    .data(fusionLinks)
    .join('line')
    .attr('class', 'fusion-link')
    .attr('x1', d => d.source.x)
    .attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x)
    .attr('y2', d => d.target.y);

  // Nodes
  const maximize = StateLoader.getMaximize();

  const nodeG = g.append('g').attr('class', 'tree-nodes')
    .selectAll('g')
    .data(root.descendants())
    .join('g')
    .attr('class', d => {
      const classes = ['tree-node-svg'];
      if (StateLoader.isBestNode(d.data.id)) classes.push('best-node');
      if (pathSet.has(d.data.id)) classes.push('on-best-path');
      return classes.join(' ');
    })
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', d => d.data.id === '__synthetic__' ? 'default' : 'pointer')
    .on('click', (event, d) => {
      if (d.data.id === '__synthetic__') return;
      showNodeDetailToBottom(d.data);
    });

  // Background circle
  nodeG.append('circle')
    .attr('r', d => d.data.id === '__synthetic__' ? 0 : 20)
    .attr('fill', d => d.data.id === '__synthetic__' ? 'none' : (stageColorsDark[d.data.stage] || defaultColorDark))
    .attr('stroke', d => {
      if (d.data.id === '__synthetic__') return 'none';
      if (StateLoader.isBestNode(d.data.id)) return 'var(--accent-mint)';
      if (pathSet.has(d.data.id)) return 'var(--accent-pink)';
      const scoreReason = StateLoader.getScoreReason(d.data);
      const isError = d.data.score === null && scoreReason &&
        !scoreReason.startsWith('Baseline') && !scoreReason.startsWith('Score not parsed');
      if (isError) return 'var(--accent-peach)';
      return 'rgba(255,255,255,0.12)';
    })
    .attr('stroke-width', d => {
      if (StateLoader.isBestNode(d.data.id) || pathSet.has(d.data.id)) return 2.5;
      return 1.5;
    });

  // Emoji
  nodeG.filter(d => d.data.id !== '__synthetic__')
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('class', 'node-emoji')
    .text(d => stageEmojis[d.data.stage] || '✨');

  // Step number
  nodeG.filter(d => d.data.id !== '__synthetic__')
    .append('text')
    .attr('dy', 35)
    .attr('text-anchor', 'middle')
    .attr('class', 'node-label-id')
    .text(d => d.data.stage === 'root' ? 'root' : `#${d.data.step}`);

  // Score
  nodeG.filter(d => d.data.id !== '__synthetic__')
    .append('text')
    .attr('dy', 50)
    .attr('text-anchor', 'middle')
    .attr('class', d => {
      if (d.data.score === null) return 'node-label-score na';
      if (StateLoader.isBestNode(d.data.id)) return 'node-label-score best';
      const parentNode = nodes.find(n => n.id === d.data.parent_id);
      if (parentNode && parentNode.score !== null) {
        const improved = maximize ? d.data.score > parentNode.score : d.data.score < parentNode.score;
        const degraded = maximize ? d.data.score < parentNode.score : d.data.score > parentNode.score;
        if (improved) return 'node-label-score improved';
        if (degraded) return 'node-label-score degraded';
      }
      return 'node-label-score';
    })
    .text(d => d.data.score != null ? d.data.score.toFixed(3) : 'N/A');

  // Hover tooltip
  const tooltip = getOrCreateTooltip();

  nodeG.filter(d => d.data.id !== '__synthetic__')
    .on('mouseenter', (event, d) => {
      const parentNode = nodes.find(n => n.id === d.data.parent_id);
      const histEntry = d.data.stage !== 'root' ? StateLoader.getHistoryEntryForStep(d.data.step) : null;

      let deltaHtml = '';
      if (d.data.score !== null && parentNode && parentNode.score !== null) {
        const delta = d.data.score - parentNode.score;
        const isGood = maximize ? delta > 0 : delta < 0;
        const color = delta === 0 ? 'var(--text-muted)' : isGood ? 'var(--accent-mint)' : 'var(--accent-peach)';
        const sign = delta > 0 ? '+' : '';
        deltaHtml = `<div class="tt-delta" style="color:${color}">${sign}${delta.toFixed(4)}</div>`;
      } else if (d.data.score !== null) {
        deltaHtml = `<div class="tt-delta" style="color:var(--text-muted)">${d.data.score.toFixed(4)}</div>`;
      } else {
        deltaHtml = `<div class="tt-delta" style="color:var(--accent-peach)">N/A</div>`;
      }

      const summaryHtml = histEntry?.edit_summary
        ? `<div class="tt-summary">${escapeHtml(histEntry.edit_summary)}</div>`
        : '';

      tooltip.innerHTML = `<div class="tt-header">${stageEmojis[d.data.stage] || ''} ${d.data.stage} #${d.data.step}</div>${deltaHtml}${summaryHtml}`;
      tooltip.style.display = 'block';
      positionTooltip(tooltip, event);
    })
    .on('mousemove', (event) => positionTooltip(tooltip, event))
    .on('mouseleave', () => { tooltip.style.display = 'none'; });

  // Stash for control buttons (fit is triggered by tab-switch handler)
  container._d3zoom = zoom;
  container._d3svg = svg;
  container._svgW = svgW;
  container._svgH = svgH;
}

function highlightTreeNode(nodeId) {
  d3.selectAll('.tree-node-svg').classed('active', false);
  d3.selectAll('.tree-node-svg')
    .filter(d => d.data && d.data.id === nodeId)
    .classed('active', true);
}

function applyFitHorizontal(container, animate) {
  if (!container._d3zoom || !container._d3svg) return;
  const cW = container.clientWidth || 800;
  const scale = (cW / container._svgW) * 0.95;
  const tx = (cW - container._svgW * scale) / 2;
  const ty = MARGIN.top;
  const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
  if (animate) {
    container._d3svg.transition().duration(350).call(container._d3zoom.transform, t);
  } else {
    container._d3svg.call(container._d3zoom.transform, t);
  }
}

function initTreeControls() {
  document.getElementById('fit-horizontal').addEventListener('click', () => {
    applyFitHorizontal(document.getElementById('tree-container'), true);
  });

  document.getElementById('fit-vertical').addEventListener('click', () => {
    const container = document.getElementById('tree-container');
    if (!container._d3zoom || !container._d3svg) return;
    const cH = container.clientHeight || 500;
    const scale = (cH / container._svgH) * 0.95;
    const cW = container.clientWidth || 800;
    const tx = (cW - container._svgW * scale) / 2;
    const ty = MARGIN.top;
    container._d3svg.transition().duration(350)
      .call(container._d3zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  });

  document.getElementById('reset-view').addEventListener('click', () => {
    const container = document.getElementById('tree-container');
    if (!container._d3zoom || !container._d3svg) return;
    container._d3svg.transition().duration(350)
      .call(container._d3zoom.transform, d3.zoomIdentity);
  });
}

function showNodeDetailToBottom(nodeData) {
  const diffSection = document.getElementById('diff-section');
  const diffOutput = document.getElementById('diff-output');
  const closeBtn = document.getElementById('close-diff');

  if (!diffSection || !diffOutput || !closeBtn) {
    return;
  }

  highlightTreeNode(nodeData.id);

  const shortId = nodeData.id.slice(0, 8);
  const isRoot = nodeData.stage === 'root';
  const historyEntry = isRoot ? null : StateLoader.getHistoryEntryForStep(nodeData.step);
  const scoreReason = StateLoader.getScoreReason(nodeData);
  const isBest = StateLoader.isBestNode(nodeData.id);

  let html = '';

  // Header
  const completedStr = historyEntry && historyEntry.datetime ? (() => { try { return new Date(historyEntry.datetime).toLocaleString(); } catch { return historyEntry.datetime; } })() : '';
  html += `<p style="color:var(--text-secondary); padding:8px 0; font-size:15px;"><strong>${stageEmojis[nodeData.stage] || ''} ${nodeData.stage} node [${shortId}]</strong> (Step ${nodeData.step})${completedStr ? ' <span style="color:var(--text-muted);font-size:15px;margin-left:8px;">' + escapeHtml(completedStr) + '</span>' : ''}</p>`;

  // Status banners
  if (isBest) {
    html += `<div style="background:var(--accent-mint-dim);border:1px solid rgba(168,230,207,0.3);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;color:var(--accent-mint);font-weight:600;">⭐ Best node!</div>`;
  }

  if (nodeData.score === null && scoreReason && !scoreReason.startsWith('Baseline')) {
    html += `<div style="background:var(--accent-peach-dim);border:1px solid rgba(255,183,178,0.3);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px;color:var(--accent-peach);font-weight:600;">⚠ ${escapeHtml(scoreReason)}</div>`;
  }

  // Score comparison with parent
  const allNodes = StateLoader.getNodesByStep();
  const parent = allNodes.find((n) => n.id === nodeData.parent_id);
  const maximize = StateLoader.getMaximize();
  if (parent && parent.score !== null && nodeData.score !== null) {
    const delta = nodeData.score - parent.score;
    const isImprovement = maximize ? delta > 0 : delta < 0;
    const isDegradation = maximize ? delta < 0 : delta > 0;
    const deltaColor = isImprovement ? 'var(--accent-mint)' : isDegradation ? 'var(--accent-peach)' : 'var(--text-secondary)';
    html += `<p style="color:${deltaColor}; padding:4px 0; font-size:15px;font-weight:600;">Score: ${parent.score.toFixed(4)} → ${nodeData.score.toFixed(4)} (${delta > 0 ? '+' : ''}${delta.toFixed(4)})</p>`;
  } else if (nodeData.score !== null) {
    html += `<p style="color:var(--text-secondary); padding:4px 0; font-size:15px;">Score: ${nodeData.score.toFixed(4)}</p>`;
  } else if (parent && parent.score !== null) {
    html += `<p style="color:var(--accent-peach); padding:4px 0; font-size:15px;">Score: ${parent.score.toFixed(4)} → N/A</p>`;
  }

  // Node info — single line
  const rewardVal = nodeData.total_reward != null ? nodeData.total_reward.toFixed(4) : 'N/A';
  html += '<p style="font-size:15px;color:var(--text-secondary);margin:0 0 8px 0;">';
  html += `<strong>Parent:</strong> ${parent ? 'Step ' + parent.step : 'Root'} · `;
  html += `<strong>Visits:</strong> ${nodeData.visits} · `;
  html += `<strong>Depth:</strong> ${nodeData.depth} · `;
  html += `<strong>Tree Reward:</strong> ${rewardVal}`;
  html += '</p>';

  // History info — compact grid
  if (historyEntry) {
    if (historyEntry.edit_summary) {
      html += '<div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:6px 8px;margin-bottom:8px;font-size:15px;">';
      html += detailRow('Edit Summary', historyEntry.edit_summary);
      html += '</div>';
    }

    // Files changed
    const hasFiles = historyEntry.files_modified.length || historyEntry.files_added.length || historyEntry.files_deleted.length;
    if (hasFiles) {
      html += '<div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:6px 8px;margin-bottom:8px;font-size:15px;">';
      if (historyEntry.files_modified.length) html += detailRow('Modified', historyEntry.files_modified.join(', '));
      if (historyEntry.files_added.length) html += detailRow('Added', historyEntry.files_added.join(', '));
      if (historyEntry.files_deleted.length) html += detailRow('Deleted', historyEntry.files_deleted.join(', '));
      html += '</div>';
    }
  }

  // Eval output / Error output
  const hasEvalOutput = nodeData.eval_output && nodeData.eval_output.trim();
  const hasHistoryEntry = !!historyEntry;
  const isError = nodeData.score === null && scoreReason && !scoreReason.startsWith('Baseline') && !scoreReason.startsWith('Score not parsed');
  if (hasEvalOutput || hasHistoryEntry) {
    const sectionBorder = isError ? 'rgba(255,183,178,0.4)' : 'var(--border-color)';
    const sectionBg = isError ? 'rgba(255,183,178,0.05)' : 'var(--bg-primary)';
    const headerColor = isError ? 'var(--accent-peach)' : 'var(--accent-pink)';
    const preBorder = isError ? 'rgba(255,183,178,0.3)' : 'var(--border-color)';
    const preBg = isError ? 'rgba(255,183,178,0.08)' : 'var(--bg-primary)';
    const preColor = isError ? 'var(--accent-peach)' : 'var(--text-secondary)';
    const btnBg = isError ? 'var(--accent-peach-dim)' : 'var(--bg-tertiary)';
    const btnColor = isError ? 'var(--accent-peach)' : 'var(--accent-pink)';
    const title = isError ? 'Error Output' : 'Evaluation Output';

    html += `<div style="background:${sectionBg};border:1px solid ${sectionBorder};border-radius:6px;padding:10px;margin-bottom:12px;">`;
    html += `<h4 style="color:${headerColor};margin-bottom:6px;font-size:15px;">${title}</h4>`;

    if (hasHistoryEntry) {
      const statusText = historyEntry.timed_out ? 'Timed out' : 'OK';
      const statusColor = historyEntry.timed_out ? 'var(--accent-peach)' : 'var(--text-muted)';
      html += `<div class="detail-row" style="gap:0;"><span class="detail-label">Exec Time</span><span class="detail-value">${historyEntry.exec_time.toFixed(2)}s</span><span class="detail-value" style="color:${statusColor};margin-left:16px;">Status ${statusText}</span></div>`;
    }

    if (hasEvalOutput) {
      const evalPreview = nodeData.eval_output;
      const isLong = evalPreview.length > 400;
      const display = isLong ? evalPreview.slice(0, 400) + '\n... (truncated)' : evalPreview;
      html += `<pre style="background:${preBg};padding:10px;border-radius:6px;font-size:14px;overflow:auto;max-height:200px;border:1px solid ${preBorder};color:${preColor};white-space:pre-wrap;word-break:break-word;">${escapeHtml(display)}</pre>`;
      if (isLong) {
        html += `<button class="expand-btn" style="background:${btnBg};color:${btnColor};border:1px solid ${sectionBorder};padding:4px 10px;border-radius:4px;font-size:15px;cursor:pointer;margin-top:6px;">Show full output (${evalPreview.length} chars)</button>`;
      }
    } else if (hasHistoryEntry) {
      html += `<p style="color:var(--text-muted); padding:4px 0; font-size:15px;">No eval output captured.</p>`;
    }
    html += '</div>';
  }

  // Diff
  html += '<div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:10px;margin-bottom:12px;">';
  html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
  html += '<h4 style="color:var(--accent-lavender);font-size:15px;margin:0;">Code Diff</h4>';
  if (!isRoot) {
    const btnBase = 'border:1px solid var(--border-color);border-radius:4px;padding:2px 8px;font-size:15px;cursor:pointer;';
    html += `<button id="diff-toggle-parent" class="active" style="${btnBase}background:var(--accent-lavender);color:var(--bg-primary);">vs parent</button>`;
    html += `<button id="diff-toggle-root" class="inactive" style="${btnBase}background:var(--bg-tertiary);color:var(--accent-lavender);">vs root</button>`;
  }
  html += '</div>';
  html += '<div id="diff-content">';
  if (historyEntry?.diff_text && historyEntry.diff_text.trim()) {
    html += renderDiffHTML(historyEntry.diff_text);
  } else if (isRoot) {
    html += '<p style="color:var(--text-muted); padding:4px 0; font-size:15px;">This is the root node.</p>';
  } else {
    html += '<p style="color:var(--text-muted); padding:4px 0; font-size:15px;">No diff available (no history entry for this step).</p>';
  }
  html += '</div>';
  html += '</div>';

  if (historyEntry) {
    if (historyEntry?.planner_input && historyEntry.planner_input.trim()) {
      const pInput = historyEntry.planner_input;
      const pInputLong = pInput.length > 600;
      const pInputDisplay = pInputLong ? pInput.slice(0, 600) + '\n... (truncated, click to expand)' : pInput;
      html += '<div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:10px;margin-bottom:12px;">';
      html += '<h4 style="color:var(--accent-sky);margin-bottom:6px;font-size:15px;">Planner Input</h4>';
      html += `<pre id="planner-input-display" style="background:var(--bg-tertiary);padding:10px;border-radius:6px;font-size:14px;overflow:auto;max-height:300px;border:1px solid var(--border-color);color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;">${escapeHtml(pInputDisplay)}</pre>`;
      if (pInputLong) {
        html += `<button id="planner-input-expand" style="background:var(--bg-tertiary);color:var(--accent-sky);border:1px solid var(--border-color);padding:4px 10px;border-radius:4px;font-size:15px;cursor:pointer;margin-top:6px;">Show full planner input (${pInput.length} chars)</button>`;
      }
      html += '</div>';
    }

    if (historyEntry?.planner_output && historyEntry.planner_output.trim()) {
      const pOutput = historyEntry.planner_output;
      const pOutputLong = pOutput.length > 600;
      const pOutputDisplay = pOutputLong ? pOutput.slice(0, 600) + '\n... (truncated, click to expand)' : pOutput;
      html += '<div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:10px;margin-bottom:12px;">';
      html += '<h4 style="color:var(--accent-mint);margin-bottom:6px;font-size:15px;">Planner Output</h4>';
      html += `<pre id="planner-output-display" style="background:var(--bg-tertiary);padding:10px;border-radius:6px;font-size:14px;overflow:auto;max-height:300px;border:1px solid var(--border-color);color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;">${escapeHtml(pOutputDisplay)}</pre>`;
      if (pOutputLong) {
        html += `<button id="planner-output-expand" style="background:var(--bg-tertiary);color:var(--accent-mint);border:1px solid var(--border-color);padding:4px 10px;border-radius:4px;font-size:15px;cursor:pointer;margin-top:6px;">Show full planner output (${pOutput.length} chars)</button>`;
      }
      html += '</div>';
    }

    if (historyEntry?.editor_input && historyEntry.editor_input.trim()) {
      const eInput = historyEntry.editor_input;
      const eInputLong = eInput.length > 600;
      const eInputDisplay = eInputLong ? eInput.slice(0, 600) + '\n... (truncated, click to expand)' : eInput;
      html += '<div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:10px;margin-bottom:12px;">';
      html += '<h4 style="color:var(--accent-lavender);margin-bottom:6px;font-size:15px;">Editor Input</h4>';
      html += `<pre id="editor-input-display" style="background:var(--bg-tertiary);padding:10px;border-radius:6px;font-size:14px;overflow:auto;max-height:300px;border:1px solid var(--border-color);color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;">${escapeHtml(eInputDisplay)}</pre>`;
      if (eInputLong) {
        html += `<button id="editor-input-expand" style="background:var(--bg-tertiary);color:var(--accent-lavender);border:1px solid var(--border-color);padding:4px 10px;border-radius:4px;font-size:15px;cursor:pointer;margin-top:6px;">Show full editor input (${eInput.length} chars)</button>`;
      }
      html += '</div>';
    }

    if (historyEntry?.editor_output && historyEntry.editor_output.trim()) {
      const eOutput = historyEntry.editor_output;
      const eOutputLong = eOutput.length > 600;
      const eOutputDisplay = eOutputLong ? eOutput.slice(0, 600) + '\n... (truncated, click to expand)' : eOutput;
      html += '<div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:6px;padding:10px;margin-bottom:12px;">';
      html += '<h4 style="color:var(--accent-pink);margin-bottom:6px;font-size:15px;">Editor Output</h4>';
      html += `<pre id="editor-output-display" style="background:var(--bg-tertiary);padding:10px;border-radius:6px;font-size:14px;overflow:auto;max-height:300px;border:1px solid var(--border-color);color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;">${escapeHtml(eOutputDisplay)}</pre>`;
      if (eOutputLong) {
        html += `<button id="editor-output-expand" style="background:var(--bg-tertiary);color:var(--accent-pink);border:1px solid var(--border-color);padding:4px 10px;border-radius:4px;font-size:15px;cursor:pointer;margin-top:6px;">Show full editor output (${eOutput.length} chars)</button>`;
      }
      html += '</div>';
    }
  }

  diffOutput.innerHTML = html;
  diffSection.style.display = 'block';
  closeBtn.style.display = 'inline-block';

  // Diff toggle
  const toggleParent = diffOutput.querySelector('#diff-toggle-parent');
  const toggleRoot = diffOutput.querySelector('#diff-toggle-root');
  if (toggleParent && toggleRoot) {
    const diffContent = diffOutput.querySelector('#diff-content');
    function setActive(activeBtn, inactiveBtn) {
      activeBtn.classList.add('active');
      activeBtn.classList.remove('inactive');
      inactiveBtn.classList.add('inactive');
      inactiveBtn.classList.remove('active');
    }

    function showParentDiff() {
      setActive(toggleParent, toggleRoot);
      if (historyEntry?.diff_text && historyEntry.diff_text.trim()) {
        diffContent.innerHTML = renderDiffHTML(historyEntry.diff_text);
      } else {
        diffContent.innerHTML = '<p style="color:var(--text-muted); padding:4px 0; font-size:15px;">No diff available.</p>';
      }
    }

    async function showRootDiff() {
      setActive(toggleRoot, toggleParent);
      if (rootDiffCache[nodeData.id] !== undefined) {
        const cached = rootDiffCache[nodeData.id];
        diffContent.innerHTML = cached ? renderDiffHTML(cached) : '<p style="color:var(--text-muted); padding:4px 0; font-size:15px;">No changes from root.</p>';
        return;
      }
      diffContent.innerHTML = '<p style="color:var(--text-muted); padding:4px 0; font-size:15px;">Loading root diff…</p>';
      try {
        const res = await fetch(`/api/diff_from_root?node_id=${encodeURIComponent(nodeData.id)}`);
        const data = await res.json();
        if (!res.ok) {
          diffContent.innerHTML = `<p style="color:var(--accent-peach); padding:4px 0; font-size:15px;">Could not compute root diff: ${escapeHtml(data.error || res.statusText)}</p>`;
          return;
        }
        rootDiffCache[nodeData.id] = data.diff_text || '';
        diffContent.innerHTML = data.diff_text?.trim()
          ? renderDiffHTML(data.diff_text)
          : '<p style="color:var(--text-muted); padding:4px 0; font-size:15px;">No changes from root.</p>';
      } catch (e) {
        diffContent.innerHTML = `<p style="color:var(--accent-peach); padding:4px 0; font-size:15px;">Error fetching root diff.</p>`;
      }
    }

    toggleParent.addEventListener('click', showParentDiff);
    toggleRoot.addEventListener('click', showRootDiff);
  }

  const expandBtn = diffOutput.querySelector('.expand-btn');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      const pre = diffOutput.querySelector('pre');
      if (pre) pre.textContent = nodeData.eval_output;
      expandBtn.style.display = 'none';
    });
  }

  const pInputExpandBtn = diffOutput.querySelector('#planner-input-expand');
  if (pInputExpandBtn && historyEntry?.planner_input) {
    pInputExpandBtn.addEventListener('click', () => {
      const pre = diffOutput.querySelector('#planner-input-display');
      if (pre) pre.textContent = historyEntry.planner_input;
      pInputExpandBtn.style.display = 'none';
    });
  }

  const pOutputExpandBtn = diffOutput.querySelector('#planner-output-expand');
  if (pOutputExpandBtn && historyEntry?.planner_output) {
    pOutputExpandBtn.addEventListener('click', () => {
      const pre = diffOutput.querySelector('#planner-output-display');
      if (pre) pre.textContent = historyEntry.planner_output;
      pOutputExpandBtn.style.display = 'none';
    });
  }

  const eInputExpandBtn = diffOutput.querySelector('#editor-input-expand');
  if (eInputExpandBtn && historyEntry?.editor_input) {
    eInputExpandBtn.addEventListener('click', () => {
      const pre = diffOutput.querySelector('#editor-input-display');
      if (pre) pre.textContent = historyEntry.editor_input;
      eInputExpandBtn.style.display = 'none';
    });
  }

  const eOutputExpandBtn = diffOutput.querySelector('#editor-output-expand');
  if (eOutputExpandBtn && historyEntry?.editor_output) {
    eOutputExpandBtn.addEventListener('click', () => {
      const pre = diffOutput.querySelector('#editor-output-display');
      if (pre) pre.textContent = historyEntry.editor_output;
      eOutputExpandBtn.style.display = 'none';
    });
  }
}

function detailRow(label, value) {
  return `<div class="detail-row"><span class="detail-label">${label}:</span><span class="detail-value">${escapeHtml(String(value))}</span></div>`;
}
