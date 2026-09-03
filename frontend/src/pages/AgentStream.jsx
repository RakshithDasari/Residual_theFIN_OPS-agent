import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { buildPipeline, buildTranscript, STAGE_MS } from '../agentScript'
import { causeLabel, formatCurrency, formatPercent } from '../api'
import RecordDrawer from '../components/RecordDrawer'

// The workspace takes no input. It replays the reconciliation the backend already
// finished, one stage at a time, so what you watch is a real run rather than a mock.
export default function AgentStream({ report, records, loading, errorText }) {
  const pipeline = useMemo(() => buildPipeline(report), [report])
  const transcript = useMemo(() => buildTranscript(report), [report])
  const [stage, setStage] = useState(0)
  const [openId, setOpenId] = useState(null)

  const total = pipeline.length + transcript.length

  useEffect(() => {
    setStage(0)
  }, [total])

  useEffect(() => {
    if (!total || stage >= total) return
    const timer = setTimeout(() => setStage((value) => value + 1), STAGE_MS)
    return () => clearTimeout(timer)
  }, [stage, total])

  const summary = report?.summary ?? {}
  const stagesDone = Math.min(stage, pipeline.length)
  const messagesShown = Math.max(0, stage - pipeline.length)
  const running = total > 0 && stage < total
  const openRecord = records.find((record) => record.record_id === openId) ?? null

  return (
    <div className="stream-layout">
      <section className="stream-main">
        <div className="stream-head">
          <div>
            <p className="eyebrow">Autonomous run · settlement date 24 Aug 2026</p>
            <h2>Reconciliation stream</h2>
          </div>
          <span className={`live-chip ${running ? 'pulsing' : ''}`}>
            {loading ? 'Loading batch' : running ? 'Replaying run' : 'Run complete'}
          </span>
        </div>

        {errorText ? <div className="banner error">{errorText}</div> : null}

        <ol className="stage-graph">
          {pipeline.map((step, index) => {
            const state = index < stagesDone ? 'done' : index === stagesDone && running ? 'active' : 'pending'
            return (
              <li key={step.id} className={`stage-node ${state}`}>
                <div className="stage-rail" aria-hidden="true">
                  <span className="stage-dot" />
                </div>
                <div className="stage-card">
                  <div className="stage-card-head">
                    <code>{step.tool}()</code>
                    <span className="stage-metric">{step.metric}</span>
                  </div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="transcript">
          {transcript.slice(0, messagesShown).map((message) => (
            <div className="chat-message agent-message" key={message.id}>
              <span className="message-mark">R</span>
              <div>
                <p>{message.text}</p>
                {message.recordId ? (
                  <button type="button" className="text-action" onClick={() => setOpenId(message.recordId)}>
                    Open {message.recordId} evidence →
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {running ? <div className="chat-message agent-message thinking"><span className="message-mark">R</span><span className="dots"><i /><i /><i /></span></div> : null}
        </div>
      </section>

      <aside className="stream-side">
        <section className="panel side-card">
          <div className="panel-header">
            <h3>This batch</h3>
            <span>{summary.total_records ?? 0} records</span>
          </div>
          <div className="batch-total">
            {formatPercent(summary.pair_rate)}
            <span>paired to a settlement</span>
          </div>
          <div className="progress-track"><span style={{ width: `${Math.min(summary.pair_rate ?? 0, 100)}%` }} /></div>
          <div className="batch-stat-row"><span>Matched outright</span><strong>{summary.matched_records ?? 0}</strong></div>
          <div className="batch-stat-row"><span>Explained by a deduction</span><strong>{summary.explained_records ?? 0}</strong></div>
          <div className="batch-stat-row"><span>Still in transit</span><strong>{summary.in_transit_records ?? 0}</strong></div>
          <div className="batch-stat-row"><span>Needs attention</span><strong className="rust-text">{summary.needs_attention ?? 0}</strong></div>
        </section>

        <section className="panel side-card">
          <div className="panel-header">
            <h3>Causes found</h3>
            <span>excluding clean records</span>
          </div>
          {Object.entries(summary.exception_categories ?? {}).length ? (
            <ul className="cause-list">
              {Object.entries(summary.exception_categories ?? {}).map(([cause, count]) => (
                <li key={cause}><span>{causeLabel(cause)}</span><strong>{count}</strong></li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">{loading ? 'Loading…' : 'Nothing to flag in this batch.'}</div>
          )}
        </section>

        <section className="panel side-card">
          <div className="panel-header"><h3>Needs a person</h3></div>
          {records.filter((record) => record.status === 'unresolved' || record.primary_cause === 'dispute_hold').slice(0, 4).map((record) => (
            <button type="button" className="attention-item" key={record.record_id} onClick={() => setOpenId(record.record_id)}>
              <strong>{record.record_id}</strong>
              <span className="attention-cause">{causeLabel(record.primary_cause)}</span>
              <small>{formatCurrency(record.expected_amount_paise)} · Inspect →</small>
            </button>
          ))}
          <Link className="text-action" to="/app/records">See all {summary.total_records ?? 0} records →</Link>
        </section>
      </aside>

      {openRecord ? <RecordDrawer record={openRecord} onClose={() => setOpenId(null)} /> : null}
    </div>
  )
}
