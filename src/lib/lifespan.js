// The shared "was this person alive in year Y?" heuristic, so the timeline, the
// globe and the /alive-in pages all agree on who counts as living in a given year.
// When a death date is missing: someone born within the last 100 years is treated
// as alive today; an older birth with no death gets an assumed ~80-year lifespan.

export function endYear(p, now = new Date().getFullYear()) {
  if (p.deathYear != null) return p.deathYear;
  return now - p.birthYear <= 100 ? now : p.birthYear + 80;
}

export function aliveIn(p, year, now = new Date().getFullYear()) {
  return p.birthYear != null && p.birthYear <= year && endYear(p, now) >= year;
}
