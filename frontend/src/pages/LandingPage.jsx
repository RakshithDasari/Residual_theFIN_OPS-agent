import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import BlurText from '../components/BlurText'
import CountUp from '../components/CountUp'
import SpotlightCard from '../components/SpotlightCard'

// ── Lightweight scroll-reveal (no GSAP needed) ────────────────────────────────
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]')
    if (!els.length) return
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target) } }),
      { threshold: 0.1 }
    )
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])
}

// ── Hero reconciliation card ──────────────────────────────────────────────────
function HeroCard() {
  return (
    <div className="lp-hero-card">
      <div className="lp-hcard-badge">
        <span className="lp-hcard-dot" />
        Batch processed · reconciled
      </div>
      <div className="lp-hcard-row">
        <span className="lp-hcard-label">Order</span>
        <code className="lp-hcard-id">ORD-1000</code>
      </div>
      <div className="lp-hcard-divider" />
      <div className="lp-hcard-row">
        <span>Expected</span>
        <strong className="lp-hcard-amount">₹3,541.00</strong>
      </div>
      <div className="lp-hcard-row">
        <span>Settled</span>
        <strong className="lp-hcard-amount">₹2,832.40</strong>
      </div>
      <div className="lp-hcard-row lp-hcard-row--gap">
        <span>Gap</span>
        <strong className="lp-hcard-amount lp-hcard-amount--gap">−₹708.60</strong>
      </div>
      <div className="lp-hcard-divider" />
      <div className="lp-hcard-cause">
        <span className="lp-hcard-pill">MDR fee + GST</span>
        <span className="lp-hcard-conf">95% confidence</span>
      </div>
      <p className="lp-hcard-expl">
        Razorpay deducted a 2% processing fee (₹63.48) and its 18% GST before settlement. UTR matched exactly — no dispute, no missing payment.
      </p>
      <div className="lp-hcard-footer">
        <span className="lp-hcard-status">Explained</span>
        <span className="lp-hcard-trace">exact_match → arithmetic → ✓</span>
      </div>
    </div>
  )
}

// ── Data ──────────────────────────────────────────────────────────────────────
const STEPS = [
  { n: '01', title: 'Ingest both ledgers',       body: 'Merchant order records vs Razorpay settlement exports. Two sources, two formats, one truth.' },
  { n: '02', title: 'Match by UTR reference',    body: 'Exact match first. Truncated or transposed references recovered by a fuzzy pass — basis recorded, not just the result.' },
  { n: '03', title: 'Split every gap',           body: 'Expected minus fees, minus GST, minus TDS, minus FX. What remains after arithmetic is the only thing worth explaining.' },
  { n: '04', title: 'Classify with evidence',    body: 'A reasoning model reads verified numbers. It names a cause only when arithmetic supports it. Unresolved means unresolved.' },
  { n: '05', title: 'Explain in plain English',  body: 'Every record gets a two-sentence explanation a finance team can read, act on, and file — with confidence attached.' },
]

const STATS = [
  { label: 'Pairing accuracy',   to: 100, suffix: '%', sub: 'deterministic · 55 records' },
  { label: 'Diagnosis accuracy', to: 100, suffix: '%', sub: 'scored on held-back labels' },
  { label: 'Adversarial records', to: 20, suffix: '',  sub: '10 medium · 10 hard' },
  { label: 'Batch latency',      to: 0,  display: '<1s', sub: 'no model wait' },
]

const FEATURES = [
  { icon: '⊟', title: 'Dual ledger',       body: 'Both sides on screen. Hover a row — its pair highlights. Mismatched records wear their badge without filtering.' },
  { icon: '▤', title: 'Ask the agent',     body: 'Plain-English questions, specific answers backed by real batch data. One order or the whole month.' },
  { icon: '▦', title: 'Records table',     body: 'Every record sortable and filterable by status, cause, amount. One click exports a CSV your accountant can import.' },
  { icon: '▣', title: 'Inference trace',   body: 'Every step the engine took: tool called, result returned, confidence assigned. No black box.' },
]

