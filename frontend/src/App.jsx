import { useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import './App.css'
import { EMPTY_SUMMARY, fetchBatch } from './api'
import AgentStream from './pages/AgentStream'
import LandingPage from './pages/LandingPage'
import RecordsPage from './pages/RecordsPage'

const NAV_ITEMS = [
  { to: '', label: 'Reconciliation stream', icon: '▣' },
  { to: '/records', label: 'All records', icon: '▦' },
]

function DashboardShell() {
  const [report, setReport] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchBatch()
      .then((payload) => {
        if (cancelled) return
        setReport(payload.report ?? null)
        setMetrics(payload.metrics ?? null)
      })
      .catch((error) => {
        if (!cancelled) setErrorText(`Could not load the batch: ${error.message}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const records = report?.records ?? []
  const summary = report?.summary ?? EMPTY_SUMMARY

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block brand-inline">
          <Link className="brand-wordmark" to="/"><span className="brand-mark">R</span><span>Residual</span></Link>
        </div>

        <nav className="nav" aria-label="Main navigation">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={`/app${to}`}
              end={to === ''}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{icon}</span>{label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p className="eyebrow">Engine</p>
          <p>Deterministic reconciliation, scored against held-back labels.</p>
          {metrics ? (
            <p className="sidebar-metric">
              {Math.round(metrics.pairing_accuracy * 100)}% paired ·{' '}
              {Math.round(metrics.diagnosis_accuracy * 100)}% diagnosed
            </p>
          ) : null}
        </div>
      </aside>

      <main className="main-panel">
        <Routes>
          <Route
            index
            element={
              // Remounting when the batch arrives restarts the playback from stage one
              // without an effect that resets state.
              <AgentStream
                key={records.length}
                report={report}
                records={records}
                loading={loading}
                errorText={errorText}
              />
            }
          />
          <Route
            path="records"
            element={<RecordsPage records={records} summary={summary} loading={loading} />}
          />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app/*" element={<DashboardShell />} />
      </Routes>
    </BrowserRouter>
  )
}
