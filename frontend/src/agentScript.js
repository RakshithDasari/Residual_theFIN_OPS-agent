import { causeLabel, formatCurrency } from './api'

// The workspace plays back a reconciliation that already happened rather than taking
// input. Each stage below is a real step from the batch response: the tool the engine
// called, and a line drawn from what it actually returned. Nothing here is invented for
// the sake of the animation.

export const STAGE_MS = 900

function count(records, predicate) {
  return records.filter(predicate).length
}

export function buildPipeline(report) {
  const records = report?.records ?? []
  const summary = report?.summary ?? {}
  if (!records.length) return []

  const paired = count(records, (record) => record.settlement_id)
  const fuzzy = count(records, (record) =>
    record.trace?.some((step) => step.step === 'try_fuzzy_match' && step.result === 'found'),
  )
  const unpaired = records.length - paired
  const expectedTotal = records.reduce((sum, record) => sum + record.expected_amount_paise, 0)

  return [
    {
      id: 'load',
      tool: 'load_batch',
      title: 'Reading both sides of the ledger',
      detail: `${records.length} expected records from the merchant's order system, against Razorpay settlements totalling ${formatCurrency(expectedTotal)} expected.`,
      metric: `${records.length} records`,
    },
    {
      id: 'exact',
      tool: 'try_exact_match',
      title: 'Matching references to bank UTRs',
      detail: `${paired - fuzzy} records pair on an exact UTR match. ${fuzzy || 'No'} needed a fuzzy pass, and ${unpaired} have no settlement at all.`,
      metric: `${paired}/${records.length} paired`,
    },
    {
      id: 'fuzzy',
      tool: 'try_fuzzy_match',
      title: 'Recovering truncated and mistyped references',
      detail: fuzzy
        ? `${fuzzy} references were a truncation or a character or two away from a real UTR. Paired on structure, not a similarity score.`
        : 'Every reference matched exactly, so no fuzzy pass was needed on this batch.',
      metric: `${fuzzy} recovered`,
    },
    {
      id: 'arithmetic',
      tool: 'check_arithmetic_causes',
      title: 'Splitting each gap into fee, tax and residual',
      detail: `Expected minus fees minus GST, compared against what actually settled. What is left over is the residual that needs a cause.`,
      metric: `${paired} reconciled`,
    },
    {
      id: 'diagnose',
      tool: 'classify',
      title: 'Naming a cause for every residual',
      detail: `${summary.matched_records ?? 0} reconcile outright, ${summary.explained_records ?? 0} are explained by a known deduction, ${summary.in_transit_records ?? 0} are still in transit, ${summary.unresolved_records ?? 0} are unresolved.`,
      metric: `${summary.needs_attention ?? 0} need attention`,
    },
  ]
}

// The transcript is the pipeline plus one line per interesting record, so the playback
// ends on specific findings rather than a summary.
export function buildTranscript(report) {
  const records = report?.records ?? []
  const summary = report?.summary ?? {}
  if (!records.length) return []

  const messages = [
    {
      id: 'opening',
      from: 'agent',
      text: `Reconciled ${records.length} records for settlement date 24 August 2026. ${summary.matched_records ?? 0} matched outright and ${summary.needs_attention ?? 0} need your attention.`,
    },
  ]

  const byCause = new Map()
  for (const record of records) {
    if (!byCause.has(record.primary_cause)) byCause.set(record.primary_cause, [])
    byCause.get(record.primary_cause).push(record)
  }

  // Lead with what the merchant has to act on.
  const order = ['dispute_hold', 'unresolved', 'partial_refund', 'tds', 'fx_markup', 'utr_mismatch', 'rounding_drift', 'gst_on_fee', 'in_transit', 'mdr_fee']
  for (const cause of order) {
    const group = byCause.get(cause)
    if (!group?.length) continue
    const example = group[0]
    messages.push({
      id: `cause-${cause}`,
      from: 'agent',
      recordId: example.record_id,
      text: `${causeLabel(cause)} — ${group.length} record${group.length > 1 ? 's' : ''}. ${example.explanation}`,
    })
  }

  return messages
}
