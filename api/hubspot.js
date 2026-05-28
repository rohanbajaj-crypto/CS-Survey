// Vercel Serverless Function — proxies HubSpot API calls
// Token stored as Vercel env var (HUBSPOT_TOKEN) — never exposed to client

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'HUBSPOT_TOKEN not configured. Add it in Vercel Settings > Environment Variables.' });

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }

  const { action, companyId, companyName, placementOrderId, noteBody } = body || {};

  const hubspotFetch = async (url, options = {}) => {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error('HubSpot API error:', url, resp.status, JSON.stringify(data));
      throw new Error(data.message || 'HubSpot API error: ' + resp.status);
    }
    return data;
  };

  try {
    // Search companies
    if (action === 'search_companies') {
      if (!companyName) return res.status(400).json({ error: 'companyName required' });
      const data = await hubspotFetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
        method: 'POST',
        body: JSON.stringify({
          query: companyName,
          limit: 10,
          properties: ['name', 'domain']
        })
      });
      return res.status(200).json({
        companies: (data.results || []).map(r => ({
          id: r.id,
          name: r.properties?.name,
          domain: r.properties?.domain
        }))
      });
    }

    // Get placement orders for a company
    if (action === 'get_placements') {
      if (!companyId) return res.status(400).json({ error: 'companyId required' });

      // Get deals associated with company
      let dealIds = [];
      try {
        const dealsData = await hubspotFetch(
          'https://api.hubapi.com/crm/v3/objects/companies/' + companyId + '/associations/deals'
        );
        dealIds = (dealsData.results || []).map(r => r.toObjectId || r.id);
      } catch (e) {
        // No deals, continue to try direct association
      }

      let allPlacements = [];

      // Via deals -> placement orders
      for (const dealId of dealIds) {
        try {
          const poData = await hubspotFetch(
            'https://api.hubapi.com/crm/v3/objects/deals/' + dealId + '/associations/0-970'
          );
          const poIds = (poData.results || []).map(r => r.toObjectId || r.id);

          if (poIds.length > 0) {
            const batchData = await hubspotFetch('https://api.hubapi.com/crm/v3/objects/0-970/batch/read', {
              method: 'POST',
              body: JSON.stringify({
                inputs: poIds.map(id => ({ id: String(id) })),
                properties: ['candidate_name', 'hs_object_id']
              })
            });
            const placements = (batchData.results || []).map(r => ({
              id: r.id,
              candidate_name: r.properties?.candidate_name || null
            }));
            allPlacements = allPlacements.concat(placements);
          }
        } catch (e) {
          // Association type may not exist
        }
      }

      // Direct company -> placement orders
      try {
        const directData = await hubspotFetch(
          'https://api.hubapi.com/crm/v3/objects/companies/' + companyId + '/associations/0-970'
        );
        const directIds = (directData.results || []).map(r => r.toObjectId || r.id)
          .filter(id => !allPlacements.some(p => String(p.id) === String(id)));

        if (directIds.length > 0) {
          const batchData = await hubspotFetch('https://api.hubapi.com/crm/v3/objects/0-970/batch/read', {
            method: 'POST',
            body: JSON.stringify({
              inputs: directIds.map(id => ({ id: String(id) })),
              properties: ['candidate_name', 'hs_object_id']
            })
          });
          const placements = (batchData.results || []).map(r => ({
            id: r.id,
            candidate_name: r.properties?.candidate_name || null
          }));
          allPlacements = allPlacements.concat(placements);
        }
      } catch (e) {
        // Direct association might not exist
      }

      return res.status(200).json({ placements: allPlacements });
    }

    // Submit feedback
    if (action === 'submit_feedback') {
      if (!placementOrderId || !noteBody) return res.status(400).json({ error: 'placementOrderId and noteBody required' });

      let noteId = null;
      let method = 'associated';

      try {
        const noteData = await hubspotFetch('https://api.hubapi.com/crm/v3/objects/notes', {
          method: 'POST',
          body: JSON.stringify({
            properties: {
              hs_note_body: noteBody,
              hs_timestamp: new Date().toISOString()
            },
            associations: [{
              to: { id: Number(placementOrderId) },
              types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 1 }]
            }]
          })
        });
        noteId = noteData.id;
      } catch (e) {
        // Fallback: note without association
        try {
          const fallbackData = await hubspotFetch('https://api.hubapi.com/crm/v3/objects/notes', {
            method: 'POST',
            body: JSON.stringify({
              properties: {
                hs_note_body: noteBody + '\n[Placement Order ID: ' + placementOrderId + ']',
                hs_timestamp: new Date().toISOString()
              }
            })
          });
          noteId = fallbackData.id;
          method = 'fallback';
        } catch (e2) {
          return res.status(500).json({ error: 'Failed to create note: ' + e2.message });
        }
      }

      return res.status(200).json({ success: true, noteId, method });
    }

    return res.status(400).json({ error: 'Unknown action. Use: search_companies, get_placements, submit_feedback' });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message });
  }
};
           
