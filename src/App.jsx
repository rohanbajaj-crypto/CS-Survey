import { useState, useEffect, useRef } from 'react'

const API_URL = '/api/hubspot'

export default function App() {
  const [screen, setScreen] = useState('form') // form | submitted
  const [companySearch, setCompanySearch] = useState('')
  const [companies, setCompanies] = useState([])
  const [selectedCompany, setSelectedCompany] = useState(null)
  const [smartWorkers, setSmartWorkers] = useState([])
  const [ratings, setRatings] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [respondentName, setRespondentName] = useState('')
  const [respondentRole, setRespondentRole] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef(null)
  const dropdownRef = useRef(null)

  // Check for ?company= URL param (pre-fill)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const co = params.get('company')
    if (co) {
      setCompanySearch(co)
      searchCompanies(co, true)
    }
  }, [])

  // Close dropdown on outside click
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
      // Auto-select if exact match from URL param
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
        setError(`No placement orders found for ${company.name}. Ensure placement orders are associated and have candidate names populated.`)
      } else {
        setSmartWorkers(workers)
        const initialRatings = {}
        workers.forEach(w => { initialRatings[w.id] = null })
        setRatings(initialRatings)
      }
    } catch (err) {
      setError('Failed to load Smart Workers: ' + err.message)
    }
    setLoading(false)
  }

  const handleRating = (workerId, value) => {
    setRatings(prev => ({ ...prev, [workerId]: value }))
  }

  const allRated = smartWorkers.length > 0 && Object.values(ratings).every(r => r !== null)

  const submitFeedback = async () => {
    if (!allRated || !respondentName) return
    setSubmitting(true)
    setError(null)

    try {
      for (const w of smartWorkers) {
        const rating = ratings[w.id]
        const ratingLabel = rating <= 7 ? 'Needs Improvement' : rating === 8 ? 'Meeting Expectations' : 'Exceeded Expectations'
        const noteBody = [
          `<h3>CSAT Feedback — ${w.candidate_name || 'Smart Worker ' + w.id}</h3>`,
          `<p><strong>Rating:</strong> ${rating}/10 (${ratingLabel})</p>`,
          `<p><strong>Submitted by:</strong> ${respondentName}${respondentRole ? ' (' + respondentRole + ')' : ''}</p>`,
          `<p><strong>Company:</strong> ${selectedCompany.name}</p>`,
          `<p><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`
        ].join('')

        await apiCall({
          action: 'submit_feedback',
          placementOrderId: w.id,
          csatScore: rating,
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
    setRespondentName('')
    setRespondentRole('')
    setError(null)
  }

  return (
    <div className="page">
      <div className="container">
        {/* HEADER */}
        <header className="header">
          <div className="eyebrow">Client Feedback</div>
          <h1 className="title">Smart Worker<br />Performance Review</h1>
          <p className="subtitle">
            Rate each Smart Worker on a scale of 1–10 based on delivery quality, communication, and ability to meet project timelines.
          </p>
          <div className="scale-legend">
            <span className="scale-item"><span className="scale-dot" style={{ background: '#dc2626' }} />1–7 Needs Improvement</span>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#d97706' }} />8 Meeting Expectations</span>
            <span className="scale-item"><span className="scale-dot" style={{ background: '#059669' }} />9–10 Exceeded Expectations</span>
          </div>
        </header>

        {error && <div className="error-box">{error}</div>}

        {/* FORM SCREEN */}
        {screen === 'form' && (
          <div>
            {/* Company Search */}
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

            {/* Rating Form */}
            {smartWorkers.length > 0 && !loading && (
              <div className="fade-in">
                <div className="found-banner">
                  Found <strong>{smartWorkers.length} Smart Worker{smartWorkers.length > 1 ? 's' : ''}</strong> for {selectedCompany?.name}
                </div>

                <div className="field">
                  <label className="label">Your Name *</label>
                  <input className="input" placeholder="e.g. John Smith" value={respondentName} onChange={e => setRespondentName(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">Your Role (optional)</label>
                  <input className="input" placeholder="e.g. Engineering Manager" value={respondentRole} onChange={e => setRespondentRole(e.target.value)} />
                </div>

                <div className="section-label">Performance Ratings</div>

                {smartWorkers.map((w, idx) => {
                  const rated = ratings[w.id] !== null
                  const ratingVal = ratings[w.id]
                  return (
                    <div key={w.id} className={`card ${rated ? 'card-rated' : ''}`}>
                      <div className="worker-name">{w.candidate_name || `Smart Worker ${idx + 1}`}</div>
                      <div className="worker-sub">Placement #{idx + 1} of {smartWorkers.length}</div>
                      <div className="rating-row">
                        {[1,2,3,4,5,6,7,8,9,10].map(n => {
                          const isSelected = ratingVal === n
                          const bg = isSelected ? getRatingColor(n) : undefined
                          return (
                            <button
                              key={n}
                              className={`rating-btn ${isSelected ? 'selected' : ''}`}
                              style={isSelected ? { background: bg, borderColor: bg } : {}}
                              onClick={() => handleRating(w.id, n)}
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

                <div className="submit-row">
                  <button
                    className="btn btn-primary"
                    disabled={!allRated || !respondentName || submitting}
                    onClick={submitFeedback}
                  >
                    {submitting ? <><span className="loader loader-white" /> Submitting...</> : 'Submit Feedback'}
                  </button>
                  {!allRated && (
                    <span className="remaining-hint">
                      {Object.values(ratings).filter(r => r === null).length} rating{Object.values(ratings).filter(r => r === null).length > 1 ? 's' : ''} remaining
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUCCESS SCREEN */}
        {screen === 'submitted' && (
          <div className="success fade-in">
            <div className="check-circle">✓</div>
            <h2 className="success-title">Thank you, {respondentName}</h2>
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
                    <span className="summary-score" style={{ color: getRatingColor(r) }}>{r}/10</span>
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
