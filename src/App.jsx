import { useState, useEffect } from 'react'

const API_URL = '/api/hubspot'

export default function App() {
  const [screen, setScreen] = useState('loading')
  const [contact, setContact] = useState(null)
  const [engineers, setEngineers] = useState([])
  const [ratings, setRatings] = useState({})
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [respondentName, setRespondentName] = useState('')
  const [respondentRole, setRespondentRole] = useState('')
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const contactId = params.get('contact')
    if (contactId) {
      loadContact(contactId)
    } else {
      setScreen('no-contact')
    }
  }, [])

  const apiCall = async (body) => {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!resp.ok) throw new Error(`API error: ${resp.status}`)
    return resp.json()
  }

  const loadContact = async (contactId) => {
    setScreen('loading')
    setError(null)
    try {
      const data = await apiCall({ action: 'get_contact', contactId })
      if (!data.engineers || data.engineers.length === 0) {
        setError('No engineers found for this contact. Make sure Engineer 1-5 properties have names filled in.')
        setScreen('error')
        return
      }
      setContact(data.contact)
      setEngineers(data.engineers)
      const initialRatings = {}
      data.engineers.forEach(e => { initialRatings[e.slot] = null })
      setRatings(initialRatings)
      setCurrentStep(0)
      setScreen('form')
    } catch (err) {
      setError('Failed to load contact: ' + err.message)
      setScreen('error')
    }
  }

  const handleRating = (slot, value) => {
    setRatings(prev => {
      const updated = { ...prev, [slot]: value }
      return updated
    })
    // Auto-advance to next question after a small delay
    const currentIndex = engineers.findIndex(e => e.slot === slot)
    if (currentIndex < engineers.length - 1) {
      setTimeout(() => setCurrentStep(currentIndex + 1), 400)
    }
  }

  const allRated = engineers.length > 0 && engineers.every(e => ratings[e.slot] !== null)

  const submitFeedback = async () => {
    if (!allRated || !respondentName) return
    setSubmitting(true)
    setError(null)

    try {
      // Build one note with all scores
      let noteRows = engineers.map(e => {
        const r = ratings[e.slot]
        const label = r <= 7 ? 'Needs Improvement' : r === 8 ? 'Meeting Expectations' : 'Exceeded Expectations'
        return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><strong>${e.name}</strong></td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${r}/10</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${label}</td></tr>`
      }).join('')

      const avgScore = (engineers.reduce((sum, e) => sum + ratings[e.slot], 0) / engineers.length).toFixed(1)

      const noteBody = [
        `<h2>CSAT Feedback — ${contact.company}</h2>`,
        `<p><strong>Learning Manager:</strong> ${contact.firstname} ${contact.lastname}</p>`,
        `<p><strong>Submitted by:</strong> ${respondentName}${respondentRole ? ' (' + respondentRole + ')' : ''}</p>`,
        `<p><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`,
        `<p><strong>Average Score:</strong> ${avgScore}/10</p>`,
        `<br/>`,
        `<table style="border-collapse:collapse;width:100%">`,
        `<tr style="background:#f7f7f7"><th style="padding:8px 12px;text-align:left">Smart Worker</th><th style="padding:8px 12px;text-align:center">Score</th><th style="padding:8px 12px;text-align:left">Rating</th></tr>`,
        noteRows,
        `</table>`
      ].join('')

      await apiCall({
        action: 'submit_feedback',
        contactId: contact.id,
        noteBody
      })

      setScreen('submitted')
    } catch (err) {
      setError('Submission failed: ' + err.message)
    }
    setSubmitting(false)
  }

  const getRatingColor = (value) => {
    if (!value) return 'transparent'
    if (value <= 7) return '#dc2626'
    if (value === 8) return '#d97706'
    return '#059669'
  }

  const getRatingLabel = (value) => {
    if (!value) return ''
    if (value <= 7) return 'Needs Improvement'
    if (value === 8) return 'Meeting Expectations'
    return 'Exceeded Expectations'
  }

  // LOADING
  if (screen === 'loading') {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
          <span className="loader" style={{ width: 32, height: 32 }} />
          <p style={{ marginTop: '1rem', color: '#888' }}>Loading your feedback form...</p>
        </div>
      </div>
    )
  }

  // NO CONTACT IN URL
  if (screen === 'no-contact') {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
          <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: '1.5rem', marginBottom: '0.5rem' }}>Missing contact link</h2>
          <p style={{ color: '#888' }}>This form requires a contact-specific link from your CS team.</p>
          <p style={{ color: '#aaa', fontSize: '0.8rem', marginTop: '1rem' }}>Expected format: ?contact=123456789</p>
        </div>
      </div>
    )
  }

  // ERROR
  if (screen === 'error') {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
          <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: '1.5rem', marginBottom: '0.5rem', color: '#dc2626' }}>Something went wrong</h2>
          <p style={{ color: '#888' }}>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="container">
        {/* HEADER */}
        <header className="header">
          <div className="eyebrow">Client Feedback</div>
          <h1 className="title">Smart Worker<br />Performance Review</h1>
          {contact && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#f0efec', borderRadius: '8px' }}>
              <div style={{ fontSize: '0.9rem' }}><strong>{contact.company}</strong></div>
              <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.15rem' }}>
                Learning Manager: {contact.firstname} {contact.lastname}
              </div>
            </div>
          )}
          <p className="subtitle" style={{ marginTop: '0.75rem' }}>
            Rate each Smart Worker on a scale of 1–10 based on delivery quality, communication, and ability to meet project timelines.
          </p>
          <div className="scale-legend">
            <span className="scale-item"><span className="scale-dot" style={{ background: '#dc2626' }} />1–7 Needs Improvement</span>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#d97706' }} />8 Meeting Expectations</span>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#059669' }} />9–10 Exceeded Expectations</span>
          </div>
        </header>

        {error && <div className="error-box">{error}</div>}

        {/* FORM */}
        {screen === 'form' && (
          <div>
            {/* Progress indicator */}
            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1.5rem' }}>
              {engineers.map((e, idx) => {
                const rated = ratings[e.slot] !== null
                return (
                  <div key={e.slot} style={{
                    flex: 1, height: 4, borderRadius: 2,
                    background: rated ? '#059669' : idx <= currentStep ? '#d4d2cd' : '#eee',
                    transition: 'background 0.3s'
                  }} />
                )
              })}
            </div>

            {/* Engineer rating cards — progressive reveal */}
            {engineers.map((eng, idx) => {
              const isVisible = idx <= currentStep
              const rated = ratings[eng.slot] !== null
              const ratingVal = ratings[eng.slot]

              if (!isVisible) return null

              return (
                <div key={eng.slot} className={`card ${rated ? 'card-rated' : ''} fade-in`} style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div className="worker-name">{eng.name}</div>
                      <div className="worker-sub">Engineer {eng.slot} of {engineers.length}</div>
                    </div>
                    {rated && (
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%',
                        background: getRatingColor(ratingVal), color: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: '1rem'
                      }}>
                        {ratingVal}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#555', lineHeight: 1.5 }}>
                    On a scale of 1 to 10, how would you rate <strong>{eng.name}</strong>'s overall performance? Consider their delivery quality, communication and ability to meet project timelines.
                  </div>

                  <div className="rating-row" style={{ marginTop: '0.75rem' }}>
                    {[1,2,3,4,5,6,7,8,9,10].map(n => {
                      const isSelected = ratingVal === n
                      const bg = isSelected ? getRatingColor(n) : undefined
                      return (
                        <button
                          key={n}
                          className={`rating-btn ${isSelected ? 'selected' : ''}`}
                          style={isSelected ? { background: bg, borderColor: bg } : {}}
                          onClick={() => handleRating(eng.slot, n)}
                        >
                          {n}
                        </button>
                      )
                    })}
                  </div>
                  <div className="rating-label" style={{ color: getRatingColor(ratingVal) }}>
                    {getRatingLabel(ratingVal)}
                  </div>
                </div>
              )
            })}

            {/* Show respondent fields + submit only after all engineers are rated */}
            {allRated && (
              <div className="fade-in" style={{ marginTop: '1.5rem' }}>
                <div style={{ padding: '1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#166534' }}>
                  All {engineers.length} engineer{engineers.length > 1 ? 's' : ''} rated. Please add your details and submit.
                </div>

                <div className="field">
                  <label className="label">Your Name *</label>
                  <input className="input" placeholder="e.g. John Smith" value={respondentName} onChange={e => setRespondentName(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">Your Role (optional)</label>
                  <input className="input" placeholder="e.g. Engineering Manager" value={respondentRole} onChange={e => setRespondentRole(e.target.value)} />
                </div>

                <div className="submit-row" style={{ marginTop: '1rem' }}>
                  <button
                    className="btn btn-primary"
                    disabled={!respondentName || submitting}
                    onClick={submitFeedback}
                  >
                    {submitting ? <><span className="loader loader-white" /> Submitting...</> : 'Submit Feedback'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUCCESS */}
        {screen === 'submitted' && (
          <div className="success fade-in">
            <div className="check-circle">✓</div>
            <h2 className="success-title">Thank you, {respondentName}</h2>
            <p className="success-text">
              Your feedback for {engineers.length} Smart Worker{engineers.length > 1 ? 's' : ''} at {contact?.company} has been recorded.
            </p>

            <div className="summary-card">
              <div className="summary-header">Summary</div>
              {engineers.map(eng => {
                const r = ratings[eng.slot]
                return (
                  <div key={eng.slot} className="summary-row">
                    <span className="summary-name">{eng.name}</span>
                    <span className="summary-score" style={{ color: getRatingColor(r) }}>{r}/10</span>
                  </div>
                )
              })}
              <div className="summary-row" style={{ borderTop: '2px solid #e8e6e2', marginTop: '0.25rem', paddingTop: '0.75rem' }}>
                <span className="summary-name" style={{ fontWeight: 700 }}>Average</span>
                <span className="summary-score" style={{ fontWeight: 700 }}>
                  {(engineers.reduce((sum, e) => sum + ratings[e.slot], 0) / engineers.length).toFixed(1)}/10
                </span>
              </div>
            </div>
          </div>
        )}

        <footer className="footer">
          Smart Worker Feedback System
        </footer>
      </div>
    </div>
  )
}
