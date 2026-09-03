import { useMemo, useState } from 'react'
import { causeLabel, downloadCsv, formatCurrency, STATUS_TONES } from '../api'
import RecordDrawer from '../components/RecordDrawer'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function StatusPill({ status }) {
  const map = { matched: 'pill-green', explained: 'pill-amber', in_transit: 'pill-amber', unresolved: 'pill-red' }
  const cls = map[status] ?? 'pill-grey'
  const label = { matched: 'Matched', explained: 'Explained', in_transit: 'In Transit', unresolved: 'Unmatched' }
  return <span className={`ldg-pill ${cls}`}>{label[status] ?? status}</span>
}

function DiffBadge({ expected, actual }) {
  if (actual == null) return <span className="ldg-diff ldg-diff--none">—</span>
  const diff = actual - expected
  if (diff === 0) return <span className="ldg-diff ldg-diff--ok">✓</span>
  const pct = Math.abs(diff / expected * 100).toFixed(1)
  return (
    <span className={`ldg-diff ${diff < 0 ? 'ldg-diff--neg' : 'ldg-diff--pos'}`}>
      {diff < 0 ? '-' : '+'}{formatCurrency(Math.abs(diff))} ({pct}%)
    </span>
  )
}

// ── KPI bar ───────────────────────────────────────────────────────────────────

