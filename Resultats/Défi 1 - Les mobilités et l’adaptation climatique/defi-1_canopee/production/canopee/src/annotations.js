export const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

export function band(fraction) {
  if (fraction == null || fraction < 0) return "inconnu";
  if (fraction >= 0.6) return "ombre";
  if (fraction <= 0.35) return "soleil";
  return "mixte";
}

function mean(values) {
  const ok = values.filter((v) => v >= 0);
  if (!ok.length) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

function weightedShade(segs) {
  return HOURS.map((_, i) => {
    let num = 0;
    let den = 0;
    for (const s of segs) {
      const v = s.properties.shade[i];
      if (v < 0) continue;
      num += v * s.properties.len;
      den += s.properties.len;
    }
    return den ? num / den : -1;
  });
}

export function streetRows(features) {
  const groups = new Map();
  for (const feature of features) {
    const name = feature.properties.name;
    if (!name) continue;
    let group = groups.get(name);
    if (!group) {
      group = { name, segs: [], len: 0, imp: 9, velo: false, bridge: false };
      groups.set(name, group);
    }
    group.segs.push(feature);
    group.len += feature.properties.len;
    group.imp = Math.min(group.imp, feature.properties.imp || 9);
    group.velo = group.velo || feature.properties.velo === 1;
    group.bridge = group.bridge || feature.properties.bridge === 1;
  }

  const rows = [];
  for (const group of groups.values()) {
    if (group.len < 80) continue;
    const shade = weightedShade(group.segs);
    const hot = mean([12, 13, 14, 15, 16, 17].map((h) => shade[HOURS.indexOf(h)]));
    const morning = mean([8, 9, 10].map((h) => shade[HOURS.indexOf(h)]));
    const late = mean([16, 17, 18].map((h) => shade[HOURS.indexOf(h)]));
    if (hot == null || morning == null || late == null) continue;
    let longest = group.segs[0];
    for (const seg of group.segs) {
      if (seg.properties.len > longest.properties.len) longest = seg;
    }
    rows.push({
      name: group.name,
      len: group.len,
      imp: group.imp,
      velo: group.velo,
      bridge: group.bridge,
      shade,
      hot,
      morning,
      late,
      swing: late - morning,
      lon: longest.properties.mid[0],
      lat: longest.properties.mid[1],
    });
  }
  return rows;
}

function named(rows, name) {
  return rows.find((row) => row.name === name) || null;
}

export function chooseAnnotations(features) {
  const rows = streetRows(features);
  const stay =
    named(rows, "Rue de la Huchette") ||
    [...rows].filter((r) => r.hot >= 0.55 && r.len >= 120).sort((a, b) => b.hot - a.hot)[0] ||
    null;
  const cross =
    named(rows, "Boulevard Saint-Michel") ||
    [...rows].filter((r) => r.hot <= 0.4 && r.len >= 100).sort((a, b) => a.hot - b.hot)[0] ||
    null;
  const swing =
    named(rows, "Rue de Lutèce") ||
    [...rows].filter((r) => r.name !== stay?.name && r.name !== cross?.name && Math.abs(r.swing) >= 0.2)[0] ||
    null;
  const table = [...rows].sort((a, b) => b.len - a.len).slice(0, 8);
  return { stay, cross, swing, table };
}

export function pct(value) {
  if (value == null || value < 0) return "—";
  return `${Math.round(value * 100)}\u202f%`;
}

function windowMean(row, from, to) {
  const values = [];
  for (let hour = from; hour <= to; hour++) values.push(row.shade[HOURS.indexOf(hour)]);
  const ok = values.filter((v) => v >= 0);
  if (!ok.length) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

export function advice(row, kind, hour) {
  const now = row.shade[HOURS.indexOf(hour)];
  const nowPct = pct(now);
  const state = band(now);
  const tag = state === "ombre" ? "À l’ombre" : state === "soleil" ? "Au soleil" : "Partagé";
  const bike = row.velo ? " Une bande cyclable y est indiquée." : "";
  if (kind === "stay") {
    return {
      tag,
      state,
      text: `${row.name}. À ${hour}\u00a0h, ${nowPct} de l’axe est à l’ombre. De 12\u00a0h à 17\u00a0h, la moyenne est ${pct(windowMean(row, 12, 17))} : on peut y rester.${bike}`,
    };
  }
  if (kind === "cross") {
    return {
      tag,
      state,
      text: `${row.name}. À ${hour}\u00a0h, ${nowPct} de l’axe est à l’ombre. De 12\u00a0h à 16\u00a0h, la moyenne tombe à ${pct(windowMean(row, 12, 16))} : on traverse, on ne s’attarde pas.${bike}`,
    };
  }
  return {
    tag,
    state,
    text: `${row.name}. ${pct(row.morning)} d’ombre entre 8\u00a0h et 10\u00a0h, ${pct(row.late)} entre 16\u00a0h et 18\u00a0h. À ${hour}\u00a0h\u00a0: ${nowPct}.${bike}`,
  };
}
