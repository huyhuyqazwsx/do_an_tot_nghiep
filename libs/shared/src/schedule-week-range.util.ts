function parseWeekRange(value?: string | null): Set<number> | null {
  const normalized = value?.trim().replace(/[\u2013\u2014\u2212]/g, '-');
  if (!normalized) return null;

  const weeks = new Set<number>();
  const tokens = normalized.split(/[;,]/);

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (!token) continue;

    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        return null;
      }

      const from = Math.min(start, end);
      const to = Math.max(start, end);
      for (let week = from; week <= to; week++) {
        weeks.add(week);
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      weeks.add(Number(token));
      continue;
    }

    return null;
  }

  return weeks.size > 0 ? weeks : null;
}

export function weekRangesOverlap(
  a?: string | null,
  b?: string | null,
): boolean {
  const aWeeks = parseWeekRange(a);
  const bWeeks = parseWeekRange(b);

  if (!aWeeks || !bWeeks) return true;

  for (const week of aWeeks) {
    if (bWeeks.has(week)) return true;
  }

  return false;
}
