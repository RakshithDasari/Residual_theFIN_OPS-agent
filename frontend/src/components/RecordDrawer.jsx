import { causeLabel, formatCurrency, STATUS_TONES } from '../api'

// One drawer, shared by the agent stream and the records table, so a record looks the
// same wherever it was opened from.
export default function RecordDrawer({ record, onClose }) {
  if (!record) return null

  const residual =
    record.actual_amount_paise == null
      ? null
      : record.actual_amount_paise - record.expected_amount_paise

  return (
    <div className="detail-drawer" role="dialog" aria-modal="true" aria-label={`Record ${record.record_id}`}>
      <div className="detail-drawer-header">
        <div>
          <p className="eyebrow">Selected record</p>
          <h3>{record.record_id}</h3>
        </div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close detail panel">
          ×
        </button>
      </div>

      <div className="detail-grid">
        <div><span>Business type</span><strong>{record.business_type}</strong></div>
        <div><span>Status</span><strong className={`badge ${STATUS_TONES[record.status] ?? 'muted'}`}>{record.status}</strong></div>
        <div><span>Expected</span><strong>{formatCurrency(record.expected_amount_paise)}</strong></div>
        <div><span>Settled</span><strong>{formatCurrency(record.actual_amount_paise)}</strong></div>
        <div><span>Difference</span><strong>{residual == null ? 'No settlement' : formatCurrency(residual)}</strong></div>
        <div><span>Settlement</span><strong>{record.settlement_id ?? 'No settlement matched'}</strong></div>
        <div><span>Primary cause</span><strong>{causeLabel(record.primary_cause)}</strong></div>
        <div><span>Confidence</span><strong>{Math.round((record.confidence ?? 0) * 100)}%</strong></div>
      </div>

      <div className="explanation-block">
        <h4>What happened</h4>
        <p>{record.explanation}</p>
      </div>

      <div className="tags-wrap">
        {record.contributing_causes?.length ? (
          record.contributing_causes.map((cause) => (
            <span key={cause} className="tag">{causeLabel(cause)}</span>
          ))
        ) : (
          <span className="tag muted-tag">No contributing causes</span>
        )}
      </div>

      <div className="trace-block">
        <h4>Reasoning path</h4>
        <ul>
          {(record.trace ?? []).map((step, index) => {
            const failed = /not found|error|fail/i.test(step.result ?? '')
            return (
              <li key={`${step.step}-${index}`} className={`trace-item ${failed ? 'failed' : 'resolved'}`}>
                <div className="trace-topline">
                  <strong>{step.step}</strong>
                  <span className={`trace-state ${failed ? 'failed' : 'resolved'}`}>{step.result}</span>
                </div>
                <p>{step.detail}</p>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
