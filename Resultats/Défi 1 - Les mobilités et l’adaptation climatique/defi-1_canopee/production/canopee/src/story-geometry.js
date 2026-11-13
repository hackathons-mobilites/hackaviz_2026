const EARTH_RADIUS_METERS = 6371008.8;
const RADIANS_PER_DEGREE = Math.PI / 180;
const METERS_PER_LATITUDE_DEGREE = EARTH_RADIUS_METERS * RADIANS_PER_DEGREE;
// One local metric frame for Paris, shared by every example. Using a different
// latitude or zoom per route would make the visual distances incomparable.
const METERS_PER_LONGITUDE_DEGREE =
  METERS_PER_LATITUDE_DEGREE * Math.cos(48.86 * RADIANS_PER_DEGREE);

/**
 * One metric scale shared by every example in the selected season.
 * Omitting hour keeps both scale and center stable through a day's variants.
 * A specified hour limits the fit to that frame for standalone callers.
 * Without a context, every variant is included for callers needing one fixed
 * frame across the complete dataset. Road context never determines the zoom.
 *
 * Returns { pixelsPerMeter, scaleBar, frame, forExample(id) }.
 * forExample returns { project([longitude, latitude]), bounds, center };
 * bounds is the full viewport's [west, south, east, north] extent.
 * SVG coordinates are pixels in the requested viewBox, not physical CSS pixels.
 */
export function createRouteProjections(
  examples,
  { width = 600, height = 420, padding, season, hour } = {},
) {
  const contextual = season !== undefined || hour !== undefined;
  if (hour !== undefined && season === undefined) {
    throw new Error("An hour requires a season");
  }
  // The context view has no heading inside the SVG. Reserve the bottom strip
  // for the scale bar, including the full endpoint marker above its cartouche.
  const insets = typeof padding === "number"
    ? { top: padding, right: padding, bottom: padding, left: padding }
    : { top: contextual ? 32 : 48, right: 48, bottom: contextual ? 72 : 48, left: 48, ...padding };
  const drawingWidth = width - insets.left - insets.right;
  const drawingHeight = height - insets.top - insets.bottom;
  if (!examples.length || drawingWidth <= 0 || drawingHeight <= 0) {
    throw new Error("Route projections need examples and a positive drawing area");
  }
  const viewportCenter = [insets.left + drawingWidth / 2, insets.top + drawingHeight / 2];

  const extents = examples.map((example) => {
    const comparisons = contextual
      ? example.comparisons.filter(comparison => comparison.season === season && (hour === undefined || comparison.hour === hour))
      : example.comparisons;
    const points = comparisons.flatMap((comparison) => [
      ...comparison.shortest.path,
      ...comparison.preferred.path,
    ]);
    if (!points.length) throw new Error("Route has no path: " + example.id);
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const [longitude, latitude] of points) {
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
    }
    return {
      id: example.id,
      center: [(west + east) / 2, (south + north) / 2],
      widthMeters: (east - west) * METERS_PER_LONGITUDE_DEGREE,
      heightMeters: (north - south) * METERS_PER_LATITUDE_DEGREE,
    };
  });

  const pixelsPerMeter = Math.min(
    ...extents.flatMap(({ widthMeters, heightMeters }) => [
      drawingWidth / Math.max(widthMeters, 1),
      drawingHeight / Math.max(heightMeters, 1),
    ]),
  );
  const longitudeScale = pixelsPerMeter * METERS_PER_LONGITUDE_DEGREE;
  const latitudeScale = pixelsPerMeter * METERS_PER_LATITUDE_DEGREE;
  const projections = new Map(extents.map(({ id, center }) => {
    const [longitude, latitude] = center;
    return [id, {
      center,
      bounds: [
        longitude - viewportCenter[0] / longitudeScale,
        latitude - (height - viewportCenter[1]) / latitudeScale,
        longitude + (width - viewportCenter[0]) / longitudeScale,
        latitude + viewportCenter[1] / latitudeScale,
      ],
      project: ([lon, lat]) => [
        viewportCenter[0] + (lon - longitude) * longitudeScale,
        viewportCenter[1] - (lat - latitude) * latitudeScale,
      ],
    }];
  }));

  return {
    pixelsPerMeter,
    scaleBar: { meters: 200, pixels: 200 * pixelsPerMeter },
    frame: { width, height, insets, center: viewportCenter },
    forExample(id) {
      const projection = projections.get(id);
      if (!projection) throw new Error("Unknown route example: " + id);
      return projection;
    },
  };
}
