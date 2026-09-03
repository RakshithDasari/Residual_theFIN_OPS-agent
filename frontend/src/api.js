const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001'

export const BATCH_LIMIT = 55

export const CAUSE_LABELS = {
  mdr_fee: 'Processing fee',
  gst_on_fee: 'GST on processing fee',
  tds: 'TDS withheld',
  partial_refund: 'Partial refund',
  fx_markup: 'Currency conversion markup',
  in_transit: 'In transit',
  dispute_hold: 'Held for dispute',
  rounding_drift: 'Rounding drift',
  utr_mismatch: 'Reference mismatch',
  unresolved: 'Unresolved',
}

export const STATUS_TONES = {
  matched: 'success',
  explained: 'info',
  in_transit: 'muted',
  unresolved: 'danger',
}

export const EMPTY_SUMMARY = {
  total_records: 0,
  matched_records: 0,
  explained_records: 0,
  in_transit_records: 0,
  unresolved_records: 0,
  needs_attention: 0,
  match_rate: 0,
  pair_rate: 0,
  exception_categories: {},
}

export function causeLabel(cause) {
  return CAUSE_LABELS[cause] ?? cause?.replaceAll('_', ' ') ?? '—'
}

export function formatCurrency(paise) {
  if (paise == null) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(paise / 100)
}

export function formatPercent(value) {
  return `${(value ?? 0).toFixed(1)}%`
}

async function get(path) {
  const response = await fetch(`${API_BASE}${path}`)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || `Request failed (${response.status})`)
  }
  return payload
}

export function fetchBatch(limit = BATCH_LIMIT) {
  return get(`/batch?limit=${limit}`)
}

export function fetchStatus() {
  return get('/status')
}

export function fetchRecord(recordId, { live = false } = {}) {
  return get(`/record/${encodeURIComponent(recordId)}${live ? '?live=true' : ''}`)
}

export async function askQuestion(query, limit = BATCH_LIMIT, history = []) {
  const response = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit, history }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.detail || payload.message || `Request failed (${response.status})`)
  }
  return payload
}

// The server builds the CSV so the columns cannot drift from the API, and so quoting is
// correct for explanations containing commas. Navigating to it lets the browser handle
// the download and read the filename off Content-Disposition.
export function downloadCsv(limit = BATCH_LIMIT) {
  window.location.assign(`${API_BASE}/batch.csv?limit=${limit}`)
}
