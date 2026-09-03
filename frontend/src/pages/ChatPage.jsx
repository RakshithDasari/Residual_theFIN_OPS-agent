import { useEffect, useRef, useState } from 'react'
import { askQuestion, BATCH_LIMIT, causeLabel, formatCurrency } from '../api'

// ─── Suggested prompts shown on the welcome screen ────────────────────────────
const PROMPTS = [
  { icon: '◎', label: "Why didn't ORD-1000 settle in full?" },
  { icon: '△', label: 'Which records need a human to review?' },
  { icon: '◈', label: 'Give me an overview of this batch' },
  { icon: '÷', label: 'How much was withheld as TDS?' },
]

// ─── UI element renderers ─────────────────────────────────────────────────────

// Mini status badge
function StatusBadge({ status }) {
  const map = {
    matched:    ['badge success', 'Matched'],
    explained:  ['badge info',    'Explained'],
    in_transit: ['badge muted',   'In Transit'],
    unresolved: ['badge danger',  'Unresolved'],
  }
  const [cls, label] = map[status] ?? ['badge muted', status]
  return <span className={cls}>{label}</span>
}

// Inline records table rendered inside an agent bubble
function RecordsCard({ rows }) {
  if (!rows?.length) return null
  return (
    <div className="chat-ui-card">
      <div className="chat-ui-table-wrap">
        <table className="chat-ui-table">
          <thead>
            <tr>
              <th>Record</th>
              <th>Expected</th>
              <th>Settled</th>
              <th>Gap</th>
              <th>Cause</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.diff ?? (r.settled != null ? r.settled - r.expected : null)
              return (
                <tr key={r.id} className={r.status === 'unresolved' ? 'chat-tr--flag' : ''}>
                  <td><code className="chat-record-id">{r.id}</code></td>
                  <td>{r.expected != null ? formatCurrency(r.expected * 100) : '—'}</td>
                  <td>{r.settled != null ? formatCurrency(r.settled * 100) : <span className="chat-nil">no settlement</span>}</td>
                  <td>
                    {diff != null
                      ? <span className={diff < 0 ? 'chat-neg' : diff > 0 ? 'chat-pos' : 'chat-ok'}>
                          {diff === 0 ? '✓' : `${diff < 0 ? '−' : '+'}${formatCurrency(Math.abs(diff) * 100)}`}
                        </span>
                      : '—'}
                  </td>
                  <td>{causeLabel(r.cause)}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows[0]?.explanation && (
        <p className="chat-ui-note">{rows[0].explanation}</p>
      )}
    </div>
  )
}