const STORY = [
  { tag: 'First attempt',  tone: 'bad',     title: 'The model tried to do everything', body: 'First build let the LLM decide when to call tools, run its own arithmetic, and format the answer. 45.5% pairing, 36.4% diagnosis. Confident, fast, mostly wrong.' },
  { tag: 'Root cause',     tone: 'neutral', title: 'Two bugs the logs did not show',    body: 'The HuggingFace router rejected a developer role Agno was sending. Its generated tool schema had an invalid catch-all field. Neither failure raised an exception.' },
  { tag: 'The fix',        tone: 'good',    title: 'Narrow the model\'s job to prose',   body: 'Deterministic code handles every fact: matching, arithmetic, settlement age. The model receives verified evidence and is asked for one thing — two sentences.' },
]

// ── Root ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  useReveal()

  return (
    <main className="lp">

      {/* Nav */}
      <nav className="lp-nav">
        <Link className="lp-brand" to="/">
          <span className="lp-brand-mark">R</span>
          Residual
        </Link>
        <div className="lp-nav-right">
          <span className="lp-nav-tag">Settlement intelligence · MVP</span>
          <Link className="lp-cta lp-cta--nav" to="/app">Open workspace →</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="lp-hero-eyebrow" data-reveal>
            <span className="lp-dot-pulse" />
            Settlement reconciliation · 55 records processed
          </div>

          {/* BlurText headline */}
          <h1 className="lp-h1">
            <BlurText
              text="Every rupee"
              delay={120}
              stepDuration={0.4}
              direction="bottom"
              className="lp-h1-line"
            />
            <BlurText
              text="accounted for."
              delay={90}
              stepDuration={0.4}
              direction="bottom"
              className="lp-h1-line lp-h1-accent"
            />
          </h1>

          <p className="lp-hero-sub" data-reveal>
            Residual reconciles a merchant's Razorpay settlements against expected records, explains every gap with arithmetic evidence, and surfaces the records that need a human.
          </p>
          <div className="lp-hero-actions" data-reveal>
            <Link className="lp-cta lp-cta--primary" to="/app">Enter workspace →</Link>
            <Link className="lp-cta lp-cta--ghost" to="/app/ledger">View dual ledger</Link>
          </div>

          {/* CountUp stat tickers */}
          <div className="lp-tickers" data-reveal>
            <div className="lp-ticker">
              <span className="lp-ticker-value">
                <CountUp to={100} suffix="%" duration={1.8} />
              </span>
              <span className="lp-ticker-label">Pairing accuracy</span>
            </div>
            <div className="lp-ticker">
              <span className="lp-ticker-value">
                <CountUp to={100} suffix="%" duration={2.0} delay={0.2} />
              </span>
              <span className="lp-ticker-label">Diagnosis accuracy</span>
            </div>
            <div className="lp-ticker">
              <span className="lp-ticker-value">
                <CountUp to={55} duration={1.6} />
              </span>
              <span className="lp-ticker-label">Records reconciled</span>
            </div>
            <div className="lp-ticker">
              <span className="lp-ticker-value">&lt;1s</span>
              <span className="lp-ticker-label">Batch latency</span>
            </div>
          </div>
        </div>

        <div className="lp-hero-visual" data-reveal>
          <HeroCard />
          <div className="lp-hero-glow" aria-hidden="true" />
        </div>
      </section>

      {/* Pipeline */}
      <section className="lp-section lp-section--cream">
        <div className="lp-section-inner">
          <div className="lp-section-head" data-reveal>
            <p className="lp-eyebrow">The pipeline</p>
            <h2 className="lp-h2">Automation with a paper trail.</h2>
            <p className="lp-section-sub">Five deterministic steps before a model is ever consulted. Every number the agent quotes was produced by code, not by inference.</p>
          </div>
          <div className="lp-steps">
            {STEPS.map((s, i) => (
              <div className="lp-step" key={s.n} data-reveal style={{ '--delay': `${i * 80}ms` }}>
                <div className="lp-step-num">{s.n}</div>
                <h3 className="lp-step-title">{s.title}</h3>
                <p className="lp-step-body">{s.body}</p>
                {i < STEPS.length - 1 && <div className="lp-step-arrow" aria-hidden="true">→</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="lp-section lp-section--dark">
        <div className="lp-section-inner">
          <div className="lp-section-head" data-reveal>
            <p className="lp-eyebrow lp-eyebrow--light">Measured, not marketed</p>
            <h2 className="lp-h2 lp-h2--light">Results that tell the whole story.</h2>
          </div>
          <div className="lp-stat-grid">
            {STATS.map((s, i) => (
              <div className="lp-stat" key={s.label} data-reveal style={{ '--delay': `${i * 100}ms` }}>
                <strong className="lp-stat-value">
                  {s.display
                    ? s.display
                    : <><CountUp to={s.to} duration={1.8} delay={0.3} />{s.suffix}</>}
                </strong>
                <span className="lp-stat-label">{s.label}</span>
                <span className="lp-stat-sub">{s.sub}</span>
              </div>
            ))}
          </div>
          <p className="lp-stat-note" data-reveal>
            Numbers from <code>evaluation/eval.py</code>, scored against labels the engine never sees. Pairing accuracy measures whether the correct settlement was found. Diagnosis accuracy measures whether the correct cause was named.
          </p>
        </div>
      </section>

      {/* Features — SpotlightCard */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <div className="lp-section-head" data-reveal>
            <p className="lp-eyebrow">What's inside</p>
            <h2 className="lp-h2">Four surfaces. One workflow.</h2>
          </div>
          <div className="lp-feature-grid">
            {FEATURES.map((f, i) => (
              <SpotlightCard
                key={f.title}
                className="lp-feature"
                spotlightColor="rgba(31, 58, 95, 0.10)"
              >
                <div className="lp-feature-icon" data-reveal style={{ '--delay': `${i * 60}ms` }}>
                  {f.icon}
                </div>
                <h3 className="lp-feature-title" data-reveal style={{ '--delay': `${i * 60 + 40}ms` }}>{f.title}</h3>
                <p className="lp-feature-body" data-reveal style={{ '--delay': `${i * 60 + 80}ms` }}>{f.body}</p>
              </SpotlightCard>
            ))}
          </div>
        </div>
      </section>

      {/* Engineering story */}
      <section className="lp-section lp-section--dark">
        <div className="lp-section-inner">
          <div className="lp-section-head" data-reveal>
            <p className="lp-eyebrow lp-eyebrow--light">The honest engineering story</p>
            <h2 className="lp-h2 lp-h2--light">What it took to get to 100%.</h2>
          </div>
          <div className="lp-story-grid">
            {STORY.map((s, i) => (
              <div className={`lp-story-card lp-story-card--${s.tone}`} key={s.title} data-reveal style={{ '--delay': `${i * 100}ms` }}>
                <span className="lp-story-tag">{s.tag}</span>
                <h3 className="lp-story-title">{s.title}</h3>
                <p className="lp-story-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MVP boundary */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <div className="lp-section-head" data-reveal>
            <p className="lp-eyebrow">MVP boundary</p>
            <h2 className="lp-h2">Ready for integration.<br />Not pretending to be one.</h2>
          </div>
          <div className="lp-boundary-grid">
            <div className="lp-boundary-card" data-reveal>
              <div className="lp-boundary-label">Today</div>
              <p>A working read-only demo: 55 synthetic records, eight business types, a FastAPI backend, and a React workspace with four views.</p>
            </div>
            <div className="lp-boundary-card lp-boundary-card--accent" data-reveal style={{ '--delay': '80ms' }}>
              <div className="lp-boundary-label">Production path</div>
              <p>Connect a merchant's order or invoice stream via API or webhook. Continuously ingest Razorpay settlements. Apply the same evidence-first engine to real transactions.</p>
            </div>
            <div className="lp-boundary-card" data-reveal style={{ '--delay': '160ms' }}>
              <div className="lp-boundary-label">Challenges faced</div>
              <p>Provider role incompatibilities, schema validation failures, silent model errors, and the question of what a confident explanation actually means in accounting.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-cta-strip" data-reveal>
        <div className="lp-section-inner lp-cta-strip-inner">
          <h2 className="lp-cta-strip-h">See it reconcile a real batch.</h2>
          <p className="lp-cta-strip-sub">55 records · 100% paired · every gap explained</p>
          <Link className="lp-cta lp-cta--primary lp-cta--lg" to="/app">Open the workspace →</Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-section-inner lp-footer-inner">
          <span className="lp-footer-brand">Residual</span>
          <span className="lp-footer-copy">Settlement reconciliation · deterministic engine + reasoning agent</span>
          <Link className="lp-footer-link" to="/app">Open workspace →</Link>
        </div>
      </footer>

    </main>
  )
}
