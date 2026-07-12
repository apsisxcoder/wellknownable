// URL slugs for people, e.g. "Albert Einstein" (Q937) -> "albert-einstein-q937".
// Ascii-folded so the URL is clean; the QID suffix guarantees uniqueness even
// when two people share a name.

export function slugify(name) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

// the founding team gets fixed, hand-picked slugs — keyed by their stable id so
// the URL never changes even if their name/title does (permanent, shareable links)
const FIXED_SLUGS = {
  "CUSTOM-APSISXCODER": "apsisxcoder",
  "CUSTOM-KEDI": "kedi",
  "CUSTOM-AVEL": "avel",
};

export function personSlug(p) {
  if (FIXED_SLUGS[p.id]) return FIXED_SLUGS[p.id];
  // real people keep the QID suffix so two sharing a name never collide
  return `${slugify(p.name)}-${p.id.toLowerCase()}`;
}
