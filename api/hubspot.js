const https = require('https');

function hubspotRequest(method, path, body) {
  const token = process.env.HUBSPOT_TOKEN;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.hubapi.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error('HubSpot ' + res.statusCode + ': ' + (parsed.message || data)));
          } else { resolve(parsed); }
        } catch (e) { reject(new Error('Parse error: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', (e) => reject(e));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'HUBSPOT_TOKEN not configured. Add it in Vercel Settings > Environment Variables.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); } }

  const { action, companyId, companyName, placementOrderId, noteBody, csatScore } = body || {};

  try {
    if (action === 'search_companies') {
      const data = await hubspotRequest('POST', '/crm/v3/objects/companies/search', {
        query: companyName || '', limit: 10, properties: ['name', 'domain']
      });
      return res.status(200).json({
        companies: (data.results || []).map(r => ({ id: r.id, name: r.properties?.name, domain: r.properties?.domain }))
      });
    }

    if (action === 'get_placements') {
      let dealIds = [];
      try { const d = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyId + '/associations/deals'); dealIds = (d.results || []).map(r => r.toObjectId || r.id); } catch (e) {}

      let allPlacements = [];
      for (const dealId of dealIds) {
        try {
          const poData = await hubspotRequest('GET', '/crm/v3/objects/deals/' + dealId + '/associations/0-970');
          const poIds = (poData.results || []).map(r => r.toObjectId || r.id);
          if (poIds.length > 0) {
            const bd = await hubspotRequest('POST', '/crm/v3/objects/0-970/batch/read', {
              inputs: poIds.map(id => ({ id: String(id) })),
              properties: ['candidate_name', 'hs_object_id', 'csat']
            });
            allPlacements = allPlacements.concat((bd.results || []).map(r => ({
              id: r.id, candidate_name: r.properties?.candidate_name || null, csat: r.properties?.csat || null
            })));
          }
        } catch (e) {}
      }

      try {
        const dd = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyId + '/associations/0-970');
        const dIds = (dd.results || []).map(r => r.toObjectId || r.id).filter(id => !allPlacements.some(p => String(p.id) === String(id)));
        if (dIds.length > 0) {
          const bd = await hubspotRequest('POST', '/crm/v3/objects/0-970/batch/read', {
            inputs: dIds.map(id => ({ id: String(id) })),
            properties: ['candidate_name', 'hs_object_id', 'csat']
          });
          allPlacements = allPlacements.concat((bd.results || []).map(r => ({
            id: r.id, candidate_name: r.properties?.candidate_name || null, csat: r.properties?.csat || null
          })));
        }
      } catch (e) {}

      return res.status(200).json({ placements: allPlacements });
    }

    if (action === 'submit_feedback') {
      const results = { scoreUpdated: false, noteCreated: false, errors: [] };

      // Step 1: Write CSAT score to placement order
      try {
        await hubspotRequest('PATCH', '/crm/v3/objects/0-970/' + placementOrderId, {
          properties: { csat: String(csatScore) }
        });
        results.scoreUpdated = true;
      } catch (e) { results.errors.push('Score update: ' + e.message); }

      // Step 2: Create note on timeline
      try {
        await hubspotRequest('POST', '/crm/v3/objects/notes', {
          properties: { hs_note_body: noteBody, hs_timestamp: new Date().toISOString() },
          associations: [{ to: { id: Number(placementOrderId) }, types: [{ associationCategory: 'USER_DEFINED', associationTypeId: 1 }] }]
        });
        results.noteCreated = true;
      } catch (e) {
        try {
          await hubspotRequest('POST', '/crm/v3/objects/notes', {
            properties: { hs_note_body: noteBody + '\n[Placement Order ID: ' + placementOrderId + ']', hs_timestamp: new Date().toISOString() }
          });
          results.noteCreated = true;
        } catch (e2) { results.errors.push('Note: ' + e2.message); }
      }

      return res.status(200).json({ success: results.scoreUpdated, ...results });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
