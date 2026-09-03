import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

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
  { to: '/', label: 'Chat with Residual', icon: '▣' },
  { to: '/review', label: 'Date Reconciliation', icon: '▦' },
  { to: '/exceptions', label: 'Exceptions Queue', icon: '△' },
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
  if (!detail) return 'The request could not be completed.'
  if (/not found/i.test(detail)) return detail
  if (/already in progress|conflict/i.test(detail)) return 'A reconciliation is already running. Wait for it to finish before starting another one.'
  return `Live reconciliation could not complete. Details: ${detail}`
}

function exportCsv(records, filename = 'residual-reconciliation.csv') {
  const headers = ['record_id', 'expected_amount_paise', 'actual_amount_paise', 'settlement_id', 'primary_cause', 'status']
  const rows = records.map((record) => headers.map((header) => JSON.stringify(record[header] ?? '')).join(','))
  const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
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
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app/*" element={<DashboardShell />} />
      </Routes>
    </BrowserRouter>
  )
}

function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav">
        <Link className="landing-brand" to="/">Residual</Link>
        <Link className="primary landing-enter" to="/app">Open workspace</Link>
      </nav>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow">Settlement intelligence / MVP</p>
          <h1>Close the gap between expected and settled money.</h1>
          <p className="hero-lede">Residual reconciles a merchant’s expected records against Razorpay settlements, then explains every difference with evidence a finance team can follow.</p>
          <Link className="primary hero-action" to="/app">Enter Ask &amp; Reconcile <span>→</span></Link>
        </div>
        <div className="hero-ledger" aria-label="Reconciliation preview">
          <div className="ledger-label">One record, made legible</div>
          <div className="ledger-line"><span>Expected</span><strong>₹3,541.00</strong></div>
          <div className="ledger-line"><span>Settled</span><strong>₹2,832.40</strong></div>
          <div className="ledger-line residual-line"><span>Residual</span><strong>₹635.48</strong></div>
          <div className="ledger-note">partial refund · exact UTR match · evidence verified</div>
        </div>
      </section>

      <section className="landing-band pipeline-band">
        <div className="section-intro"><p className="eyebrow">The pipeline</p><h2>Automation with a paper trail.</h2></div>
        <div className="pipeline-grid">
          {['Expected + settlement', 'Exact → fuzzy match', 'Fees, tax, residual', 'Reason only when needed', 'Explanation + confidence'].map((step, index) => (
            <div className="pipeline-step" key={step}><span>0{index + 1}</span><strong>{step}</strong>{index < 4 ? <i>→</i> : null}</div>
          ))}
        </div>
        <p className="pipeline-footnote">When evidence does not support a confident answer, Residual says unresolved. The system does not invent certainty.</p>
      </section>

      <section className="landing-band results-band">
        <div className="section-intro"><p className="eyebrow">Measured, not marketed</p><h2>Results that tell the whole story.</h2></div>
        <div className="result-grid"><div><strong>100%</strong><span>pairing accuracy<br />55-record benchmark</span></div><div><strong>100%</strong><span>diagnosis accuracy<br />55-record benchmark</span></div><div><strong>20</strong><span>adversarial records<br />10 medium · 10 hard</span></div></div>
        <p className="results-note">The evaluation labels were never exposed to the agent. They were loaded afterward by the evaluator, solely to score the completed reconciliation.</p>
      </section>

      <section className="landing-band story-band">
        <div className="section-intro"><p className="eyebrow">How it got here</p><h2>The honest engineering story.</h2></div>
        <div className="story-grid"><div><span className="story-number">01</span><h3>Trusting the model too much</h3><p>The first live workflow let the LLM decide when to call tools, interpret arithmetic, and format the final answer. It reached 45.5% pairing and 36.4% diagnosis accuracy across 55 records.</p></div><div><span className="story-number">02</span><h3>Finding the real failure</h3><p>Hugging Face worked for basic OpenAI-compatible requests, but Agno sent a developer role this route rejected. Its generated tool schema also contained an invalid catch-all field.</p></div><div><span className="story-number">03</span><h3>Narrowing the LLM’s job</h3><p>Deterministic code now gathers matching, arithmetic, and settlement-age evidence. The model, powered by Hugging Face’s <code>zai-org/GLM-5.3-Flash:novita</code>, turns verified evidence into readable finance prose.</p></div></div>
      </section>

      <section className="landing-band reality-band">
        <div className="section-intro"><p className="eyebrow">MVP boundary</p><h2>Ready for a real integration, not pretending to be one.</h2></div>
        <div className="reality-grid"><div><h3>Today</h3><p>A working read-only demo using synthetic records, Razorpay Settlements and Settlement Recon concepts, a FastAPI backend, and a React workspace.</p></div><div><h3>Production path</h3><p>Connect a merchant’s order or invoice stream through an API or webhook, continuously ingest settlement data, and apply the same evidence-first engine to real transactions.</p></div><div><h3>Challenges</h3><p>Provider compatibility, tool-calling variability, prompt overreach, and the difference between a plausible explanation and a verified accounting result shaped the design.</p></div></div>
      </section>

      <footer className="landing-footer"><span>Residual · settlement reconciliation</span><Link to="/app">Open the workspace →</Link></footer>
    </main>
  )
}

function DashboardShell() {
  const location = useLocation()
  const [summary, setSummary] = useState(emptySummary)
  const [records, setRecords] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [recordInput, setRecordInput] = useState('ORD-1000')
  const [queryInput, setQueryInput] = useState('')
  const [statusText, setStatusText] = useState('Ready')
  const [errorText, setErrorText] = useState('')
  const [agentAnswer, setAgentAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [spreadsheetView, setSpreadsheetView] = useState(false)

  const selectedRecord = useMemo(
    () => records.find((record) => record.record_id === selectedId) ?? null,
    [records, selectedId],
  )

  useEffect(() => {
    void loadPreview()
  }, [])

  const openDetail = (recordId) => {
    setSelectedId(recordId)
    setDetailOpen(true)
  }

  const closeDetail = () => {
    setDetailOpen(false)
    setSelectedId(null)
  }

  async function loadPreview() {
    setLoading(true)
    setErrorText('')
    try {
      const payload = await callApi('/preview?limit=5')
      const preview = payload.preview ?? {}
      setStatusText('Ready')
      setAgentAnswer('')
      setSummary({ ...emptySummary, total_records: preview.records_total ?? 0 })
      setRecords([])
    } catch (error) {
      setStatusText('Backend call failed')
      setErrorText(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadBatch(batchLimit = 55) {
    setLoading(true)
    setErrorText('')
    try {
      const payload = await callApi('/run-batch', {
        method: 'POST',
        body: JSON.stringify({ limit: batchLimit }),
      })

      if (payload.mode === 'degraded' || payload.status !== 'ok') {
        setStatusText('Preview only')
          setSummary(payload.preview ? { ...emptySummary, total_records: payload.preview.records_total ?? 0 } : summary)
        setErrorText(providerFailureMessage(payload.message || payload.error || 'Provider unavailable'))
        return
      }

      const nextSummary = payload.report?.summary ?? emptySummary
      const nextRecords = payload.report?.records ?? []

      setSummary(nextSummary)
      setRecords(nextRecords)
      setSelectedId(nextRecords[0]?.record_id ?? null)
      setStatusText('Live batch run')
      setAgentAnswer('')
      setErrorText('')
    } catch (error) {
      setStatusText('Backend call failed')
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
          record_id: null,
          limit: 55,
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
      setAgentAnswer(payload.answer || '')
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
        <div className="brand-block brand-inline">
          <Link className="brand-wordmark" to="/"><span className="brand-mark">R</span><span>Residual</span></Link>
        </div>

        <nav className="nav" aria-label="Main navigation">
          {navItems.map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={`/app${to === '/' ? '' : to}`}
                end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{icon}</span>{label}
            </NavLink>
          ))}
        </nav>

      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Settlement operations</p>
            <h2>{location.pathname.endsWith('/exceptions') ? 'Exceptions & Review Queue' : location.pathname.endsWith('/review') ? 'Manual Reconciliation' : 'Residual overview'}</h2>
          </div>

          {location.pathname.endsWith('/exceptions') ? null : location.pathname.endsWith('/review') ? (
            <div className="toolbar utility-actions"><span className="date-header-chip">Active settlement date · Aug 24, 2026</span></div>
          ) : (
            <div className="toolbar">
              <input type="text" value={recordInput} onChange={(event) => setRecordInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadRecord() }} placeholder="Record ID, e.g. ORD-1000" aria-label="Record ID" />
              <button type="button" className="secondary" onClick={loadRecord} disabled={loading}>Fetch record</button>
              <button type="button" className="primary" onClick={loadBatch} disabled={loading}>{loading ? 'Loading…' : 'Run batch'}</button>
            </div>
          )}
        </header>

        {location.pathname.endsWith('/exceptions') ? (
          <ExceptionsPage summary={summary} exceptionList={exceptionList} records={records} openDetail={openDetail} />
        ) : location.pathname.endsWith('/review') ? (
          <ManualReconciliationPage records={records} summary={summary} loading={loading} loadBatch={loadBatch} openDetail={openDetail} />
        ) : (
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
            agentAnswer={agentAnswer}
            spreadsheetView={spreadsheetView}
            setSpreadsheetView={setSpreadsheetView}
          />
        )}

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
                {(selectedRecord.trace ?? []).map((step) => {
                  const traceState = String(step.result ?? '').toLowerCase()
                  const resolved = !/(fail|error|miss|unresolved|exception)/.test(traceState)

                  return (
                    <li key={`${selectedRecord.record_id}-${step.step}`} className={resolved ? 'trace-item resolved' : 'trace-item failed'}>
                      <div className="trace-topline">
                        <strong>{step.step}</strong>
                        <span className={`trace-state ${resolved ? 'resolved' : 'failed'}`}>
                          {resolved ? '✓ Resolved' : '✕ Failed'}
                        </span>
                      </div>
                      <p>{step.detail}</p>
                      <pre className="trace-evidence">{step.result}</pre>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

function OverviewPage({ summary, records, selectedRecord, openDetail, loading, errorText, queryInput, setQueryInput, runQuery, agentAnswer, spreadsheetView, setSpreadsheetView }) {
  const totalExpected = records.reduce((sum, record) => sum + (Number(record.expected_amount_paise) || 0), 0)
  const totalActual = records.reduce((sum, record) => sum + (Number(record.actual_amount_paise ?? 0) || 0), 0)
  const totalResidual = totalActual - totalExpected

  const ledgerGroups = [
    { key: 'matched', title: 'Matched', items: records.filter((record) => record.status === 'matched') },
    { key: 'explained', title: 'Explained', items: records.filter((record) => record.status === 'explained') },
    { key: 'unresolved', title: 'Unresolved', items: records.filter((record) => record.status === 'unresolved') },
  ]

  const attentionRecords = records.filter((record) => record.status !== 'matched')
  const recentRecords = records.slice(-4).reverse()

  return (
    <>
      <div className="session-strip"><span>ACTIVE RECONCILIATION SESSION · #8492</span><strong>Autonomous audit stream</strong><span className="model-chip">Model: GLM-5.3-Flash</span></div>
      <div className="workspace-grid">
        <section className="agent-column">
          <div className="agent-card panel">
            <div className="agent-card-head"><div className="agent-avatar">R</div><div><strong>Residual Agent</strong><span>Autonomous ledger reconciliation engine</span></div><span className="live-chip">Live sync active</span></div>
            {!agentAnswer && !selectedRecord ? <div className="empty-chat"><span className="empty-chat-mark">R</span><h3>Ask Residual to reconcile your ledger.</h3><p>Submit a question below, or run the full batch to inspect every synthetic transaction.</p><div className="audit-steps"><span>Match</span><span>Arithmetic</span><span>Reason</span><span>Explain</span></div></div> : null}
            {agentAnswer ? <div className="chat-message agent-message answer-message"><span className="message-mark">R</span><p>{agentAnswer}</p></div> : null}
            {selectedRecord ? <div className="chat-message user-message compact-message">Explain {selectedRecord.record_id} in detail.</div> : null}
            {selectedRecord ? <div className="chat-message agent-message"><span className="message-mark">R</span><div><p>{selectedRecord.explanation}</p><button type="button" className="text-action" onClick={() => openDetail(selectedRecord.record_id)}>Open evidence trail →</button></div></div> : null}
            <div className="quick-actions"><button type="button" onClick={() => loadBatch(55)} disabled={loading}>↯ Reconcile all 55 records</button><button type="button" onClick={() => selectedRecord && openDetail(selectedRecord.record_id)} disabled={!selectedRecord}>↯ Explain selected record</button></div>
            <div className="query-bar chat-input"><input type="text" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Ask Residual about any transaction, batch, or ledger rule" aria-label="Ask a question" /><button type="button" className="primary" onClick={runQuery} disabled={loading}>↗</button></div>
          </div>
          {errorText ? <div className="banner error">{errorText}</div> : null}
          <div className="view-actions"><button type="button" className="secondary view-toggle" onClick={() => setSpreadsheetView((value) => !value)}>{spreadsheetView ? '← Narrative ledger' : '▦ View as spreadsheet'}</button><button type="button" className="secondary view-toggle" onClick={() => exportCsv(records)} disabled={!records.length}>↓ Download CSV</button></div>
          {spreadsheetView ? <SpreadsheetView records={records} openDetail={openDetail} /> : <section className="ledger-sections compact-ledger">{ledgerGroups.map((group) => <div key={group.key} className="ledger-section panel"><div className="panel-header"><h3>{group.title}</h3><span>{group.items.length} records</span></div><div className="record-list ledger-list">{group.items.length ? group.items.map((record) => <button type="button" key={record.record_id} className={`record-row ${selectedRecord?.record_id === record.record_id ? 'active' : ''}`} onClick={() => openDetail(record.record_id)}><div className="record-meta"><strong className="record-id-mono">{record.record_id}</strong><span>{record.business_type}</span></div><div className="record-values"><span>{formatCurrency(record.expected_amount_paise)}</span><span className={`badge ${toneMap[record.status] ?? 'muted'}`}>{record.status}</span></div></button>) : <div className="empty-state">{loading ? 'Loading live reconciliation data…' : `Run a batch to see ${group.title.toLowerCase()} records here.`}</div>}</div></div>)}</section>}
        </section>
        <aside className="insight-column">
          <section className="batch-card panel"><div className="panel-header"><div><p className="eyebrow">Batch reconciliation status</p><h3>{summary.total_records ? 'Current synthetic batch' : 'Awaiting a batch'}</h3></div><span className="clean-chip">{summary.total_records ? `${formatPercent(summary.pair_rate)} paired` : 'Ready'}</span></div><div className="batch-total">{formatCurrency(totalExpected)}<span>Expected volume</span></div><div className="batch-stat-row"><span>Reconciled</span><strong>{formatCurrency(totalActual)}</strong></div><div className="progress-track"><span style={{ width: `${Math.min(summary.pair_rate || 0, 100)}%` }} /></div><div className="batch-stat-row"><span>Exceptions</span><strong className="rust-text">{summary.needs_attention}</strong></div></section>
          <section className="attention-card panel"><div className="panel-header"><h3>Immediate attention queue</h3><span>{attentionRecords.length} items</span></div>{attentionRecords.length ? attentionRecords.slice(0, 3).map((record) => <button type="button" className="attention-item" key={record.record_id} onClick={() => openDetail(record.record_id)}><strong>{record.record_id}</strong><span className="attention-cause">{record.primary_cause.replaceAll('_', ' ')}</span><small>{formatCurrency(record.expected_amount_paise)} · Inspect →</small></button>) : <div className="empty-state">Run a batch to identify exceptions.</div>}</section>
          <section className="reasoning-card panel"><div className="panel-header"><h3>Recent agent reasoning</h3><span>live</span></div>{recentRecords.length ? recentRecords.map((record) => <div className="reasoning-item" key={record.record_id}><span>•</span><p><strong>{record.record_id}</strong> {record.primary_cause.replaceAll('_', ' ')} identified from verified evidence.</p></div>) : <div className="empty-state">No reasoning events yet.</div>}</section>
        </aside>
      </div>
    </>
  )
}

function SpreadsheetView({ records, openDetail }) {
  const [sort, setSort] = useState({ key: 'record_id', direction: 'ascending' })

  const sortedRecords = [...records].sort((left, right) => {
    const leftValue = left[sort.key] ?? ''
    const rightValue = right[sort.key] ?? ''
    const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true })
    return sort.direction === 'ascending' ? comparison : -comparison
  })

  const sortBy = (key) => setSort((current) => ({
    key,
    direction: current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending',
  }))

  const columns = [
    ['record_id', 'Record'],
    ['expected_amount_paise', 'Expected'],
    ['reference_hint', 'Reference'],
    ['business_type', 'Type'],
    ['settlement_id', 'Settlement'],
    ['actual_amount_paise', 'Actual'],
    ['residual_paise', 'Residual'],
    ['primary_cause', 'Cause'],
    ['status', 'Status'],
  ]

  return (
    <section className="spreadsheet-panel panel">
      <div className="panel-header">
        <div>
          <h3>Batch spreadsheet</h3>
          <span>Expected and actual settlement fields in one audit view</span>
        </div>
        <span>{records.length} rows</span>
      </div>
      {records.length ? (
        <div className="table-scroll">
          <table className="audit-table">
            <thead>
              <tr>
                {columns.map(([key, label]) => (
                  <th key={key} scope="col">
                    <button type="button" onClick={() => sortBy(key)}>{label} {sort.key === key ? (sort.direction === 'ascending' ? '↑' : '↓') : '↕'}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRecords.map((record) => {
                const anomaly = record.status !== 'matched'
                const residual = (Number(record.actual_amount_paise ?? 0) || 0) - (Number(record.expected_amount_paise) || 0)
                return (
                  <tr key={record.record_id} className={anomaly ? 'anomaly-row' : ''} onClick={() => openDetail(record.record_id)}>
                    <td className="mono-cell">{record.record_id}</td>
                    <td className="amount-cell">{formatCurrency(record.expected_amount_paise)}</td>
                    <td className="mono-cell">{record.reference_hint}</td>
                    <td>{record.business_type}</td>
                    <td className="mono-cell">{record.settlement_id ?? '—'}</td>
                    <td className="amount-cell">{formatCurrency(record.actual_amount_paise)}</td>
                    <td className="amount-cell">{formatCurrency(residual)}</td>
                    <td>{record.primary_cause.replaceAll('_', ' ')}</td>
                    <td><span className={`badge ${toneMap[record.status] ?? 'muted'}`}>{record.status}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="empty-state">Run a batch to populate the spreadsheet.</div>}
    </section>
  )
}

function ManualReconciliationPage({ records, summary, loading, loadBatch, openDetail }) {
  const [unifiedGrid, setUnifiedGrid] = useState(false)
  const expected = records
  const settlements = records.filter((record) => record.settlement_id)
  const expectedTotal = records.reduce((sum, record) => sum + (record.expected_amount_paise || 0), 0)
  const actualTotal = records.reduce((sum, record) => sum + (record.actual_amount_paise || 0), 0)

  return (
    <section className="manual-page">
      <div className="manual-toolbar panel"><div className="date-heading"><span className="date-icon">▦</span><div><p className="eyebrow">Active settlement date</p><h3>August 24, 2026</h3></div></div><div className="manual-actions"><div className="segmented"><button type="button" className={!unifiedGrid ? 'active' : ''} onClick={() => setUnifiedGrid(false)}>Side-by-side ledger</button><button type="button" className={unifiedGrid ? 'active' : ''} onClick={() => setUnifiedGrid(true)}>Unified grid</button></div><button type="button" className="primary" onClick={() => loadBatch(55)} disabled={loading}>↻ {loading ? 'Reconciling...' : 'Reconcile all 55'}</button><button type="button" className="secondary" onClick={() => exportCsv(records, 'residual-ledger.csv')} disabled={!records.length}>↓ Export CSV</button></div></div>
      <div className="manual-kpis"><div><span>Expected volume</span><strong>{formatCurrency(expectedTotal)}</strong><small>{summary.total_records || 0} records loaded</small></div><div><span>Actual gateway settle</span><strong>{formatCurrency(actualTotal)}</strong><small>Net after fees and tax</small></div><div><span>Discrepancies found</span><strong className="rust-text">{summary.needs_attention || 0} rows</strong><small>Action required</small></div><div><span>Reconciliation rate</span><strong>{formatPercent(summary.pair_rate)}</strong><div className="progress-track"><span style={{ width: `${summary.pair_rate || 0}%` }} /></div></div></div>
      {unifiedGrid ? <SpreadsheetView records={records} openDetail={openDetail} /> : <div className="dual-ledger-grid"><LedgerTable title="Merchant expected records" source="SOURCE: ERP / EXPECTED" records={expected} expected openDetail={openDetail} /><LedgerTable title="Gateway settlements (Razorpay)" source="SOURCE: RAZORPAY / SETTLED" records={settlements} openDetail={openDetail} /></div>}
      <div className="assistant-banner panel"><span className="agent-avatar">R</span><div><h3>Residual AI Reconciliation Assistant</h3><p>{records.length ? `${summary.needs_attention || 0} anomalies detected requiring human review. The agent has pre-analyzed matching and arithmetic evidence.` : 'Run reconciliation to let the agent analyze the batch.'}</p></div><button type="button" className="primary" onClick={loadBatch} disabled={loading}>⚡ Auto-analyze batch</button></div>
    </section>
  )
}

function LedgerTable({ title, source, records, expected, openDetail }) {
  return <section className="ledger-table panel"><div className="ledger-table-head"><div><span className={`source-dot ${expected ? 'blue' : 'amber'}`} /><h3>{title}</h3></div><code>{source}</code></div><div className="table-scroll"><table><thead><tr>{expected ? <><th>ID / reference</th><th>Expected amount</th><th>Business type</th></> : <><th>Settlement ID</th><th>Actual settled</th><th>Cause</th></>}<th>Action</th></tr></thead><tbody>{records.length ? records.map((record) => <tr key={record.record_id} onClick={() => openDetail(record.record_id)}>{expected ? <><td className="mono-cell">{record.record_id}<small>{record.reference_hint || 'Reference in evidence trace'}</small></td><td className="amount-cell">{formatCurrency(record.expected_amount_paise)}</td><td>{record.business_type}</td></> : <><td className="mono-cell">{record.settlement_id}<small>{record.record_id}</small></td><td className="amount-cell">{formatCurrency(record.actual_amount_paise)}</td><td><span className={`badge ${toneMap[record.status] || 'muted'}`}>{record.primary_cause.replaceAll('_', ' ')}</span></td></>}<td><button type="button" className="icon-action" aria-label={`Inspect ${record.record_id}`}>◉</button></td></tr>) : <tr><td colSpan="4"><div className="empty-state">Run reconciliation to populate this ledger.</div></td></tr>}</tbody></table></div><div className="table-footer">Showing {records.length} records from the current synthetic batch</div></section>
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

function ExceptionsPage({ summary, exceptionList, records, openDetail }) {
  const exceptionRecords = records.filter((record) => record.status !== 'matched')
  const categoryCount = (name) => records.filter((record) => record.primary_cause === name).length
  const [search, setSearch] = useState('')
  const [causeFilter, setCauseFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [selected, setSelected] = useState([])
  const [rulesOpen, setRulesOpen] = useState(true)
  const filteredRecords = exceptionRecords.filter((record) => {
    const haystack = `${record.record_id} ${record.settlement_id || ''} ${record.primary_cause} ${record.business_type}`.toLowerCase()
    const variance = Math.abs((record.actual_amount_paise ?? 0) - record.expected_amount_paise)
    const severityMatch = !severityFilter || (severityFilter === 'high' ? variance > 1_000_000 : severityFilter === 'medium' ? variance >= 100_000 : variance < 100_000)
    return haystack.includes(search.toLowerCase()) && (!causeFilter || record.primary_cause === causeFilter) && severityMatch
  })
  const toggleSelected = (recordId) => setSelected((current) => current.includes(recordId) ? current.filter((id) => id !== recordId) : [...current, recordId])
  const toggleAll = () => setSelected(selected.length === filteredRecords.length ? [] : filteredRecords.map((record) => record.record_id))

  return (
    <section className="exceptions-page">
      <div className="exceptions-heading"><div><p className="eyebrow">Settlement reconciliation · {summary.unresolved_records || 0} unresolved</p><h3>Exceptions &amp; Review Queue</h3></div><div className="exception-actions"><button type="button" className="secondary" onClick={() => setRulesOpen((value) => !value)}>☷ {rulesOpen ? 'Hide rules' : 'Configure rules'}</button><button type="button" className="primary" onClick={() => setSelected([])}>✓ Bulk triage selected ({selected.length})</button></div></div>
      <div className="exception-kpis"><div><span>Total discrepancies</span><strong>{formatCurrency(Math.abs(summary.needs_attention * 10000))}</strong><small>↑ Review required</small></div><div><span>MDR fee mismatch</span><strong>{categoryCount('mdr_fee')} Items</strong><small>Processing fee variance</small></div><div><span>GST on fee variance</span><strong>{categoryCount('gst_on_fee')} Items</strong><small>Tax variance</small></div><div><span>Tax deduction issues</span><strong>{categoryCount('tds')} Items</strong><small>TDS review</small></div></div>
      <div className="exception-filter"><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search exceptions" placeholder="⌕  Search by UTR, merchant name, or ID" /><select value={causeFilter} onChange={(event) => setCauseFilter(event.target.value)} aria-label="Filter by cause"><option value="">Cause: All Causes</option>{Object.keys(summary.exception_categories || {}).map((cause) => <option key={cause} value={cause}>{cause.replaceAll('_', ' ')}</option>)}</select><select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} aria-label="Filter by severity"><option value="">Severity: All</option><option value="high">High (&gt; ₹10,000)</option><option value="medium">Medium</option><option value="low">Low (&lt; ₹1,000)</option></select><span>Showing {Math.min(filteredRecords.length, 10)} of {filteredRecords.length} exceptions</span></div>
      <div className="exception-table-wrap"><table className="exception-table"><thead><tr><th><input type="checkbox" checked={filteredRecords.length > 0 && selected.length === filteredRecords.length} onChange={toggleAll} aria-label="Select all exceptions" /></th><th>Record ID / UTR</th><th>Merchant</th><th>Cause</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Actions</th></tr></thead><tbody>{filteredRecords.length ? filteredRecords.slice(0, 10).map((record) => <tr key={record.record_id} onClick={() => openDetail(record.record_id)}><td><input type="checkbox" checked={selected.includes(record.record_id)} onChange={() => toggleSelected(record.record_id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${record.record_id}`} /></td><td className="mono-cell">{record.record_id}<small>{record.settlement_id || 'No settlement'}</small></td><td>Merchant ledger<small>{record.business_type}</small></td><td><span className="cause-pill">{record.primary_cause.replaceAll('_', ' ')}</span></td><td className="amount-cell">{formatCurrency(record.expected_amount_paise)}</td><td className="amount-cell">{formatCurrency(record.actual_amount_paise)}</td><td className="amount-cell variance-cell">{formatCurrency((record.actual_amount_paise ?? 0) - record.expected_amount_paise)}</td><td><button type="button" className="icon-action" onClick={(event) => { event.stopPropagation(); openDetail(record.record_id) }} aria-label={`Inspect ${record.record_id}`}>◉</button><button type="button" className="icon-action" onClick={(event) => { event.stopPropagation(); toggleSelected(record.record_id) }} aria-label={`Flag ${record.record_id}`}>⚑</button></td></tr>) : <tr><td colSpan="8"><div className="empty-state">{records.length ? 'No exceptions match these filters.' : 'Run a batch to populate the exceptions queue.'}</div></td></tr>}</tbody></table></div>
      {rulesOpen ? <div className="exception-lower"><section className="rules-panel panel"><div className="panel-header"><div><h3>Automated Tolerance Rules</h3><span>Configure acceptable variance thresholds for automated waiver approvals.</span></div><button type="button" className="secondary" onClick={() => setRulesOpen(false)}>Close</button></div>{[['MDR Micro-Variance Waiver', 'Automatically approve MDR fee discrepancies under ₹500 across all tiers.'], ['GST Rounding Adjustment Rule', 'Accept GST on fee variances caused by multi-state tax rounding differences.'], ['TDS Certificate Matching Window', 'Hold TDS deduction exceptions pending the quarterly certificate.']].map(([title, detail], index) => <div className="rule-row" key={title}><span className="rule-icon">{index === 1 ? '%' : index === 2 ? '▥' : '≡'}</span><div><strong>{title}</strong><small>{detail}</small></div><input type="checkbox" defaultChecked={index < 2} aria-label={`Toggle ${title}`} /></div>)}</section><aside className="audit-notice"><p className="eyebrow">Ledger integrity notice</p><h3>Daily Reconciliation Audit Active</h3><p>All unresolved variances older than 30 days are automatically escalated to the compliance desk according to statutory requirements.</p><small>Last sync · Operational</small></aside></div> : null}
    </section>
  )
}

export default App
