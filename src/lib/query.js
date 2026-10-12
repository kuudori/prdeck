// Lightweight GitHub-style search query parser & matcher.
// Grammar (implicit AND between tokens):
//   token        := ['-'] (field-token | freetext)
//   field-token  := field ':' ['~'] value      ('~' = contains instead of equals)
//   field        := title | author | repo | label | status | review | ci | is | created | updated | merged
//   value        := "quoted text" | bareword
//   freetext     := bareword | "quoted text"   (substring of the PR title)
//
// Unknown fields are ignored (the token passes). Mirrors how GitHub search
// degrades gracefully rather than throwing.

const FIELDS = ['title', 'author', 'repo', 'label', 'status', 'review', 'ci', 'is', 'created', 'updated', 'merged'];

const STATIC_VALUES = {
  status: ['new', 'updated', 'seen'],
  review: ['approved', 'changes-requested', 'review-required', 'none'],
  ci: ['success', 'failure', 'pending', 'error', 'none'],
  is: ['draft'],
};

function normReview(d) {
  if (!d) return 'none';
  return String(d).toLowerCase().replace(/_/g, '-');
}

function normCi(c) {
  if (!c) return 'none';
  return String(c).toLowerCase();
}

function eq(a, b) {
  return (a || '').toLowerCase() === (b || '').toLowerCase();
}

function has(a, b) {
  return (a || '').toLowerCase().includes((b || '').toLowerCase());
}

function dateMatch(isoDate, spec) {
  if (!isoDate) return false;
  let op = '>=';
  let raw = spec;
  if (raw.startsWith('>=')) { op = '>='; raw = raw.slice(2); }
  else if (raw.startsWith('<=')) { op = '<='; raw = raw.slice(2); }
  else if (raw.startsWith('>'))  { op = '>';  raw = raw.slice(1); }
  else if (raw.startsWith('<'))  { op = '<';  raw = raw.slice(1); }
  else { op = '>='; }
  const t = new Date(isoDate).getTime();
  const f = new Date(raw).getTime();
  if (isNaN(f)) return true;
  switch (op) {
    case '>=': return t >= f;
    case '<=': return t <= f;
    case '>':  return t > f;
    case '<':  return t < f;
    default:   return true;
  }
}

const FIELD_MATCHERS = {
  title: (pr, v) => has(pr.title, v),
  author: (pr, v) => eq(pr.author, v),
  repo: (pr, v) => eq(pr.repo, v),
  label: (pr, v) => (pr.labels || []).some((l) => eq(l.name, v)),
  status: (pr, v) => eq(pr.status, v),
  review: (pr, v) => normReview(pr.reviewDecision) === v.toLowerCase(),
  ci: (pr, v) => normCi(pr.ciState) === v.toLowerCase(),
  is: (pr, v) => {
    const lv = v.toLowerCase();
    if (lv === 'draft') return !!pr.isDraft;
    return false;
  },
  created: (pr, v) => dateMatch(pr.createdAt, v),
  updated: (pr, v) => dateMatch(pr.updatedAt, v),
  merged: (pr, v) => dateMatch(pr.mergedAt, v),
};

// `field:~value` variants. Fields not listed here ignore the '~'.
const CONTAINS_MATCHERS = {
  title: FIELD_MATCHERS.title,
  author: (pr, v) => has(pr.author, v),
  repo: (pr, v) => has(pr.repo, v),
  label: (pr, v) => (pr.labels || []).some((l) => has(l.name, v)),
};

// Tokenize a query string. Returns { tokens, error } where error is
// optional ('unknown-field:foo', 'unterminated-quote', etc.).
export function tokenize(query) {
  const tokens = [];
  const errors = [];
  const s = query || '';
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const tokenStart = i;
    let neg = false;
    if (s[i] === '-') { neg = true; i++; }
    // read field-or-word up to colon, whitespace, or quote
    let head = '';
    while (i < s.length && !/[\s:"]/.test(s[i])) {
      head += s[i++];
    }
    let field = null;
    let value;
    let contains = false;
    if (s[i] === ':') {
      field = head;
      i++;
      if (s[i] === '~') { contains = true; i++; }
      // read value (quoted or bare)
      if (s[i] === '"') {
        const close = s.indexOf('"', i + 1);
        if (close === -1) {
          value = s.slice(i + 1);
          errors.push({ kind: 'unterminated-quote' });
          i = s.length;
        } else {
          value = s.slice(i + 1, close);
          i = close + 1;
        }
      } else {
        let j = i;
        while (j < s.length && !/\s/.test(s[j])) j++;
        value = s.slice(i, j);
        i = j;
      }
    } else if (s[i] === '"') {
      // freetext quoted, head must be empty
      const close = s.indexOf('"', i + 1);
      if (close === -1) {
        value = head + s.slice(i + 1);
        errors.push({ kind: 'unterminated-quote' });
        i = s.length;
      } else {
        value = head + s.slice(i + 1, close);
        i = close + 1;
      }
    } else {
      value = head;
    }
    if (field) {
      const fk = field.toLowerCase();
      if (!FIELD_MATCHERS[fk]) errors.push({ kind: 'unknown-field', field });
    }
    tokens.push({ neg, field: field ? field.toLowerCase() : null, value, contains, start: tokenStart, end: i });
  }
  return { tokens, errors };
}

