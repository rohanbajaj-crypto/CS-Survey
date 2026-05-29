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
            reject(new Error('HubSpot ' + res.statusCode + ': ' + (parsed.message || JSON.stringify(parsed))));
          } else { resolve(parsed); }
        } catch (e) { reject(new Error('Parse error: ' + data.substring(0, 300))); }
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
    // SEARCH COMPANIES
    if (action === 'search_companies') {
      const data = await hubspotRequest('POST', '/crm/v3/objects/companies/search', {
        query: companyName || '', limit: 10, properties: ['name', 'domain']
      });
      return res.status(200).json({
        companies: (data.results || []).map(r => ({ id: r.id, name: r.properties?.name, domain: r.properties?.domain }))
      });
    }

    // GET PLACEMENT ORDERS
    if (action === 'get_placements') {
      let allPlacementIds = [];
      const debug = { paths_tried: [], errors: [] };

      // Method 1: company -> deals -> placement orders (v3 associations)
      try {
        const dealsData = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyId + '/associations/deals');
        const dealIds = (dealsData.results || []).map(r => r.toObjectId || r.id);
        debug.paths_tried.push('company->deals: found ' + dealIds.length + ' deals');

        for (const dealId of dealIds) {
          // Try v3 path
          try {
            const poData = await hubspotRequest('GET', '/crm/v3/objects/deals/' + dealId + '/associations/0-970');
            const ids = (poData.results || []).map(r => r.toObjectId || r.id);
            debug.paths_tried.push('deal ' + dealId + ' -> 0-970 v3: found ' + ids.length);
            allPlacementIds = allPlacementIds.concat(ids);
          } catch (e) {
            debug.errors.push('deal->po v3: ' + e.message);
          }

          // Try v4 associations path
          if (allPlacementIds.length === 0) {
            try {
              const v4Data = await hubspotRequest('POST', '/crm/v4/associations/deals/0-970/batch/read', {
                inputs: [{ id: String(dealId) }]
              });
              const ids = (v4Data.results || []).flatMap(r => (r.to || []).map(t => t.toObjectId || t.id));
              debug.paths_tried.push('deal ' + dealId + ' -> 0-970 v4: found ' + ids.length);
              allPlacementIds = allPlacementIds.concat(ids);
            } catch (e) {
              debug.errors.push('deal->po v4: ' + e.message);
            }
          }
        }
      } catch (e) {
        debug.errors.push('company->deals: ' + e.message);
      }

      // Method 2: company -> placement orders directly (v3)
      if (allPlacementIds.length === 0) {
        try {
          const directData = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyId + '/associations/0-970');
          const ids = (directData.results || []).map(r => r.toObjectId || r.id);
          debug.paths_tried.push('company->po v3 direct: found ' + ids.length);
          allPlacementIds = allPlacementIds.concat(ids);
        } catch (e) {
          debug.errors.push('company->po v3: ' + e.message);
        }
      }

      // Method 3: company -> placement orders directly (v4)
      if (allPlacementIds.length === 0) {
        try {
          const v4Data = await hubspotRequest('POST', '/crm/v4/associations/companies/0-970/batch/read', {
            inputs: [{ id: String(companyId) }]
          });
          const ids = (v4Data.results || []).flatMap(r => (r.to || []).map(t => t.toObjectId || t.id));
          debug.paths_tried.push('company->po v4 direct: found ' + ids.length);
          allPlacementIds = allPlacementIds.concat(ids);
        } catch (e) {
          debug.errors.push('company->po v4: ' + e.message);
        }
      }

      // Method 4: Search all placement orders and filter (last resort)
      if (allPlacementIds.length === 0) {
        try {
          const searchData = await hubspotRequest('POST', '/crm/v3/objects/0-970/search', {
            filterGroups: [],
            limit: 100,
            properties: ['candidate_name', 'hs_object_id', 'csat']
          });
          debug.paths_tried.push('search all 0-970: found ' + (searchData.results || []).length);
          
          // Return all for now with debug info so we can see what exists
          const allPlacements = (searchData.results || []).map(r => ({
            id: r.id,
            candidate_name: r.properties?.candidate_name || null,
            csat: r.properties?.csat || null
          }));
          
          return res.status(200).json({ placements: allPlacements, debug });
        } catch (e) {
          debug.errors.push('search all: ' + e.message);
        }
      }

      // Deduplicate
      allPlacementIds = [...new Set(allPlacementIds.map(String))];

      // Fetch details for found IDs
      if (allPlacementIds.length > 0) {
        try {
          const batchData = await hubspotRequest('POST', '/crm/v3/objects/0-970/batch/read', {
            inputs: allPlacementIds.map(id => ({ id: String(id) })),
            properties: ['candidate_name', 'hs_object_id', 'csat']
          });
          const allPlacements = (batchData.results || []).map(r => ({
            id: r.id,
            candidate_name: r.properties?.candidate_name || null,
            csat: r.properties?.csat || null
          }));
          return res.status(200).json({ placements: allPlacements, debug });
        } catch (e) {
          debug.errors.push('batch read: ' + e.message);
        }
      }

      return res.status(200).json({ placements: [], debug });
    }

    // SUBMIT FEEDBACK
    if (action === 'submit_feedback') {
      const results = { scoreUpdated: false, noteCreated: false, errors: [] };

      // Step 1: Write CSAT score to placement order
      try {
        await hubspotRequest('PATCH', '/crm/v3/objects/0-970/' + placementOrderId, {
          properties: { csat: String(csatScore) }
        });
        results.scoreUpdated = true;
      } catch (e) { results.errors.push('Score update: ' + e.message); }

      // Step 2: Create note
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
