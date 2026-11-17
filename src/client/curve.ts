/** A shape-preserving cubic: the path never creates a new extremum between samples. */
export function curvePath(points: readonly (readonly [number, number])[]): string {
  if (!points.length) return ''
  const slopes = points.slice(1).map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0]))
  const tangent = points.map((_, i) => {
    if (!i) return slopes[0] ?? 0
    if (i === points.length - 1) return slopes[i - 1]
    const a = slopes[i - 1], b = slopes[i]
    return a * b <= 0 ? 0 : 2 * a * b / (a + b)
  })
  return points.map((p, i) => {
    if (!i) return 'M' + p.join(',')
    const previous = points[i - 1], h = (p[0] - previous[0]) / 3
    return 'C' + [previous[0] + h, previous[1] + tangent[i - 1] * h, p[0] - h, p[1] - tangent[i] * h, ...p].join(',')
  }).join(' ')
}
