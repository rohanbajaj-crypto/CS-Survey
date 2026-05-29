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
  if (!token) return res.status(500).json({ error: 'HUBSPOT_TOKEN not configured.' });

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
      let allPlacementIds = [];
      const debug = { steps: [], errors: [] };

      // Step 1: Get deals for company
      let dealIds = [];
      try {
        const d = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyId + '/associations/deals');
        dealIds = (d.results || []).map(r => r.toObjectId || r.id);
        debug.steps.push('deals: ' + dealIds.length);
      } catch (e) { debug.errors.push('deals: ' + e.message); }

      // Step 2: Get placement order IDs via deal associations
      for (const dealId of dealIds) {
        try {
          const poData = await hubspotRequest('GET', '/crm/v3/objects/deals/' + dealId + '/associations/0-970');
          const ids = (poData.results || []).map(r => r.toObjectId || r.id);
          allPlacementIds = allPlacementIds.concat(ids);
          debug.steps.push('deal ' + dealId + ': ' + ids.length + ' placements');
        } catch (e) { debug.errors.push('deal assoc: ' + e.message); }
      }

      // Deduplicate
      allPlacementIds = [...new Set(allPlacementIds.map(String))];
      debug.steps.push('unique IDs: ' + allPlacementIds.length);

      // Step 3: Try SEARCH endpoint to get properties (bypasses direct read restriction)
      let allPlacements = [];

      // Method A: Search by IDs using filter
      if (allPlacementIds.length > 0) {
        try {
          const searchData = await hubspotRequest('POST', '/crm/v3/objects/0-970/search', {
            filterGroups: [{
              filters: [{
                propertyName: 'hs_object_id',
                operator: 'IN',
                values: allPlacementIds
              }]
            }],
            properties: ['candidate_name', 'csat', 'hs_object_id'],
            limit: 100
          });
          allPlacements = (searchData.results || []).map(r => ({
            id: r.id,
            candidate_name: r.properties?.candidate_name || null,
            csat: r.properties?.csat || null
          }));
          debug.steps.push('search by ID: found ' + allPlacements.length);
        } catch (e) {
          debug.errors.push('search by ID: ' + e.message);
        }
      }

      // Method B: If search by ID failed, try broad search
      if (allPlacements.length === 0 && allPlacementIds.length > 0) {
        try {
          const searchData = await hubspotRequest('POST', '/crm/v3/objects/0-970/search', {
            filterGroups: [],
            properties: ['candidate_name', 'csat', 'hs_object_id'],
            limit: 100
          });
          const allResults = (searchData.results || []).map(r => ({
            id: r.id,
            candidate_name: r.properties?.candidate_name || null,
            csat: r.properties?.csat || null
          }));
          // Filter to only our IDs
          allPlacements = allResults.filter(r => allPlacementIds.includes(String(r.id)));
          debug.steps.push('broad search: ' + allResults.length + ' total, ' + allPlacements.length + ' matched');
        } catch (e) {
          debug.errors.push('broad search: ' + e.message);
        }
      }

      // Method C: If search also failed, try CRM v3 with objectTypeId as name
      if (allPlacements.length === 0 && allPlacementIds.length > 0) {
        for (const poId of allPlacementIds.slice(0, 2)) {
          try {
            const po = await hubspotRequest('GET', '/crm/v3/objects/placement_order/' + poId + '?properties=candidate_name,csat');
            allPlacements.push({ id: po.id, candidate_name: po.properties?.candidate_name || null, csat: po.properties?.csat || null });
            debug.steps.push('alt name worked for ' + poId);
          } catch (e) {
            debug.errors.push('alt name ' + poId + ': ' + e.message);
          }
        }
      }

      return res.status(200).json({ placements: allPlacements, debug });
    }

    if (action === 'submit_feedback') {
      const results = { scoreUpdated: false, noteCreated: false, errors: [] };

      // Try updating via search-compatible PATCH
      try {
        await hubspotRequest('PATCH', '/crm/v3/objects/0-970/' + placementOrderId, {
          properties: { csat: String(csatScore) }
        });
        results.scoreUpdated = true;
      } catch (e) { results.errors.push('Score: ' + e.message); }

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
