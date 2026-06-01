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
        `<p><strong>Date