// Summary KPI strip rendered inside an agent bubble
function SummaryCard({ data }) {
  const kpis = [
    { label: 'Matched',     value: data.matched,       cls: 'kpi-green' },
    { label: 'Explained',   value: data.explained,     cls: 'kpi-blue' },
    { label: 'In Transit',  value: data.in_transit,    cls: 'kpi-amber' },
    { label: 'Unresolved',  value: data.unresolved,    cls: 'kpi-red' },
    { label: 'Need Action', value: data.needs_attention, cls: 'kpi-red' },
  ]
  return (
    <div className="chat-ui-card">
      <div className="chat-summary-grid">
        {kpis.map((k) => (
          <div key={k.label} className={`chat-kpi ${k.cls}`}>
            <strong>{k.value ?? '—'}</strong>
            <span>{k.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Single-record detail card
function RecordDetailCard({ data }) {
  const diff = data.diff ?? (data.settled != null ? data.settled - data.expected : null)
  return (
    <div className="chat-ui-card chat-ui-card--detail">
      <div className="chat-detail-header">
        <code className="chat-record-id chat-record-id--lg">{data.record_id}</code>
        <StatusBadge status={data.status} />
      </div>
      <div className="chat-detail-grid">
        <div><span>Expected</span><strong>{formatCurrency((data.expected ?? 0) * 100)}</strong></div>
        <div><span>Settled</span><strong>{data.settled != null ? formatCurrency(data.settled * 100) : 'No settlement'}</strong></div>
        <div><span>Difference</span>
          <strong className={diff < 0 ? 'chat-neg' : diff > 0 ? 'chat-pos' : 'chat-ok'}>
            {diff == null ? '—' : diff === 0 ? '✓ Balanced' : `${diff < 0 ? '−' : '+'}${formatCurrency(Math.abs(diff) * 100)}`}
          </strong>
        </div>
        <div><span>Cause</span><strong>{causeLabel(data.cause)}</strong></div>
        {data.confidence != null && (
          <div><span>Confidence</span><strong>{Math.round(data.confidence * 100)}%</strong></div>
        )}
      </div>
      {data.explanation && <p className="chat-ui-note">{data.explanation}</p>}
    </div>
  )
}

// Dispatcher — picks the right UI element from the `ui` payload
function UiBlock({ ui }) {
  if (!ui) return null
  if (ui.type === 'records')       return <RecordsCard rows={ui.rows} />
  if (ui.type === 'summary')       return <SummaryCard data={ui} />
  if (ui.type === 'record_detail') return <RecordDetailCard data={ui} />
  return null
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function AgentBubble({ msg }) {
  return (
    <div className="chat-row chat-row--agent">
      <div className="chat-msg-avatar" aria-hidden="true">R</div>
      <div className={`bubble bubble--agent${msg.error ? ' bubble--error' : ''}`}>
        {msg.pending ? (
          <div className="chat-thinking">
            <span className="dots" aria-label="Thinking"><i /><i /><i /></span>
            <span className="chat-thinking-label">Checking the batch…</span>
          </div>
        ) : (
          <>
            {msg.text && <p className="chat-bubble-text">{msg.text}</p>}
            <UiBlock ui={msg.ui} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [busy, setBusy]         = useState(false)
  const bottomRef               = useRef(null)
  const inputRef                = useRef(null)
  const isEmpty                 = messages.length === 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(text = input.trim()) {
    if (!text || busy) return

    const userMsg   = { id: `u-${Date.now()}`, role: 'user', text }
    const pendingId = `a-${Date.now()}`
    const pending   = { id: pendingId, role: 'agent', text: '', pending: true }

    // History for backend memory: prior settled turns only
    const history = messages
      .filter((m) => !m.pending && m.text)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))

    setMessages((prev) => [...prev, userMsg, pending])
    setInput('')
    setBusy(true)

    try {
      const payload = await askQuestion(text, BATCH_LIMIT, history)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? { ...m, text: payload.answer, ui: payload.ui ?? null, pending: false }
            : m
        )
      )
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? { ...m, text: `Something went wrong: ${err.message}`, pending: false, error: true }
            : m
        )
      )
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="chat-page">

      {/* ── Thread / welcome ── */}
      <div className="chat-thread" role="log" aria-live="polite">

        {isEmpty ? (
          <div className="chat-welcome">
            <div className="chat-welcome-hero">
              <div className="chat-welcome-avatar">R</div>
              <h2 className="chat-welcome-title">
                Hi, I'm <span className="chat-welcome-accent">Reya</span>
              </h2>
              <p className="chat-welcome-sub">
                Your personal reconciliation accountant. I've already processed this batch — ask me anything about it.
              </p>
            </div>
            <div className="chat-prompts">
              {PROMPTS.map((p) => (
                <button key={p.label} type="button" className="chat-prompt-card" onClick={() => send(p.label)}>
                  <span className="chat-prompt-icon">{p.icon}</span>
                  <span className="chat-prompt-label">{p.label}</span>
                  <span className="chat-prompt-arrow">→</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="chat-row chat-row--user">
                  <div className="bubble bubble--user">{msg.text}</div>
                </div>
              )
            }
            return <AgentBubble key={msg.id} msg={msg} />
          })
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Composer ── */}
      <div className="chat-composer-wrap">
        <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); send() }} aria-label="Send a message">
          <input
            ref={inputRef}
            type="text"
            className="chat-input-field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about a record, a fee, or the whole batch…"
            aria-label="Message input"
            disabled={busy}
            autoFocus
          />
          <button
            type="submit"
            className="chat-send-btn"
            disabled={!input.trim() || busy}
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 15V3M9 3L4 8M9 3L14 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
      </div>

    </div>
  )
}
