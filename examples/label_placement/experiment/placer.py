"""
Label placement algorithm.

Implement the `place_labels` function below. It takes canvas dimensions,
data point positions, and label box sizes, and returns label center positions
that minimize visual clutter.

The evaluation harness scores your placement on:
  - Overlap with connection lines between consecutive data points
  - Overlap with data points themselves
  - Overlap with other label boxes
  - Clipping by canvas edges
  - Proximity to their assigned data points
  - Stability when canvas size changes

You may use any pure-Python algorithm — greedy, optimization-based, rule-based,
or anything else. No external libraries required.
"""


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
    # TODO: Implement your label placement algorithm here.
    # Return a list of (x, y) center positions, one per data point.
    # A reasonable default: place labels above and slightly to the right
    # of each data point.
    n = len(points_x)
    offsets = [(6, -label_h // 2 - 4)] * n
    return [(points_x[i] + ox, points_y[i] + oy) for i, (ox, oy) in enumerate(offsets)]
