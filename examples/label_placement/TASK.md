# Problem: Optimal Label Placement for Line Charts

## Background

When visualizing data with many points, labeling each point is essential for readability. But naive label placement creates visual clutter: labels overlap each other, cover data points, intersect connection lines, or get clipped by canvas edges. This is a well-known problem in information visualization with real research behind it (force-directed layouts, greedy displacement, integer programming approaches).

The challenge: given a set of data points connected by lines and rectangular label boxes, find positions for the labels that minimize all sources of visual clutter simultaneously.

## Objective

Implement `place_labels(canvas_w, canvas_h, points_x, points_y, label_w, label_h)` that returns label center positions optimizing a composite score of:

1. **Line overlap** — labels should not intersect the lines connecting consecutive data points (heavily penalized)
2. **Point overlap** — labels should not cover their own data point (radius 8px)
3. **Label-label overlap** — labels should not overlap each other
4. **Canvas clipping** — labels should stay within canvas bounds
5. **Proximity** — labels should be close to their assigned data point
6. **Stability** — label positions should remain consistent when canvas size changes (important for responsive design)

## Files You Can Modify

- `experiment/placer.py` — the label placement implementation

You may **NOT** modify:
- `eval.py` — the evaluation harness

## Interface

Your function must have this exact signature:

```python
def place_labels(canvas_w, canvas_h, points_x, points_y, label_w, label_h):
    """Place label boxes near data points to minimize visual clutter.

    Args:
        canvas_w: Canvas width in pixels (int)
        canvas_h: Canvas height in pixels (int)
        points_x: List of x positions of data points in pixels (list of float)
        points_y: List of y positions of data points in pixels (list of float)
        label_w: Width of each label box in pixels (int)
        label_h: Height of each label box in pixels (int)

    Returns:
        List of (x, y) tuples representing label box centers in pixels.
        Must have the same length as points_x/points_y.
    """
```

## Test Configuration

- **10 data points** arranged in a sinusoidal pattern
- **Label boxes**: 40x20 pixels each
- **Baseline canvas**: 800x600 pixels
- **Stability test**: 5 additional canvas sizes (600x450, 1000x750, 400x300, 1200x900, 1400x1000)

## Scoring

```
score = 1.5 * line_overlap + 1.0 * point_overlap + 0.5 * label_overlap
        + 2.0 * clipping - 0.5 * proximity - 0.3 * stability
```

- Overlap/clipping terms: 0 = no issue, 1 = fully overlapped/clipped
- Proximity: 1 = on top of point, 0 = very far
- Stability: 1 = identical positions across all canvas sizes, 0 = highly variable
- **Lower is better** (optimization mode: min)
- Current baseline: score ~0.87 (naive above-right placement)

## Constraints

1. **Libraries**: Only Python standard library. No numpy, no matplotlib, no optimization libraries.
2. **Must handle arbitrary canvas sizes**: The function is tested on 6 different canvas dimensions.
3. **Must return exactly N labels**: One per data point, no more, no fewer.
4. **Must be deterministic**: Same inputs always produce same outputs.

## Hints

- **Greedy displacement**: Place labels initially, then iteratively push overlapping labels apart
- **Force-directed layout**: Treat labels as particles with repulsion forces; simulate for a few iterations
- **Side assignment**: Try both above/below and left/right placements, pick the one with less overlap
- **Coordinate transformation**: Normalize to [0,1] space, optimize there, then scale back
- **Iterative optimization**: Start from a heuristic placement, then use coordinate descent to reduce the score
- **Trade-off awareness**: A label slightly overlapping a line might be worth it to avoid overlapping two other labels
- **Stability trick**: If your placement depends only on relative positions (ratios to canvas size), it will be inherently stable
