import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import './App.css'

const API_BASE = 'http://localhost:8000'

const emptySummary = {
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

const toneMap = {
  matched: 'success',
  explained: 'info',
  in_transit: 'muted',
  unresolved: 'danger',
}

const navItems = [
  { to: '/', label: 'Overview' },
  { to: '/review', label: 'Review queue' },
  { to: '/exceptions', label: 'Exceptions' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/support', label: 'Support' },
]

function formatCurrency(value) {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(value / 100)
}

function formatPercent(value) {
  if (value == null) return '0%'
  return `${value.toFixed(1)}%`
}

function providerFailureMessage(detail) {
  const base =
    'Live reconciliation is currently blocked by the model provider or payment budget. The backend is reachable, but no real live result is available right now.'
  if (!detail) return base
  return `${base} Details: ${detail}`
}

async function callApi(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.detail || payload.message || `Request failed (${response.status})`)
  }

  return payload
}

function App() {
  return (
    <BrowserRouter>
      <DashboardShell />
    </BrowserRouter>
  )
}

function DashboardShell() {
  const [summary, setSummary] = useState(emptySummary)
  const [records, setRecords] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [recordInput, setRecordInput] = useState('ORD-1')
  const [queryInput, setQueryInput] = useState('Summarize the records with the most risk.')
  const [statusText, setStatusText] = useState('Ready')
  const [errorText, setErrorText] = useState('')
  const [loading, setLoading] = useState(false)

  const selectedRecord = useMemo(
    () => records.find((record) => record.record_id === selectedId) ?? null,
    [records, selectedId],
  )

  useEffect(() => {
    void loadBatch()
  }, [])

  const openDetail = (recordId) => {
    setSelectedId(recordId)
    setDetailOpen(true)
  }

  const closeDetail = () => {
    setDetailOpen(false)
    setSelectedId(null)
  }

  async function loadBatch() {
    setLoading(true)
    setErrorText('')
    try {
      const payload = await callApi('/run-batch', {
        method: 'POST',
        body: JSON.stringify({ limit: 5 }),
      })

      if (payload.mode === 'degraded' || payload.status !== 'ok') {
        setStatusText('Preview only')
        setSummary(payload.preview ? emptySummary : summary)
        setRecords([])
        setErrorText(providerFailureMessage(payload.message || payload.error || 'Provider unavailable'))
        return
      }

      const nextSummary = payload.report?.summary ?? emptySummary
      const nextRecords = payload.report?.records ?? []

      setSummary(nextSummary)
      setRecords(nextRecords)
      setSelectedId(nextRecords[0]?.record_id ?? null)
      setStatusText('Live batch run')
      setErrorText('')
    } catch (error) {
      setStatusText('Backend call failed')
      setRecords([])
      setErrorText(providerFailureMessage(error.message))
    } finally {
      setLoading(false)
    }
  }

  async function loadRecord() {
    const targetId = recordInput.trim()
    if (!targetId) {
      setErrorText('Enter a record ID before fetching its detail.')
      return
    }

    setLoading(true)
    setErrorText('')
    try {
      const payload = await callApi(`/record/${encodeURIComponent(targetId)}`)

      if (payload.mode === 'degraded' || payload.status !== 'ok') {
        setStatusText('Lookup unavailable')
        setErrorText(providerFailureMessage(payload.message || 'Provider unavailable'))
        return
      }

      const record = payload.record ?? payload
      if (!record) {
        setErrorText('No record found for that record ID.')
        return
      }

      setRecords([record])
      setSelectedId(record.record_id)
      setDetailOpen(true)
      setStatusText('Single record lookup')
    } catch (error) {
      setStatusText('Lookup failed')
      setErrorText(providerFailureMessage(error.message))
    } finally {
      setLoading(false)
    }
  }

  async function runQuery() {
    const query = queryInput.trim()
    if (!query) {
      setErrorText('Enter a question before submitting it to the agent.')
      return
    }

    setLoading(true)
    setErrorText('')
    try {
      const payload = await callApi('/query', {
        method: 'POST',
        body: JSON.stringify({
          query,
          record_id: recordInput.trim() || null,
          limit: 5,
        }),
      })

      if (payload.mode === 'degraded' || payload.status !== 'ok') {
        setStatusText('Query unavailable')
        setErrorText(providerFailureMessage(payload.message || 'Provider unavailable'))
        return
      }

      const nextReport = payload.report ?? payload
      if (nextReport?.summary && nextReport.records) {
        setSummary(nextReport.summary)
        setRecords(nextReport.records)
        setSelectedId(nextReport.records[0]?.record_id ?? null)
      } else if (payload.record) {
        setRecords([payload.record])
        setSelectedId(payload.record.record_id)
      }

      setStatusText('Agent query complete')
      setErrorText('')
    } catch (error) {
      setStatusText('Agent query failed')
      setErrorText(providerFailureMessage(error.message))
    } finally {
      setLoading(false)
    }
  }

  const exceptionList = Object.entries(summary.exception_categories ?? {})

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">R</div>
          <div>
            <p className="eyebrow">Operations</p>
            <h1>Reconciliation</h1>
          </div>
        </div>

        <nav className="nav" aria-label="Main navigation">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="side-card">
          <p className="eyebrow">Live status</p>
          <strong>{statusText}</strong>
          <span>{loading ? 'Refreshing…' : 'Ready to reconcile'}</span>
        </div>

        <div className="side-card compact">
          <p className="eyebrow">Risk focus</p>
          <div className="mini-stat">
            <span>Needs attention</span>
            <strong>{summary.needs_attention}</strong>
          </div>
          <div className="mini-stat">
            <span>Pair rate</span>
            <strong>{formatPercent(summary.pair_rate)}</strong>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Settlement operations</p>
            <h2>Batch overview</h2>
          </div>

          <div className="toolbar">
            <input
              type="text"
              value={recordInput}
              onChange={(event) => setRecordInput(event.target.value)}
              placeholder="Record id"
              aria-label="Record ID"
            />
            <button type="button" className="secondary" onClick={loadRecord} disabled={loading}>
              Fetch record
            </button>
            <button type="button" className="primary" onClick={loadBatch} disabled={loading}>
              {loading ? 'Loading…' : 'Run batch'}
            </button>
          </div>
        </header>

        <Routes>
          <Route
            path="/"
            element={
              <OverviewPage
                summary={summary}
                records={records}
                selectedRecord={selectedRecord}
                openDetail={openDetail}
                loading={loading}
                errorText={errorText}
                queryInput={queryInput}
                setQueryInput={setQueryInput}
                runQuery={runQuery}
              />
            }
          />
          <Route
            path="/review"
            element={
              <ReviewPage
                records={records}
                selectedRecord={selectedRecord}
                openDetail={openDetail}
                loading={loading}
                errorText={errorText}
              />
            }
          />
          <Route
            path="/exceptions"
            element={<ExceptionsPage summary={summary} exceptionList={exceptionList} />}
          />
          <Route
            path="/analytics"
            element={<AnalyticsPage summary={summary} />}
          />
          <Route
            path="/support"
            element={
              <SupportPage
                queryInput={queryInput}
                setQueryInput={setQueryInput}
                runQuery={runQuery}
                loading={loading}
                errorText={errorText}
                statusText={statusText}
              />
            }
          />
        </Routes>

        {detailOpen && selectedRecord ? (
          <div className="detail-drawer" role="dialog" aria-modal="true">
            <div className="detail-drawer-header">
              <div>
                <p className="eyebrow">Selected record</p>
                <h3>{selectedRecord.record_id}</h3>
              </div>
              <button type="button" className="close-button" onClick={closeDetail} aria-label="Close detail panel">
                ×
              </button>
            </div>

            <div className="detail-grid">
              <div>
                <span>Business type</span>
                <strong>{selectedRecord.business_type}</strong>
              </div>
              <div>
                <span>Expected</span>
                <strong>{formatCurrency(selectedRecord.expected_amount_paise)}</strong>
              </div>
              <div>
                <span>Actual</span>
                <strong>{selectedRecord.actual_amount_paise == null ? '—' : formatCurrency(selectedRecord.actual_amount_paise)}</strong>
              </div>
              <div>
                <span>Settlement</span>
                <strong>{selectedRecord.settlement_id ?? 'No settlement matched'}</strong>
              </div>
              <div>
                <span>Primary cause</span>
                <strong>{selectedRecord.primary_cause}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>{Math.round(selectedRecord.confidence * 100)}%</strong>
              </div>
            </div>

            <div className="explanation-block">
              <h4>Explanation</h4>
              <p>{selectedRecord.explanation}</p>
            </div>

            <div className="tags-wrap">
              {selectedRecord.contributing_causes?.length ? (
                selectedRecord.contributing_causes.map((cause) => (
                  <span key={cause} className="tag">
                    {cause}
                  </span>
                ))
              ) : (
                <span className="tag muted-tag">No contributing causes</span>
              )}
            </div>

            <div className="trace-block">
              <h4>Trace</h4>
              <ul>
                {(selectedRecord.trace ?? []).map((step) => (
                  <li key={`${selectedRecord.record_id}-${step.step}`}>
                    <div className="trace-topline">
                      <strong>{step.step}</strong>
                      <span>{step.result}</span>
                    </div>
                    <p>{step.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

function OverviewPage({ summary, records, selectedRecord, openDetail, loading, errorText, queryInput, setQueryInput, runQuery }) {
  return (
    <>
      <div className="query-bar">
        <input
          type="text"
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Ask the reconciliation agent"
          aria-label="Ask a question"
        />
        <button type="button" className="primary" onClick={runQuery} disabled={loading}>
          Ask agent
        </button>
      </div>

      {errorText ? <div className="banner error">{errorText}</div> : null}

      <section className="summary-grid">
        <article className="metric-card highlight">
          <span className="label">Records</span>
          <strong>{summary.total_records}</strong>
          <small>Total in batch</small>
        </article>
        <article className="metric-card">
          <span className="label">Matched</span>
          <strong>{summary.matched_records}</strong>
          <small>{formatPercent((summary.matched_records / Math.max(summary.total_records, 1)) * 100)}</small>
        </article>
        <article className="metric-card">
          <span className="label">Explained</span>
          <strong>{summary.explained_records}</strong>
          <small>{formatPercent((summary.explained_records / Math.max(summary.total_records, 1)) * 100)}</small>
        </article>
        <article className="metric-card">
          <span className="label">In transit</span>
          <strong>{summary.in_transit_records}</strong>
          <small>{summary.in_transit_records ? 'Awaiting settlement' : 'No direct action'}</small>
        </article>
        <article className="metric-card">
          <span className="label">Unresolved</span>
          <strong>{summary.unresolved_records}</strong>
          <small>{summary.unresolved_records ? 'Needs analyst review' : 'Healthy'}</small>
        </article>
        <article className="metric-card">
          <span className="label">Match rate</span>
          <strong>{formatPercent(summary.match_rate)}</strong>
          <small>Auto-match score</small>
        </article>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Reconciliation queue</h3>
            <span>{records.length} records</span>
          </div>

          <div className="record-list">
            {records.length ? (
              records.map((record) => (
                <button
                  type="button"
                  key={record.record_id}
                  className={`record-row ${selectedRecord?.record_id === record.record_id ? 'active' : ''}`}
                  onClick={() => openDetail(record.record_id)}
                >
                  <div className="record-meta">
                    <strong>{record.record_id}</strong>
                    <span>{record.business_type}</span>
                  </div>
                  <div className="record-values">
                    <span>{formatCurrency(record.expected_amount_paise)}</span>
                    <span className={`badge ${toneMap[record.status] ?? 'muted'}`}>
                      {record.status}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state">
                {loading ? 'Loading live reconciliation data…' : 'No records returned yet.'}
              </div>
            )}
          </div>
        </div>

        <div className="panel analytics-panel">
          <div className="panel-header">
            <h3>Exception categories</h3>
            <span>{Object.keys(summary.exception_categories ?? {}).length} groups</span>
          </div>

          <div className="exception-list">
            {Object.entries(summary.exception_categories ?? {}).length ? (
              Object.entries(summary.exception_categories ?? {}).map(([key, count]) => (
                <div key={key} className="exception-item">
                  <span>{key}</span>
                  <strong>{count}</strong>
                </div>
              ))
            ) : (
              <div className="empty-state">No exceptions reported.</div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}

function ReviewPage({ records, selectedRecord, openDetail, loading, errorText }) {
  return (
    <section className="panel review-panel">
      <div className="panel-header">
        <h3>Review queue</h3>
        <span>{records.length} records</span>
      </div>

      {errorText ? <div className="banner error">{errorText}</div> : null}

      <div className="record-list">
        {records.length ? (
          records.map((record) => (
            <button
              type="button"
              key={record.record_id}
              className={`record-row ${selectedRecord?.record_id === record.record_id ? 'active' : ''}`}
              onClick={() => openDetail(record.record_id)}
            >
              <div className="record-meta">
                <strong>{record.record_id}</strong>
                <span>{record.business_type}</span>
              </div>
              <div className="record-values">
                <span>{formatCurrency(record.expected_amount_paise)}</span>
                <span className={`badge ${toneMap[record.status] ?? 'muted'}`}>
                  {record.status}
                </span>
              </div>
            </button>
          ))
        ) : (
          <div className="empty-state">
            {loading ? 'Loading review items…' : 'No queued records available.'}
          </div>
        )}
      </div>
    </section>
  )
}

function ExceptionsPage({ summary, exceptionList }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>Exception categories</h3>
        <span>{exceptionList.length} groups</span>
      </div>

      <div className="exception-list">
        {exceptionList.length ? (
          exceptionList.map(([key, count]) => (
            <div key={key} className="exception-item">
              <span>{key}</span>
              <strong>{count}</strong>
            </div>
          ))
        ) : (
          <div className="empty-state">No exceptions reported.</div>
        )}
      </div>

      <div className="summary-inline">
        <div>
          <span>Needs attention</span>
          <strong>{summary.needs_attention}</strong>
        </div>
        <div>
          <span>Unresolved</span>
          <strong>{summary.unresolved_records}</strong>
        </div>
      </div>
    </section>
  )
}

function AnalyticsPage({ summary }) {
  return (
    <section className="panel analytics-panel">
      <div className="panel-header">
        <h3>Analytics</h3>
        <span>Reconciliation signal</span>
      </div>

      <div className="summary-grid">
        <article className="metric-card">
          <span className="label">Match rate</span>
          <strong>{formatPercent(summary.match_rate)}</strong>
          <small>Auto-match score</small>
        </article>
        <article className="metric-card">
          <span className="label">Pair rate</span>
          <strong>{formatPercent(summary.pair_rate)}</strong>
          <small>Paired settlement share</small>
        </article>
        <article className="metric-card">
          <span className="label">Needs attention</span>
          <strong>{summary.needs_attention}</strong>
          <small>Flagged records</small>
        </article>
      </div>
    </section>
  )
}

function SupportPage({ queryInput, setQueryInput, runQuery, loading, errorText, statusText }) {
  return (
    <section className="panel support-panel">
      <div className="panel-header">
        <h3>Support</h3>
        <span>{statusText}</span>
      </div>

      <div className="query-bar support-query">
        <input
          type="text"
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Ask another question"
          aria-label="Ask another question"
        />
        <button type="button" className="primary" onClick={runQuery} disabled={loading}>
          Ask agent
        </button>
      </div>

      {errorText ? <div className="banner error">{errorText}</div> : null}

      <div className="support-box">
        <h4>Current provider status</h4>
        <p>
          The frontend is connected to the FastAPI backend, but live model calls remain blocked by
          the active provider’s billing or quota state. This is an honest runtime status, not a fake
          success path.
        </p>
      </div>
    </section>
  )
}

export default App
