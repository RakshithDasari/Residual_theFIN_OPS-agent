import { useMemo, useState } from 'react'
import { BATCH_LIMIT, causeLabel, downloadCsv, formatCurrency, STATUS_TONES } from '../api'
import RecordDrawer from '../components/RecordDrawer'

const COLUMNS = [
  ['record_id', 'Record'],
  ['business_type', 'Type'],
  ['expected_amount_paise', 'Expected'],
  ['actual_amount_paise', 'Settled'],
  ['difference', 'Difference'],
  ['primary_cause', 'Cause'],
  ['confidence', 'Confidence'],
  ['status', 'Status'],
]

function difference(record) {
  if (record.actual_amount_paise == null) return null
  return record.actual_amount_paise - record.expected_amount_paise
}

function sortValue(record, key) {
  if (key === 'difference') return difference(record) ?? Number.NEGATIVE_INFINITY
  return record[key] ?? ''
}

export default function RecordsPage({ records, summary, loading }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [causeFilter, setCauseFilter] = useState('')
  const [sort, setSort] = useState({ key: 'record_id', ascending: true })
  const [openId, setOpenId] = useState(null)

  const causes = useMemo(
    () => [...new Set(records.map((record) => record.primary_cause))].sort(),
    [records],
  )

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = records.filter((record) => {
      const haystack = `${record.record_id} ${record.settlement_id ?? ''} ${record.primary_cause}`.toLowerCase()
      return (
        (!needle || haystack.includes(needle)) &&
        (!statusFilter || record.status === statusFilter) &&
        (!causeFilter || record.primary_cause === causeFilter)
      )
    })

    return filtered.sort((left, right) => {
      const a = sortValue(left, sort.key)
      const b = sortValue(right, sort.key)
      const comparison =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b), undefined, { numeric: true })
      return sort.ascending ? comparison : -comparison
    })
  }, [records, search, statusFilter, causeFilter, sort])

  const sortBy = (key) =>
    setSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))

  return (
    <section className="records-page">
      <div className="records-toolbar panel">
        <div className="records-filters">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search record, settlement or cause"
            aria-label="Search records"
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {Object.keys(STATUS_TONES).map((status) => (
              <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>
            ))}
          </select>
          <select value={causeFilter} onChange={(event) => setCauseFilter(event.target.value)} aria-label="Filter by cause">
            <option value="">All causes</option>
            {causes.map((cause) => (
              <option key={cause} value={cause}>{causeLabel(cause)}</option>
            ))}
          </select>
        </div>
        <div className="records-actions">
          <span className="records-count">
            {visible.length} of {summary.total_records ?? records.length} records
          </span>
          <button type="button" className="primary" onClick={() => downloadCsv(BATCH_LIMIT)} disabled={!records.length}>
            ↓ Download CSV
          </button>
        </div>
      </div>

      <div className="table-scroll panel">
        <table className="audit-table">
          <thead>
            <tr>
              {COLUMNS.map(([key, label]) => (
                <th key={key} scope="col" aria-sort={sort.key === key ? (sort.ascending ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => sortBy(key)}>
                    {label} {sort.key === key ? (sort.ascending ? '↑' : '↓') : '↕'}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((record) => {
                const gap = difference(record)
                return (
                  <tr
                    key={record.record_id}
                    className={record.status === 'unresolved' ? 'anomaly-row' : ''}
                    onClick={() => setOpenId(record.record_id)}
                  >
                    <td className="mono-cell">{record.record_id}</td>
                    <td>{record.business_type}</td>
                    <td className="amount-cell">{formatCurrency(record.expected_amount_paise)}</td>
                    <td className="amount-cell">{formatCurrency(record.actual_amount_paise)}</td>
                    <td className="amount-cell">{gap == null ? '—' : formatCurrency(gap)}</td>
                    <td>{causeLabel(record.primary_cause)}</td>
                    <td className="amount-cell">{Math.round((record.confidence ?? 0) * 100)}%</td>
                    <td><span className={`badge ${STATUS_TONES[record.status] ?? 'muted'}`}>{record.status}</span></td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={COLUMNS.length}>
                  <div className="empty-state">
                    {loading ? 'Loading the batch…' : 'No records match these filters.'}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openId ? (
        <RecordDrawer
          record={records.find((record) => record.record_id === openId) ?? null}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </section>
  )
}