function KpiBar({ records }) {
  const total = records.length
  const matched = records.filter(r => r.status === 'matched').length
  const explained = records.filter(r => r.status === 'explained').length
  const inTransit = records.filter(r => r.status === 'in_transit').length
  const unmatched = records.filter(r => !r.settlement_id).length
  const flagged = records.filter(r => r.status === 'unresolved').length
  // "Reconciled" = matched + explained (paired and accounted for)
  const reconciled = matched + explained
  const totalExp = records.reduce((s, r) => s + r.expected_amount_paise, 0)
  const totalSettled = records.reduce((s, r) => s + (r.actual_amount_paise ?? 0), 0)
  const netDiff = totalSettled - totalExp

  return (
    <div className="ldg-kpi-bar">
      <div className="ldg-kpi">
        <span className="ldg-kpi-label">Total Records</span>
        <strong className="ldg-kpi-value">{total}</strong>
        <span className="ldg-kpi-sub">Merchant {total} · Gateway {records.filter(r => r.settlement_id).length}</span>
      </div>
      <div className="ldg-kpi ldg-kpi--green">
        <span className="ldg-kpi-label">Reconciled</span>
        <strong className="ldg-kpi-value">{reconciled}</strong>
        <div className="ldg-kpi-bar-track">
          <span style={{ width: `${(reconciled / total) * 100}%` }} className="ldg-kpi-fill ldg-kpi-fill--green" />
        </div>
        <span className="ldg-kpi-sub">{((reconciled / total) * 100).toFixed(1)}% · {matched} matched, {explained} explained</span>
      </div>
      <div className="ldg-kpi ldg-kpi--amber">
        <span className="ldg-kpi-label">In Transit</span>
        <strong className="ldg-kpi-value">{inTransit}</strong>
        <div className="ldg-kpi-bar-track">
          <span style={{ width: `${(inTransit / total) * 100}%` }} className="ldg-kpi-fill ldg-kpi-fill--amber" />
        </div>
        <span className="ldg-kpi-sub">{((inTransit / total) * 100).toFixed(1)}%</span>
      </div>
      <div className="ldg-kpi ldg-kpi--red">
        <span className="ldg-kpi-label">Unmatched</span>
        <strong className="ldg-kpi-value">{unmatched}</strong>
        <div className="ldg-kpi-bar-track">
          <span style={{ width: `${(unmatched / total) * 100}%` }} className="ldg-kpi-fill ldg-kpi-fill--red" />
        </div>
        <span className="ldg-kpi-sub">{((unmatched / total) * 100).toFixed(1)}%</span>
      </div>
      <div className="ldg-kpi ldg-kpi--red">
        <span className="ldg-kpi-label">Flagged</span>
        <strong className="ldg-kpi-value">{flagged}</strong>
        <div className="ldg-kpi-bar-track">
          <span style={{ width: `${(flagged / total) * 100}%` }} className="ldg-kpi-fill ldg-kpi-fill--red" />
        </div>
        <span className="ldg-kpi-sub">{((flagged / total) * 100).toFixed(1)}%</span>
      </div>
      <div className="ldg-kpi-divider" />
      <div className="ldg-kpi">
        <span className="ldg-kpi-label">Total Expected</span>
        <strong className="ldg-kpi-value ldg-kpi-value--lg">{formatCurrency(totalExp)}</strong>
      </div>
      <div className="ldg-kpi">
        <span className="ldg-kpi-label">Total Settled</span>
        <strong className="ldg-kpi-value ldg-kpi-value--lg">{formatCurrency(totalSettled)}</strong>
      </div>
      <div className="ldg-kpi">
        <span className="ldg-kpi-label">Net Difference</span>
        <strong className={`ldg-kpi-value ldg-kpi-value--lg ${netDiff < 0 ? 'ldg-neg' : netDiff > 0 ? 'ldg-pos' : ''}`}>
          {formatCurrency(Math.abs(netDiff))}
        </strong>
        <span className={`ldg-kpi-sub ${netDiff < 0 ? 'ldg-neg' : ''}`}>
          {netDiff === 0 ? 'Balanced' : `${Math.abs(netDiff / totalExp * 100).toFixed(2)}%`}
        </span>
      </div>
    </div>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar({ search, onSearch, statusFilter, onStatus }) {
  return (
    <div className="ldg-toolbar">
      <div className="ldg-search-wrap">
        <svg className="ldg-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M10 10L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <input
          type="search"
          className="ldg-search"
          placeholder="Search by order ID, amount, cause…"
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
      </div>
      <select className="ldg-filter-select" value={statusFilter} onChange={e => onStatus(e.target.value)} aria-label="Filter by status">
        <option value="">Status: All</option>
        <option value="matched">Matched</option>
        <option value="explained">Explained</option>
        <option value="in_transit">In Transit</option>
        <option value="unresolved">Unmatched</option>
      </select>
    </div>
  )
}

// ── Detail panel (right-side when a row is selected) ─────────────────────────

function DetailPanel({ record, onClose }) {
  if (!record) return null
  const diff = record.actual_amount_paise != null
    ? record.actual_amount_paise - record.expected_amount_paise
    : null
  const diffPct = diff != null && record.expected_amount_paise
    ? (diff / record.expected_amount_paise * 100).toFixed(1)
    : null

  return (
    <div className="ldg-detail-panel">
      <div className="ldg-detail-header">
        <div className="ldg-detail-title">
          {record.status === 'unresolved' || !record.settlement_id
            ? <span className="ldg-match-chip ldg-match-chip--bad">MISMATCH</span>
            : <span className="ldg-match-chip ldg-match-chip--ok">MATCHED</span>}
          <span className="ldg-detail-ids">{record.record_id}{record.settlement_id ? ` ↔ ${record.settlement_id}` : ''}</span>
        </div>
        <button type="button" className="ldg-detail-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="ldg-detail-body">
        <p className="ldg-detail-section-label">What happened?</p>
        {diff !== null && diff !== 0 && (
          <p className="ldg-detail-headline">
            Short settlement of {formatCurrency(Math.abs(diff))} ({Math.abs(diffPct)}%)
          </p>
        )}
        <p className="ldg-detail-explanation">{record.explanation}</p>

        <p className="ldg-detail-section-label" style={{ marginTop: 18 }}>Breakdown</p>
        <div className="ldg-breakdown">
          <div className="ldg-breakdown-row">
            <span>Expected Amount</span>
            <strong>{formatCurrency(record.expected_amount_paise)}</strong>
          </div>
          <div className="ldg-breakdown-row">
            <span>Settled Amount</span>
            <strong>{formatCurrency(record.actual_amount_paise)}</strong>
          </div>
          {diff !== null && (
            <div className="ldg-breakdown-row ldg-breakdown-row--diff">
              <span>Difference</span>
              <strong className={diff < 0 ? 'ldg-neg' : diff > 0 ? 'ldg-pos' : ''}>
                {diff === 0 ? '—' : `${diff < 0 ? '-' : '+'}${formatCurrency(Math.abs(diff))} (${Math.abs(diffPct)}%)`}
              </strong>
            </div>
          )}
          <div className="ldg-breakdown-row">
            <span>Status</span>
            <StatusPill status={record.status} />
          </div>
          <div className="ldg-breakdown-row">
            <span>Primary Cause</span>
            <strong>{causeLabel(record.primary_cause)}</strong>
          </div>
          <div className="ldg-breakdown-row">
            <span>Confidence</span>
            <strong>{Math.round((record.confidence ?? 0) * 100)}%</strong>
          </div>
        </div>

        {record.contributing_causes?.length > 0 && (
          <>
            <p className="ldg-detail-section-label" style={{ marginTop: 18 }}>Possible Reasons</p>
            <ul className="ldg-reasons">
              {record.contributing_causes.map(c => (
                <li key={c}>· {causeLabel(c)}</li>
              ))}
            </ul>
          </>
        )}

        {record.trace?.length > 0 && (
          <>
            <p className="ldg-detail-section-label" style={{ marginTop: 18 }}>Reasoning path</p>
            <div className="ldg-trace">
              {record.trace.map((step, i) => (
                <div key={i} className={`ldg-trace-step ${step.result === 'found' ? 'ldg-trace-step--ok' : step.result === 'error' ? 'ldg-trace-step--err' : ''}`}>
                  <code>{step.step}</code>
                  <span className="ldg-trace-result">{step.result}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main table rows ───────────────────────────────────────────────────────────

function MerchantRow({ rec, isHighlighted, onHover, onSelect }) {
  const paired = !!rec.settlement_id
  return (
    <tr
      className={[
        'ldg-tr',
        !paired ? 'ldg-tr--unmatched' : '',
        isHighlighted ? 'ldg-tr--highlight' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={() => onHover(rec.record_id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(rec.record_id)}
    >
      <td className="ldg-td ldg-td--id">
        <span className="ldg-record-id">{rec.record_id}</span>
        <span className="ldg-record-time">{fmt(rec.order_date)}</span>
      </td>
      <td className="ldg-td">{rec.business_type}</td>
      <td className="ldg-td ldg-td--amount">{formatCurrency(rec.expected_amount_paise)}</td>
      <td className="ldg-td"><StatusPill status={rec.status} /></td>
    </tr>
  )
}

function SettlementRow({ rec, merchantIds, isHighlighted, onHover, onSelect }) {
  return (
    <tr
      className={['ldg-tr', isHighlighted ? 'ldg-tr--highlight' : ''].filter(Boolean).join(' ')}
      onMouseEnter={() => merchantIds[0] && onHover(merchantIds[0])}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(rec.record_id)}
    >
      <td className="ldg-td ldg-td--id">
        <span className="ldg-record-id">{rec.settlement_id}</span>
        <span className="ldg-record-link">↔ {merchantIds[0] ?? '—'}</span>
      </td>
      <td className="ldg-td ldg-td--amount">{formatCurrency(rec.actual_amount_paise)}</td>
      <td className="ldg-td">
        <DiffBadge expected={rec.expected_amount_paise} actual={rec.actual_amount_paise} />
      </td>
      <td className="ldg-td"><StatusPill status={rec.status} /></td>
    </tr>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function LedgerPage({ records, loading, errorText }) {
  const [hoveredPair, setHoveredPair] = useState(null)
  const [selectedId, setSelectedId]   = useState(null)
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatus]     = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records.filter(r => {
      const matchSearch = !q ||
        r.record_id.toLowerCase().includes(q) ||
        (r.settlement_id ?? '').toLowerCase().includes(q) ||
        (r.primary_cause ?? '').includes(q) ||
        (r.business_type ?? '').toLowerCase().includes(q)
      const matchStatus = !statusFilter || r.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [records, search, statusFilter])

  // settlement_id → [record_ids] map
  const settlementMap = useMemo(() => {
    const m = {}
    records.forEach(r => {
      if (r.settlement_id) {
        if (!m[r.settlement_id]) m[r.settlement_id] = []
        m[r.settlement_id].push(r.record_id)
      }
    })
    return m
  }, [records])

  // Unique settlements preserving order, filtered
  const settlements = useMemo(() => {
    const seen = new Set()
    const q = search.trim().toLowerCase()
    return records.filter(r => {
      if (!r.settlement_id || seen.has(r.settlement_id)) return false
      seen.add(r.settlement_id)
      const matchSearch = !q ||
        r.record_id.toLowerCase().includes(q) ||
        r.settlement_id.toLowerCase().includes(q) ||
        (r.primary_cause ?? '').includes(q)
      const matchStatus = !statusFilter || r.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [records, search, statusFilter])

  const openRecord = records.find(r => r.record_id === selectedId) ?? null

  if (loading) return <div className="ldg-page"><div className="empty-state">Loading batch…</div></div>
  if (errorText) return <div className="ldg-page"><div className="banner error">{errorText}</div></div>

  return (
    <div className={`ldg-page ${openRecord ? 'ldg-page--with-panel' : ''}`}>

      {/* ── Page header ── */}
      <div className="ldg-page-head">
        <div>
          <h2 className="ldg-page-title">Dual Ledger</h2>
          <p className="ldg-page-sub">Side-by-side reconciliation of merchant ledger vs Razorpay settlements</p>
        </div>
        <div className="ldg-head-actions">
          <button type="button" className="ldg-action-btn ldg-action-btn--primary" onClick={() => downloadCsv()}>
            ↓ Download CSV
          </button>
        </div>
      </div>

      {/* ── KPI bar ── */}
      <KpiBar records={records} />

      {/* ── Toolbar ── */}
      <Toolbar
        search={search}
        onSearch={setSearch}
        statusFilter={statusFilter}
        onStatus={setStatus}
      />

      {/* ── Two-table split + detail panel ── */}
      <div className="ldg-workspace">
        <div className="ldg-tables">

          {/* Left — merchant ledger */}
          <div className="ldg-table-panel">
            <div className="ldg-table-head">
              <span className="source-dot blue" />
              <h3>Merchant Ledger</h3>
              <span className="ldg-table-meta">{filtered.length} records</span>
              <span className="ldg-table-total">{formatCurrency(filtered.reduce((s,r) => s + r.expected_amount_paise, 0))}</span>
            </div>
            <div className="ldg-table-scroll">
              <table className="ldg-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Source</th>
                    <th className="ldg-th--amount">Expected Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(rec => (
                    <MerchantRow
                      key={rec.record_id}
                      rec={rec}
                      isHighlighted={hoveredPair === rec.record_id}
                      onHover={setHoveredPair}
                      onSelect={setSelectedId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ldg-table-foot">
              Showing 1 to {filtered.length} of {records.length} records
            </div>
          </div>

          {/* Right — settlement ledger */}
          <div className="ldg-table-panel">
            <div className="ldg-table-head">
              <span className="source-dot amber" />
              <h3>Payment Gateway Settlements</h3>
              <span className="ldg-table-meta">{settlements.length} records</span>
              <span className="ldg-table-total">{formatCurrency(settlements.reduce((s,r) => s + (r.actual_amount_paise ?? 0), 0))}</span>
            </div>
            <div className="ldg-table-scroll">
              <table className="ldg-table">
                <thead>
                  <tr>
                    <th>Settlement ID</th>
                    <th className="ldg-th--amount">Settled Amount</th>
                    <th>Difference</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map(rec => (
                    <SettlementRow
                      key={rec.settlement_id}
                      rec={rec}
                      merchantIds={settlementMap[rec.settlement_id] ?? []}
                      isHighlighted={hoveredPair && (settlementMap[rec.settlement_id] ?? []).includes(hoveredPair)}
                      onHover={setHoveredPair}
                      onSelect={setSelectedId}
                    />
                  ))}
                  {/* Placeholder rows for unmatched */}
                  {filtered.filter(r => !r.settlement_id).map(r => (
                    <tr key={`ph-${r.record_id}`} className="ldg-tr ldg-tr--placeholder">
                      <td className="ldg-td ldg-td--id" colSpan={4}>
                        <span className="ldg-no-settlement">No settlement for {r.record_id}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ldg-table-foot">
              Showing 1 to {settlements.length} of {records.filter(r => r.settlement_id).length} records
            </div>
          </div>
        </div>

        {/* Detail panel slides in when a row is selected */}
        {openRecord && (
          <DetailPanel record={openRecord} onClose={() => setSelectedId(null)} />
        )}
      </div>

    </div>
  )
}
