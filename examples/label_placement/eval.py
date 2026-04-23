"""
Evaluation harness for the label placement problem.

Scores label placements on:
  1. Line overlap — labels intersecting connection lines between consecutive points
  2. Point overlap — labels intersecting their own data point (radius 8px)
  3. Label overlap — labels intersecting each other
  4. Canvas clipping — label boxes extending beyond canvas edges
  5. Proximity — average distance from label centers to their data points
  6. Stability — how much label positions change when canvas size changes

Run: python eval.py
Output: JSON with score, description, and per-metric breakdown.
"""

import json
import math
import sys
from itertools import combinations

# ---------------------------------------------------------------------------
# Test scenarios: (canvas_w, canvas_h) pairs
# The baseline scenario is used for the primary score; others test stability.
# ---------------------------------------------------------------------------

BASELINE_SCENARIO = (800, 600)

STABILITY_SCENARIOS = [
    (600, 450),
    (1000, 750),
    (400, 300),
    (1200, 900),
    (1400, 1000),
]

# Fixed data: sinusoidal pattern
NUM_POINTS = 10
LABEL_W = 40
LABEL_H = 20
POINT_RADIUS = 8

BASELINE_POINTS_X = [
    50.0, 94.4, 138.8, 183.3, 227.7,
    272.1, 316.5, 361.0, 405.4, 449.8,
]
BASELINE_POINTS_Y = [
    400.0, 377.6, 340.0, 290.0, 230.0,
    167.6, 110.0, 60.0, 22.4, 0.0,
]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def rect_overlap_area(x1, y1, w1, h1, x2, y2, w2, h2):
    """Return overlapping area between two axis-aligned rectangles given center coords."""
    left1, right1 = x1 - w1 / 2, x1 + w1 / 2
    bottom1, top1 = y1 - h1 / 2, y1 + h1 / 2
    left2, right2 = x2 - w2 / 2, x2 + w2 / 2
    bottom2, top2 = y2 - h2 / 2, y2 + h2 / 2

    overlap_x = max(0, min(right1, right2) - max(left1, left2))
    overlap_y = max(0, min(top1, top2) - max(bottom1, bottom2))
    return overlap_x * overlap_y


def point_in_rect(px, py, cx, cy, w, h):
    """Check if a point is inside a rectangle (given center coords)."""
    return (cx - w / 2 <= px <= cx + w / 2 and
            cy - h / 2 <= py <= cy + h / 2)


def point_in_rect_expanded(px, py, cx, cy, w, h, radius):
    """Check if a point is inside a rectangle expanded by a radius."""
    return (cx - w / 2 - radius <= px <= cx + w / 2 + radius and
            cy - h / 2 - radius <= py <= cy + h / 2 + radius)


def segment_rect_intersect(px1, py1, px2, py2, cx, cy, w, h):
    """Check if a line segment intersects a rectangle.

    Uses the separating axis approach: if the segment is entirely on one side
    of any edge of the rectangle, there's no intersection.
    """
    # Quick check: if either endpoint is inside, intersect
    if point_in_rect(px1, py1, cx, cy, w, h):
        return True
    if point_in_rect(px2, py2, cx, cy, w, h):
        return True

    # Check intersection with each edge of the rectangle
    rect_edges = [
        (cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2),  # top
        (cx - w / 2, cy + h / 2, cx + w / 2, cy + h / 2),  # bottom
        (cx - w / 2, cy - h / 2, cx - w / 2, cy + h / 2),  # left
        (cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2),  # right
    ]

    for x1, y1, x2, y2 in rect_edges:
        if _segments_intersect(px1, py1, px2, py2, x1, y1, x2, y2):
            return True
    return False


def _segments_intersect(x1, y1, x2, y2, x3, y3, x4, y4):
    """Check if two line segments intersect."""
    def ccw(ax, ay, bx, by, cx, cy):
        return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax)

    d1 = ccw(x3, y3, x4, y4, x1, y1)
    d2 = ccw(x3, y3, x4, y4, x2, y2)
    d3 = ccw(x1, y1, x2, y2, x3, y3)
    d4 = ccw(x1, y1, x2, y2, x4, y4)

    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True

    # Collinear cases
    if d1 == 0 and _on_segment(x3, y3, x4, y4, x1, y1):
        return True
    if d2 == 0 and _on_segment(x3, y3, x4, y4, x2, y2):
        return True
    if d3 == 0 and _on_segment(x1, y1, x2, y2, x3, y3):
        return True
    if d4 == 0 and _on_segment(x1, y1, x2, y2, x4, y4):
        return True

    return False


def _on_segment(x1, y1, x2, y2, px, py):
    """Check if point (px, py) lies on segment (x1,y1)-(x2,y2)."""
    return (min(x1, x2) <= px <= max(x1, x2) and
            min(y1, y2) <= py <= max(y1, y2))


# ---------------------------------------------------------------------------
# Scoring functions
# ---------------------------------------------------------------------------

def score_line_overlaps(labels, points_x, points_y):
    """Score for label boxes intersecting connection lines.

    For each label i and each line segment between consecutive points,
    check if the label rectangle intersects the segment.
    Returns normalized score in [0, 1].
    """
    n = len(labels)
    max_segments = max(n - 1, 1) * n  # each label tested against all segments
    total = 0.0
    for i in range(n):
        lx, ly = labels[i]
        for j in range(len(points_x) - 1):
            if segment_rect_intersect(
                points_x[j], points_y[j],
                points_x[j + 1], points_y[j + 1],
                lx, ly, LABEL_W, LABEL_H,
            ):
                total += 1.0
    return total / max_segments


