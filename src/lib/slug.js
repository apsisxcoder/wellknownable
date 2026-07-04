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

export function personSlug(p) {
  return `${slugify(p.name)}-${p.id.toLowerCase()}`;
}
