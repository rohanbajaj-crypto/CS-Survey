import { useState, useEffect } from 'react'

const API_URL = '/api/hubspot'

export default function App() {
  const [screen, setScreen] = useState('loading')
  const [contact, setContact] = useState(null)
  const [engineers, setEngineers] = useState([])
  const [csatRatings, setCsatRatings] = useState({})
  const [aiRatings, setAiRatings] = useState({})
  const [comments, setComments] = useState({})
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
        setError('No engineers found for this contact. Make sure Engineer 1-10 properties have names filled in.')
        setScreen('error')
        return
      }
      setContact(data.contact)
      setEngineers(data.engineers)
      const initCsat = {}, initAi = {}, initComments = {}
      data.engineers.forEach(e => { initCsat[e.slot] = null; initAi[e.slot] = null; initComments[e.slot] = '' })
      setCsatRatings(initCsat)
      setAiRatings(initAi)
      setComments(initComments)
      setCurrentStep(0)
      setScreen('form')
    } catch (err) {
      setError('Failed to load contact: ' + err.message)
      setScreen('error')
    }
  }

  const bothRatedForSlot = (slot) => csatRatings[slot] !== null && aiRatings[slot] !== null

  const handleCsatRating = (slot, value) => {
    setCsatRatings(prev => ({ ...prev, [slot]: value }))
  }

  const handleAiRating = (slot, value) => {
    setAiRatings(prev => ({ ...prev, [slot]: value }))
  }

  const handleComment = (slot, value) => {
    setComments(prev => ({ ...prev, [slot]: value }))
  }

  // Auto-advance when both scores are filled for current engineer
  useEffect(() => {
    engineers.forEach((eng, idx) => {
      if (csatRatings[eng.slot] !== null && aiRatings[eng.slot] !== null && idx < engineers.length - 1) {
        setTimeout(() => setCurrentStep(prev => Math.max(prev, idx + 1)), 400)
      }
    })
  }, [csatRatings, aiRatings, engineers])

  const allRated = engineers.length > 0 && engineers.every(e => csatRatings[e.slot] !== null && aiRatings[e.slot] !== null)

  const submitFeedback = async () => {
    if (!allRated || !respondentName) return
    setSubmitting(true)
    setError(null)

    try {
      const scores = engineers.map(e => ({
        slot: e.slot,
        name: e.name,
        csat: csatRatings[e.slot],
        ai_score: aiRatings[e.slot],
        comment: comments[e.slot] || ''
      }))

      const avgCsat = (scores.reduce((sum, s) => sum + s.csat, 0) / scores.length).toFixed(1)
      const avgAi = (scores.reduce((sum, s) => sum + s.ai_score, 0) / scores.length).toFixed(1)

      let noteRows = scores.map(s => {
        const csatLabel = s.csat <= 7 ? 'Needs Improvement' : s.csat === 8 ? 'Meeting Expectations' : 'Exceeded Expectations'
        const aiLabel = s.ai_score <= 7 ? 'Needs Improvement' : s.ai_score === 8 ? 'Meeting Expectations' : 'Exceeded Expectations'
        let row = `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee"><strong>${s.name}</strong></td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${s.csat}/10</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${csatLabel}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${s.ai_score}/10</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${aiLabel}</td></tr>`
        if (s.comment) {
          row += `<tr><td colspan="5" style="padding:6px 12px 12px;border-bottom:2px solid #ddd;color:#555;font-style:italic">${s.csat <= 7 ? '<strong>Improvement feedback:</strong> ' : '<strong>Comments:</strong> '}${s.comment}</td></tr>`
        }
        return row
      }).join('')

      const noteBody = [
        `<h2>CSAT & AI Score Feedback — ${contact.company}</h2>`,
        `<p><strong>Learning Manager:</strong> ${contact.firstname} ${contact.lastname}</p>`,
        `<p><strong>Submitted by:</strong> ${respondentName}${respondentRole ? ' (' + respondentRole + ')' : ''}</p>`,
        `<p><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`,
        `<p><strong>Avg CSAT:</strong> ${avgCsat}/10 &nbsp; | &nbsp; <strong>Avg AI Score:</strong> ${avgAi}/10</p>`,
        `<br/>`,
        `<table style="border-collapse:collapse;width:100%">`,
        `<tr style="background:#f7f7f7"><th style="padding:8px 12px;text-align:left">Smart Worker</th><th style="padding:8px 12px;text-align:center">CSAT</th><th style="padding:8px 12px">Rating</th><th style="padding:8px 12px;text-align:center">AI Score</th><th style="padding:8px 12px">Rating</th></tr>`,
        noteRows,
        `</table>`
      ].join('')

      await apiCall({
        action: 'submit_feedback',
        contactId: contact.id,
        scores,
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

  const RatingRow = ({ label, value, onSelect }) => (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#444', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div className="rating-row">
        {[1,2,3,4,5,6,7,8,9,10].map(n => {
          const isSelected = value === n
          const bg = isSelected ? getRatingColor(n) : undefined
          return (
            <button
              key={n}
              className={`rating-btn ${isSelected ? 'selected' : ''}`}
              style={isSelected ? { background: bg, borderColor: bg } : {}}
              onClick={() => onSelect(n)}
            >
              {n}
            </button>
          )
        })}
      </div>
      <div className="rating-label" style={{ color: getRatingColor(value) }}>
        {getRatingLabel(value)}
      </div>
    </div>
  )

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
          <div className="scale-legend" style={{ marginTop: '0.75rem' }}>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#dc2626' }} />1–7 Needs Improvement</span>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#d97706' }} />8 Meeting Expectations</span>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#059669' }} />9–10 Exceeded Expectations</span>
          </div>
        </header>

        {error && <div className="error-box">{error}</div>}

        {screen === 'form' && (
          <div>
            {/* Progress bar */}
            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1.5rem' }}>
              {engineers.map((e, idx) => {
                const done = bothRatedForSlot(e.slot)
                return (
                  <div key={e.slot} style={{
                    flex: 1, height: 4, borderRadius: 2,
                    background: done ? '#059669' : idx <= currentStep ? '#d4d2cd' : '#eee',
                    transition: 'background 0.3s'
                  }} />
                )
              })}
            </div>

            {/* Engineer cards — progressive reveal */}
            {engineers.map((eng, idx) => {
              const isVisible = idx <= currentStep
              const done = bothRatedForSlot(eng.slot)
              const csatVal = csatRatings[eng.slot]
              const aiVal = aiRatings[eng.slot]
              const commentVal = comments[eng.slot]

              if (!isVisible) return null

              return (
                <div key={eng.slot} className={`card ${done ? 'card-rated' : ''} fade-in`} style={{ marginBottom: '1.25rem' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div className="worker-name">{eng.name}</div>
                      <div className="worker-sub">Engineer {eng.slot} of {engineers.length}</div>
                    </div>
                    {done && (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <div style={{ padding: '4px 10px', borderRadius: '99px', background: getRatingColor(csatVal), color: 'white', fontWeight: 700, fontSize: '0.75rem' }}>
                          CSAT {csatVal}
                        </div>
                        <div style={{ padding: '4px 10px', borderRadius: '99px', background: getRatingColor(aiVal), color: 'white', fontWeight: 700, fontSize: '0.75rem' }}>
                          AI {aiVal}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Question 1: CSAT */}
                  <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#333', lineHeight: 1.6 }}>
                    On a scale of 1 to 10, how would you rate <strong>{eng.name}</strong>'s overall performance?
                    <span style={{ display: 'block', fontSize: '0.78rem', color: '#888', marginTop: '0.15rem' }}>
                      Consider their delivery quality, communication and ability to meet project timelines.
                    </span>
                  </div>
                  <RatingRow
                    label="Overall Performance"
                    value={csatVal}
                    onSelect={(n) => handleCsatRating(eng.slot, n)}
                  />

                  {/* Question 2: AI Score — appears after CSAT is answered */}
                  {csatVal !== null && (
                    <div className="fade-in" style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #f0efec' }}>
                      <div style={{ fontSize: '0.85rem', color: '#333', lineHeight: 1.6 }}>
                        On a scale of 1 to 10, how effectively is <strong>{eng.name}</strong> using AI tools to improve speed and output quality?
                        <span style={{ display: 'block', fontSize: '0.78rem', color: '#888', marginTop: '0.15rem' }}>
                          Consider if AI use helped them deliver faster or better than a regular developer.
                        </span>
                      </div>
                      <RatingRow
                        label="AI Tool Adoption"
                        value={aiVal}
                        onSelect={(n) => handleAiRating(eng.slot, n)}
                      />
                    </div>
                  )}

                  {/* Conditional comment field — appears after both ratings */}
                  {done && (
                    <div className="fade-in" style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #f0efec' }}>
                      {csatVal <= 7 ? (
                        <>
                          <div style={{ padding: '0.6rem 0.8rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '0.82rem', color: '#991b1b', marginBottom: '0.6rem', lineHeight: 1.5 }}>
                            We're sorry to hear that. You gave us a low rating, and we'd really appreciate your feedback. What can we do to improve and make your experience better?
                          </div>
                          <textarea
                            className="input"
                            rows={3}
                            placeholder="Please share your feedback so we can improve..."
                            value={commentVal}
                            onChange={e => handleComment(eng.slot, e.target.value)}
                            style={{ resize: 'vertical', fontFamily: 'inherit' }}
                          />
                        </>
                      ) : (
                        <>
                          <label className="label">Additional Comments (optional)</label>
                          <textarea
                            className="input"
                            rows={2}
                            placeholder="Any additional feedback or comments..."
                            value={commentVal}
                            onChange={e => handleComment(eng.slot, e.target.value)}
                            style={{ resize: 'vertical', fontFamily: 'inherit' }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Respondent fields + submit */}
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
              {engineers.map(eng => (
                <div key={eng.slot} style={{ padding: '0.6rem 0', borderBottom: '1px solid #f0efec' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="summary-name">{eng.name}</span>
                    <span style={{ fontSize: '0.8rem' }}>
                      <span style={{ color: getRatingColor(csatRatings[eng.slot]), fontWeight: 700 }}>CSAT {csatRatings[eng.slot]}</span>
                      {' / '}
                      <span style={{ color: getRatingColor(aiRatings[eng.slot]), fontWeight: 700 }}>AI {aiRatings[eng.slot]}</span>
                    </span>
                  </div>
                  {comments[eng.slot] && (
                    <div style={{ fontSize: '0.78rem', color: '#666', fontStyle: 'italic', marginTop: '0.25rem' }}>
                      "{comments[eng.slot]}"
                    </div>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0 0', borderTop: '2px solid #e8e6e2', marginTop: '0.25rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Average</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                  CSAT {(engineers.reduce((sum, e) => sum + csatRatings[e.slot], 0) / engineers.length).toFixed(1)}
                  {' / '}
                  AI {(engineers.reduce((sum, e) => sum + aiRatings[e.slot], 0) / engineers.length).toFixed(1)}
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
