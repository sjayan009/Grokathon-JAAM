/** Pure cursor motion. The tip is the coordinate we publish; the body is drawn
 * to the left of the tip so a parked pointer does not cover the passage. */

export const FOLLOW_OFFSET = Object.freeze({ x: 18, y: 12 });
export const AIM_MARGIN_PX = 8;
export const BODY_WIDTH_PX = 26;
export const BODY_ABOVE_PX = 9;
export const BODY_BELOW_PX = 9;

export function followOffsetDistance(offset = FOLLOW_OFFSET) {
  return Math.hypot(offset.x, offset.y);
}

export function followPoint(pointer, offset = FOLLOW_OFFSET) {
  return { x: pointer.x + offset.x, y: pointer.y + offset.y };
}

/** Tip sits just outside the target's left edge, vertically centered. */
export function aimPoint(rect, margin = AIM_MARGIN_PX) {
  const height = Number.isFinite(rect?.height) ? rect.height : 0;
  return {
    x: rect.left - margin,
    y: rect.top + height / 2,
  };
}

export function cursorBodyBounds(tip, {
  width = BODY_WIDTH_PX,
  above = BODY_ABOVE_PX,
  below = BODY_BELOW_PX,
} = {}) {
  return {
    left: tip.x - width,
    top: tip.y - above,
    right: tip.x,
    bottom: tip.y + below,
  };
}

export function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function passageRect(rect) {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
}

/** True when the drawn cursor body overlaps the passage rectangle. */
export function bodyCoversPassage(tip, rect) {
  return rectsIntersect(cursorBodyBounds(tip), passageRect(rect));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function easeOutCubic(t) {
  const clamped = Math.min(1, Math.max(0, t));
  const u = 1 - clamped;
  return 1 - u * u * u;
}

export function glideDurationMs(from, to, {
  reducedMotion = false,
  min = 180,
  max = 640,
  pxPerMs = 1.15,
} = {}) {
  if (reducedMotion) return 0;
  const px = distance(from, to);
  return Math.round(Math.max(min, Math.min(max, px / pxPerMs)));
}

export function glidePosition(from, to, elapsedMs, durationMs) {
  if (!(durationMs > 0)) return { x: to.x, y: to.y, done: true };
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const point = lerp(from, to, easeOutCubic(t));
  return { x: point.x, y: point.y, done: t >= 1 };
}

/** Exponential catch-up so the follower eases instead of snapping to the pointer. */
export function followStep(current, desired, dtMs, tauMs = 70) {
  if (!(dtMs > 0)) return { x: current.x, y: current.y };
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return lerp(current, desired, alpha);
}

export function isRectVisible(rect, viewport, min = 2) {
  if (!rect || !(rect.width >= min) || !(rect.height >= min)) return false;
  const height = viewport?.height ?? 0;
  const width = viewport?.width ?? 0;
  if (rect.bottom != null && rect.top != null) {
    if (rect.bottom <= 0 || rect.top >= height) return false;
  } else if (rect.top >= height || rect.top + rect.height <= 0) {
    return false;
  }
  if (rect.right != null && rect.left != null) {
    if (rect.right <= 0 || rect.left >= width) return false;
  } else if (rect.left >= width || rect.left + rect.width <= 0) {
    return false;
  }
  return true;
}
