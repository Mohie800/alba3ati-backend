// Shared parsing for admin list endpoints (paging, search, date range, sort)

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function paging(query, defaultLimit = 20) {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || defaultLimit, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

// Case-insensitive "contains" regex, or null for an empty term
function containsRegex(term) {
  const t = typeof term === "string" ? term.trim() : "";
  return t ? { $regex: escapeRegex(t), $options: "i" } : null;
}

// from/to are YYYY-MM-DD; `to` is inclusive of that whole day
function dateRange(from, to) {
  const range = {};
  if (from && !isNaN(Date.parse(from))) range.$gte = new Date(from);
  if (to && !isNaN(Date.parse(to))) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    range.$lt = end;
  }
  return Object.keys(range).length ? range : null;
}

// sort=field or sort=-field, limited to `allowed` (api name -> db path)
function sortSpec(sort, allowed, fallback) {
  if (typeof sort === "string" && sort) {
    const desc = sort.startsWith("-");
    const field = allowed[desc ? sort.slice(1) : sort];
    if (field) return { [field]: desc ? -1 : 1, _id: desc ? -1 : 1 };
  }
  return fallback;
}

module.exports = { escapeRegex, paging, containsRegex, dateRange, sortSpec };
