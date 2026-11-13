// The same three color stops as Canopée's street and hexagon layers.
export function shadeColor(value) {
  if (value == null || !Number.isFinite(value)) return '#d9dddc';
  const palette = [[244,210,122],[91,163,217],[0,85,164]];
  const position = Math.max(0, Math.min(1, value)) * 2;
  const index = Math.min(1, Math.floor(position));
  const amount = position - index;
  return 'rgb(' + palette[index].map((v,c) => Math.round(v + (palette[index + 1][c] - v) * amount)).join(',') + ')';
}
