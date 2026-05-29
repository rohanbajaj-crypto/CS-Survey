import { useState, useEffect, useRef } from 'react'

const API_URL = '/api/hubspot'

export default function App() {
  const [screen, setScreen] = useState('form')
  const [companySearch, setCompanySearch] = useState('')
  const [companies, setCompanies] = useState([])
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [smartWorkers, setSmartWorkers] = useState([])
  const [ratings, setRatings] = useState({})         // { [workerId]: { overall: null, ai: null, comment: '' } }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef(null)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const co = params.get('company')
    if (co) {
      setCompanySearch(co)
      searchCompanies(co, true)
    }
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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

  const searchCompanies = async (query, autoSelect = false) => {
    if (!query || query.length < 2) return
    setSearchLoading(true)
    setError(null)
    try {
      const data = await apiCall({ action: 'search_companies', companyName: query })
      setCompanies(data.companies || [])
      setShowDropdown(true)
      if (autoSelect && data.companies?.length === 1) {
        selectCompany(data.companies[0])
      }
    } catch (err) {
      setError('Failed to search companies. Check your connection.')
    }
    setSearchLoading(false)
  }

  const handleSearchInput = (val) => {
    setCompanySearch(val)
    setSelectedCompany(null)
    setSmartWorkers([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchCompanies(val), 500)
  }

  const selectCompany = async (company) => {
    setSelectedCompany(company)
    setCompanies([])
    setShowDropdown(false)
    setCompanySearch(company.name)
    setLoading(true)
    setError(null)

    try {
      const data = await apiCall({ action: 'get_placements', companyId: company.id })
      const workers = data.placements || []

      if (workers.length === 0) {
        setError(`No Smart Workers found for ${company.name}. Make sure contacts with Contact Type = "Smart Worker" are associated with this company.`)
      } else {
        setSmartWorkers(workers)
        const initialRatings = {}
        workers.forEach(w => {
          initialRatings[w.id] = { overall: null, ai: null, comment: '' }
        })
        setRatings(initialRatings)
      }
    } catch (err) {
      setError('Failed to load Smart Workers: ' + err.message)
    }
    setLoading(false)
  }

  const handleRating = (workerId, field, value) => {
    setRatings(prev => ({
      ...prev,
      [workerId]: { ...prev[workerId], [field]: value }
    }))
  }

  const handleComment = (workerId, value) => {
    setRatings(prev => ({
      ...prev,
      [workerId]: { ...prev[workerId], comment: value }
    }))
  }

  const allRated = smartWorkers.length > 0 &&
    smartWorkers.every(w => ratings[w.id]?.overall !== null && ratings[w.id]?.ai !== null)

  const submitFeedback = async () => {
    if (!allRated) return
    setSubmitting(true)
    setError(null)

    try {
      for (const w of smartWorkers) {
        const { overall, ai, comment } = ratings[w.id]
        const overallLabel = overall <= 7 ? 'Needs Improvement' : overall === 8 ? 'Meeting Expectations' : 'Exceeded Expectations'
        const aiLabel = ai <= 7 ? 'Needs Improvement' : ai === 8 ? 'Meeting Expectations' : 'Exceeded Expectations'

        const noteBody = [
          `<h3>CSAT Feedback — ${w.candidate_name || 'Smart Worker ' + w.id}</h3>`,
          `<p><strong>Overall Performance:</strong> ${overall}/10 (${overallLabel})</p>`,
          `<p><strong>AI Tools Usage:</strong> ${ai}/10 (${aiLabel})</p>`,
          comment ? `<p><strong>${overall <= 7 ? 'Improvement Feedback' : 'Additional Comments'}:</strong> ${comment}</p>` : '',
          `<p><strong>Company:</strong> ${selectedCompany.name}</p>`,
          `<p><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`
        ].join('')

        await apiCall({
          action: 'submit_feedback',
          contactId: w.id,
          csatScore: overall,
          aiScore: ai,
          noteBody
        })
      }
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

  const resetForm = () => {
    setScreen('form')
    setSmartWorkers([])
    setRatings({})
    setSelectedCompany(null)
    setCompanySearch('')
    setError(null)
  }

  return (
    <div className="page">
      <div className="container">
        <header className="header">
          <div className="eyebrow">Client Feedback</div>
          <h1 className="title">Smart Worker<br />Performance Review</h1>
          <p className="subtitle">
            Rate each Smart Worker across two dimensions. Scores are recorded directly against their profile.
          </p>
          <div className="scale-legend">
            <span className="scale-item"><span className="scale-dot" style={{ background: '#dc2626' }} />1–7 Needs Improvement</span>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#d97706' }} />8 Meeting Expectations</span>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#059669' }} />9–10 Exceeded Expectations</span>
          </div>
        </header>

        {error && <div className="error-box">{error}</div>}

        {screen === 'form' && (
          <div>
            <div className="field" ref={dropdownRef} style={{ position: 'relative' }}>
              <label className="label">Company</label>
              <input
                className="input"
                placeholder="Start typing a company name..."
                value={companySearch}
                onChange={e => handleSearchInput(e.target.value)}
              />
              {searchLoading && <div className="hint"><span className="loader" /> Searching...</div>}
              {showDropdown && companies.length > 0 && (
                <div className="dropdown">
                  {companies.map(c => (
                    <div key={c.id} className="dropdown-item" onClick={() => selectCompany(c)}>
                      <strong>{c.name}</strong>
                      {c.domain && <span className="domain-tag">{c.domain}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {loading && (
              <div className="loading-state">
                <span className="loader" /> Loading Smart Workers for {selectedCompany?.name}...
              </div>
            )}

            {smartWorkers.length > 0 && !loading && (
              <div className="fade-in">
                <div className="found-banner">
                  Found <strong>{smartWorkers.length} Smart Worker{smartWorkers.length > 1 ? 's' : ''}</strong> for {selectedCompany?.name}
                </div>

                <div className="section-label">Performance Ratings</div>

                {smartWorkers.map((w, idx) => {
                  const workerRatings = ratings[w.id] || { overall: null, ai: null, comment: '' }
                  const overallRated = workerRatings.overall !== null
                  const aiRated = workerRatings.ai !== null
                  const bothRated = overallRated && aiRated
                  const showLowScoreBox = overallRated && workerRatings.overall <= 7
                  const showCommentsBox = overallRated && workerRatings.overall >= 8

                  return (
                    <div key={w.id} className={`card ${bothRated ? 'card-rated' : ''}`}>
                      <div className="worker-name">{w.candidate_name || `Smart Worker ${idx + 1}`}</div>
                      <div className="worker-sub">
                        {w.jobtitle ? w.jobtitle + ' • ' : ''}Placement #{idx + 1} of {smartWorkers.length}
                      </div>

                      {/* Q1: Overall Performance */}
                      <div className="question-block">
                        <div className="question-text">
                          <span className="question-num">1.</span>
                          On a scale of 1 to 10, how would you rate your Smart Worker's overall performance? <span className="question-hint">Consider their delivery quality, communication and ability to meet project timelines.</span>
                        </div>
                        <div className="rating-row">
                          {[1,2,3,4,5,6,7,8,9,10].map(n => {
                            const isSelected = workerRatings.overall === n
                            const bg = isSelected ? getRatingColor(n) : undefined
                            return (
                              <button
                                key={n}
                                className={`rating-btn ${isSelected ? 'selected' : ''}`}
                                style={isSelected ? { background: bg, borderColor: bg } : {}}
                                onClick={() => handleRating(w.id, 'overall', n)}
                              >
                                {n}
                              </button>
                            )
                          })}
                        </div>
                        {overallRated && (
                          <div className="rating-label" style={{ color: getRatingColor(workerRatings.overall) }}>
                            {getRatingLabel(workerRatings.overall)}
                          </div>
                        )}
                      </div>

                      {/* Q2: AI Tools Usage */}
                      <div className="question-block">
                        <div className="question-text">
                          <span className="question-num">2.</span>
                          On a scale of 1–10, how effectively is your Smart Worker using AI tools to improve speed and output quality? <span className="question-hint">Consider if AI use helped them deliver faster or better than a regular developer.</span>
                        </div>
                        <div className="rating-row">
                          {[1,2,3,4,5,6,7,8,9,10].map(n => {
                            const isSelected = workerRatings.ai === n
                            const bg = isSelected ? getRatingColor(n) : undefined
                            return (
                              <button
                                key={n}
                                className={`rating-btn ${isSelected ? 'selected' : ''}`}
                                style={isSelected ? { background: bg, borderColor: bg } : {}}
                                onClick={() => handleRating(w.id, 'ai', n)}
                              >
                                {n}
                              </button>
                            )
                          })}
                        </div>
                        {aiRated && (
                          <div className="rating-label" style={{ color: getRatingColor(workerRatings.ai) }}>
                            {getRatingLabel(workerRatings.ai)}
                          </div>
                        )}
                      </div>

                      {/* Conditional follow-up based on overall score */}
                      {showLowScoreBox && (
                        <div className="followup-block followup-low">
                          <div className="followup-heading">😟 We're sorry to hear that.</div>
                          <div className="followup-desc">You gave us a low rating, and we'd really appreciate your feedback. What can we do to improve and make your experience better?</div>
                          <textarea
                            className="textarea"
                            placeholder="Please share your thoughts..."
                            value={workerRatings.comment}
                            onChange={e => handleComment(w.id, e.target.value)}
                            rows={3}
                          />
                        </div>
                      )}

                      {showCommentsBox && (
                        <div className="followup-block followup-high">
                          <div className="followup-heading">Additional Comments</div>
                          <textarea
                            className="textarea"
                            placeholder="Any other feedback you'd like to share? (optional)"
                            value={workerRatings.comment}
                            onChange={e => handleComment(w.id, e.target.value)}
                            rows={3}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}

                <div className="submit-row">
                  <button
                    className="btn btn-primary"
                    disabled={!allRated || submitting}
                    onClick={submitFeedback}
                  >
                    {submitting ? <><span className="loader loader-white" /> Submitting...</> : 'Submit Feedback'}
                  </button>
                  {!allRated && (
                    <span className="remaining-hint">
                      Please complete all ratings to submit
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {screen === 'submitted' && (
          <div className="success fade-in">
            <div className="check-circle">✓</div>
            <h2 className="success-title">Thank you!</h2>
            <p className="success-text">
              Your feedback for {smartWorkers.length} Smart Worker{smartWorkers.length > 1 ? 's' : ''} at {selectedCompany?.name} has been recorded.
            </p>

            <div className="summary-card">
              <div className="summary-header">Summary</div>
              {smartWorkers.map(w => {
                const r = ratings[w.id]
                return (
                  <div key={w.id} className="summary-row">
                    <span className="summary-name">{w.candidate_name || `Smart Worker ${w.id}`}</span>
                    <div className="summary-scores">
                      <span className="summary-score-item">
                        <span className="summary-score-label">Performance</span>
                        <span className="summary-score" style={{ color: getRatingColor(r?.overall) }}>{r?.overall}/10</span>
                      </span>
                      <span className="summary-score-item">
                        <span className="summary-score-label">AI Usage</span>
                        <span className="summary-score" style={{ color: getRatingColor(r?.ai) }}>{r?.ai}/10</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            <button className="btn btn-outline" onClick={resetForm}>
              Submit Another Review
            </button>
          </div>
        )}

        <footer className="footer">
          Smart Worker Feedback System
        </footer>
      </div>
    </div>
  )
}
