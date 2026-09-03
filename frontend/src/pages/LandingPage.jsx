import { Link } from 'react-router-dom'

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
        <div className="result-grid"><div><strong>100%</strong><span>pairing accuracy<br />deterministic engine, 55 records</span></div><div><strong>100%</strong><span>diagnosis accuracy<br />deterministic engine, 55 records</span></div><div><strong>20</strong><span>adversarial records<br />10 medium · 10 hard</span></div></div>
        <p className="results-note">These are the deterministic engine’s numbers, scored by <code>evaluation/eval.py</code> against labels the engine never sees. The reasoning agent is the explanation layer and is measured separately.</p>
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

export default LandingPage