def score_point_overlaps(labels, points_x, points_y):
    """Score for label boxes overlapping their own data points.

    Each label i is checked against data point i with expanded radius.
    Returns normalized score in [0, 1].
    """
    n = len(labels)
    total = 0.0
    for i in range(n):
        lx, ly = labels[i]
        if point_in_rect_expanded(points_x[i], points_y[i], lx, ly, LABEL_W, LABEL_H, POINT_RADIUS):
            total += 1.0
    return total / n


def score_label_overlaps(labels):
    """Score for label boxes overlapping each other.

    For each pair of labels, compute normalized overlap area.
    Returns score in [0, 1].
    """
    n = len(labels)
    if n < 2:
        return 0.0
    total = 0.0
    count = 0
    for i, j in combinations(range(n), 2):
        lx1, ly1 = labels[i]
        lx2, ly2 = labels[j]
        overlap = rect_overlap_area(lx1, ly1, LABEL_W, LABEL_H,
                                             lx2, ly2, LABEL_W, LABEL_H)
        total += overlap / (LABEL_W * LABEL_H)
        count += 1
    return total / count


def score_clipping(labels, canvas_w, canvas_h):
    """Score for label boxes clipped by canvas edges.

    Measures fraction of each label box that falls outside the canvas.
    Returns score in [0, 1].
    """
    n = len(labels)
    total = 0.0
    for lx, ly in labels:
        # Clip rectangle to canvas
        left = max(0, lx - LABEL_W / 2)
        right = min(canvas_w, lx + LABEL_W / 2)
        bottom = max(0, ly - LABEL_H / 2)
        top = min(canvas_h, ly + LABEL_H / 2)

        visible_w = max(0, right - left)
        visible_h = max(0, top - bottom)
        visible_area = visible_w * visible_h
        total += 1.0 - (visible_area / (LABEL_W * LABEL_H))
    return total / n


def score_proximity(labels, points_x, points_y):
    """Score for average distance from label centers to data points.

    Lower distance = better. Returns score in [0, 1] where 1 = perfect (on point).
    Uses Tanh-based normalization with scale=30px.
    """
    n = len(labels)
    total_dist = 0.0
    for i in range(n):
        dx = labels[i][0] - points_x[i]
        dy = labels[i][1] - points_y[i]
        total_dist += math.sqrt(dx * dx + dy * dy)
    avg_dist = total_dist / n
    return 1.0 - math.tanh(avg_dist / 30.0)


def score_stability(place_labels_fn, points_x, points_y):
    """Score for stability of label positions across canvas sizes.

    Runs place_labels on multiple canvas sizes, then computes normalized
    displacement of each label from its baseline position.
    Returns score in [0, 1] where 1 = perfectly stable.
    """
    # Get baseline positions
    try:
        baseline_labels = place_labels_fn(*BASELINE_SCENARIO, points_x, points_y, LABEL_W, LABEL_H)
    except Exception:
        return 0.0

    if len(baseline_labels) != len(points_x):
        return 0.0

    total_disp = 0.0
    count = 0
    for cw, ch in STABILITY_SCENARIOS:
        try:
            labels = place_labels_fn(cw, ch, points_x, points_y, LABEL_W, LABEL_H)
        except Exception:
            continue

        if len(labels) != len(points_x):
            continue

        for i in range(len(points_x)):
            dx = (labels[i][0] - baseline_labels[i][0]) / cw
            dy = (labels[i][1] - baseline_labels[i][1]) / ch
            total_disp += math.sqrt(dx * dx + dy * dy)
            count += 1

    if count == 0:
        return 0.0

    avg_disp = total_disp / count
    # Normalize: tanh with scale=0.1 so that avg_disp=0.1 -> ~0.5 penalty
    return math.tanh(1.0 - avg_disp / 0.1)


# ---------------------------------------------------------------------------
# Main evaluation
# ---------------------------------------------------------------------------

def evaluate():
    """Run the full evaluation and return the score dict."""
    from experiment.placer import place_labels

    px = BASELINE_POINTS_X
    py = BASELINE_POINTS_Y
    cw, ch = BASELINE_SCENARIO

    labels = place_labels(cw, ch, px, py, LABEL_W, LABEL_H)

    if len(labels) != len(px):
        return {
            "score": 999.0,
            "description": f"Wrong number of labels: got {len(labels)}, expected {len(px)}",
            "metrics": {"error": "label count mismatch"},
        }

    # Compute individual scores
    line_overlap = score_line_overlaps(labels, px, py)
    point_overlap = score_point_overlaps(labels, px, py)
    label_overlap = score_label_overlaps(labels)
    clipping = score_clipping(labels, cw, ch)
    proximity = score_proximity(labels, px, py)
    stability = score_stability(place_labels, px, py)

    # Combined score: overlaps and clipping are bad (minimize),
    # proximity and stability are good (maximize, so subtract)
    score = (
        1.5 * line_overlap
        + 1.0 * point_overlap
        + 0.5 * label_overlap
        + 2.0 * clipping
        - 0.5 * proximity
        - 0.3 * stability
    )

    description = (
        f"line_overlap={line_overlap:.3f} "
        f"point_overlap={point_overlap:.3f} "
        f"label_overlap={label_overlap:.3f} "
        f"clipping={clipping:.3f} "
        f"proximity={proximity:.3f} "
        f"stability={stability:.3f}"
    )

    return {
        "score": round(score, 6),
        "description": description,
        "metrics": {
            "line_overlap": round(line_overlap, 6),
            "point_overlap": round(point_overlap, 6),
            "label_overlap": round(label_overlap, 6),
            "clipping": round(clipping, 6),
            "proximity": round(proximity, 6),
            "stability": round(stability, 6),
        },
    }


if __name__ == "__main__":
    result = evaluate()
    output = {"score": result["score"], "description": result["description"]}
    print(json.dumps(output))
    sys.exit(0)
