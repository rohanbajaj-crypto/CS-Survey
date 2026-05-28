// Vercel Serverless Function — proxies HubSpot API calls
// Your private app token is stored as a Vercel environment variable (HUBSPOT_TOKEN)
// The client never sees it

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'HUBSPOT_TOKEN not configured' });

  const { action, companyId, companyName, placementOrderId, noteBody } = req.body || {};

  try {
    // ACTION: Search companies by name
    if (action === 'search_companies') {
      const resp = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: [],
          query: companyName,
          limit: 10,
          properties: ['name', 'domain']
        })
      });
      const data = await resp.json();
      return res.status(200).json({
        companies: (data.results || []).map(r => ({
          id: r.id,
          name: r.properties?.name,
          domain: r.properties?.domain
        }))
      });
    }

    // ACTION: Get placement orders for a company
    if (action === 'get_placements') {
      // First get deals associated with company
      const dealsResp = await fetch('https://api.hubapi.com/crm/v3/objects/companies/' + companyId + '/associations/deals', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const dealsData = await dealsResp.json();
      const dealIds = (dealsData.results || []).map(r => r.id || r.toObjectId);

      if (dealIds.length === 0) {
        return res.status(200).json({ placements: [] });
      }

      // For each deal, get associated placement orders (custom object 0-970)
      let allPlacements = [];
      for (const dealId of dealIds) {
        try {
          const poResp = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/0-970`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const poData = await poResp.json();
          const poIds = (poData.results || []).map(r => r.id || r.toObjectId);

          if (poIds.length > 0) {
            // Fetch each placement order's properties
            const batchResp = await fetch('https://api.hubapi.com/crm/v3/objects/0-970/batch/read', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                inputs: poIds.map(id => ({ id })),
                properties: ['candidate_name', 'hs_object_id']
              })
            });
            const batchData = await batchResp.json();
            const placements = (batchData.results || []).map(r => ({
              id: r.id,
              candidate_name: r.properties?.candidate_name || null
            }));
            allPlacements = allPlacements.concat(placements);
          }
        } catch (e) {
          // Skip if association type doesn't exist for this deal
        }
      }

      // Also try direct company → placement order association
      try {
        const directResp = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${companyId}/associations/0-970`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const directData = await directResp.json();
        const directIds = (directData.results || []).map(r => r.id || r.toObjectId)
          .filter(id => !allPlacements.some(p => p.id === id));

        if (directIds.length > 0) {
          const batchResp = await fetch('https://api.hubapi.com/crm/v3/objects/0-970/batch/read', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              inputs: directIds.map(id => ({ id })),
              properties: ['candidate_name', 'hs_object_id']
            })
          });
          const batchData = await batchResp.json();
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

    // ACTION: Submit feedback (create note on placement order)
    if (action === 'submit_feedback') {
      const noteResp = await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: {
            hs_note_body: noteBody,
            hs_timestamp: new Date().toISOString()
          },
          associations: [{
            to: { id: placementOrderId },
            types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 1 }]
          }]
        })
      });

      // Also try associating with the default note association
      if (!noteResp.ok) {
        // Fallback: create note without association, just record it
        const fallbackResp = await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            properties: {
              hs_note_body: noteBody + `\n[Placement Order ID: ${placementOrderId}]`,
              hs_timestamp: new Date().toISOString()
            }
          })
        });
        const fallbackData = await fallbackResp.json();
        return res.status(200).json({ success: true, noteId: fallbackData.id, method: 'fallback' });
      }

      const noteData = await noteResp.json();
      return res.status(200).json({ success: true, noteId: noteData.id });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