function tokenPasses(tok, pr) {
  if (!tok.field && !tok.value) return true; // a lone '-'
  const fn = !tok.field
    ? FIELD_MATCHERS.title
    : (tok.contains && CONTAINS_MATCHERS[tok.field]) || FIELD_MATCHERS[tok.field];
  if (!fn) return true; // unknown field — ignore
  const hit = !!fn(pr, tok.value);
  return tok.neg ? !hit : hit;
}

export function buildQueryMatcher(query) {
  const { tokens } = tokenize(query || '');
  if (tokens.length === 0) return null;
  return (pr) => tokens.every((t) => tokenPasses(t, pr));
}

// ---- Autocomplete context ----
// Given the raw text and cursor position, return what to suggest.
//   { kind: 'field', prefix, replaceStart, replaceEnd }
//   { kind: 'value', field, prefix, replaceStart, replaceEnd, quoted }
//   null if nothing to suggest (e.g. cursor in middle of whitespace and not starting a token)
export function autocompleteContext(text, cursor) {
  const s = text || '';
  const pos = Math.max(0, Math.min(cursor ?? s.length, s.length));
  // scan back to find token start (the previous whitespace boundary,
  // but treat a quoted region as a single token)
  let inQuote = false;
  for (let k = 0; k < pos; k++) if (s[k] === '"') inQuote = !inQuote;
  let start = pos;
  while (start > 0) {
    const ch = s[start - 1];
    if (ch === '"') { inQuote = !inQuote; start--; continue; }
    if (/\s/.test(ch) && !inQuote) break;
    start--;
  }
  const tokenText = s.slice(start, pos);
  // strip leading '-' for parsing, keep replaceStart after it
  let cursorOffset = start;
  let core = tokenText;
  if (core.startsWith('-')) {
    cursorOffset += 1;
    core = core.slice(1);
  }
  const colonIdx = core.indexOf(':');
  if (colonIdx === -1) {
    return { kind: 'field', prefix: core, replaceStart: cursorOffset, replaceEnd: pos };
  }
  const field = core.slice(0, colonIdx).toLowerCase();
  let valuePart = core.slice(colonIdx + 1);
  let tilde = 0;
  if (valuePart.startsWith('~')) {
    tilde = 1;
    valuePart = valuePart.slice(1);
  }
  let quoted = false;
  if (valuePart.startsWith('"')) {
    quoted = true;
    valuePart = valuePart.slice(1);
  }
  return {
    kind: 'value',
    field,
    prefix: valuePart,
    replaceStart: cursorOffset + colonIdx + 1 + tilde + (quoted ? 1 : 0),
    replaceEnd: pos,
    quoted,
  };
}

// Get value suggestions for a field, drawing from static lists or the
// currently observed PRs.
export function suggestValues(field, prs) {
  if (STATIC_VALUES[field]) return STATIC_VALUES[field];
  const seen = new Set();
  const out = [];
  const pick = (v) => {
    if (!v) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  if (field === 'author') for (const p of prs) pick(p.author);
  else if (field === 'repo') for (const p of prs) pick(p.repo);
  else if (field === 'label') for (const p of prs) for (const l of (p.labels || [])) pick(l.name);
  out.sort();
  return out;
}

export function suggestFields(prefix, { trackCI = true } = {}) {
  const p = (prefix || '').toLowerCase();
  return FIELDS.filter((f) => f.startsWith(p) && (trackCI || f !== 'ci'));
}

// Helper to insert a suggestion into the text, returning { text, cursor }.
export function applySuggestion(text, ctx, suggestion) {
  const s = text || '';
  let insert;
  let nextCursor;
  if (ctx.kind === 'field') {
    insert = suggestion + ':';
    const before = s.slice(0, ctx.replaceStart);
    const after = s.slice(ctx.replaceEnd);
    nextCursor = (before + insert).length;
    return { text: before + insert + after, cursor: nextCursor };
  }
  // value
  const needsQuotes = /\s/.test(suggestion);
  const before = s.slice(0, ctx.replaceStart - (ctx.quoted ? 1 : 0));
  const after = s.slice(ctx.replaceEnd);
  if (needsQuotes && !ctx.quoted) {
    insert = '"' + suggestion + '" ';
  } else if (ctx.quoted) {
    // close the existing opening quote
    insert = suggestion + '" ';
    const beforeKeepQuote = s.slice(0, ctx.replaceStart);
    const result = beforeKeepQuote + suggestion + '" ';
    return { text: result + after, cursor: (result).length };
  } else {
    insert = suggestion + ' ';
  }
  const result = before + insert;
  return { text: result + after, cursor: result.length };
}
