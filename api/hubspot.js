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
      const debug = { steps: [], errors: [], schema: null };

      // Step 0: Try to get the schema for 0-970 to find the real name
      let objectName = '0-970';
      const namesToTry = ['0-970'];

      try {
        const schema = await hubspotRequest('GET', '/crm/v3/schemas/0-970');
        debug.schema = { name: schema.name, fullyQualifiedName: schema.fullyQualifiedName, objectTypeId: schema.objectTypeId };
        if (schema.fullyQualifiedName) namesToTry.push(schema.fullyQualifiedName);
        if (schema.name) namesToTry.push(schema.name);
        debug.steps.push('schema found: ' + schema.name + ' / ' + schema.fullyQualifiedName);
      } catch (e) {
        debug.errors.push('schema 0-970: ' + e.message);
      }

      // Also try fetching all schemas to find it
      try {
        const allSchemas = await hubspotRequest('GET', '/crm/v3/schemas');
        const names = (allSchemas.results || []).map(s => s.name + ' (' + s.objectTypeId + ')');
        debug.steps.push('all schemas: ' + names.join(', '));
        const match = (allSchemas.results || []).find(s => s.objectTypeId === '0-970');
        if (match) {
          if (match.fullyQualifiedName) namesToTry.push(match.fullyQualifiedName);
          if (match.name) namesToTry.push(match.name);
          debug.steps.push('matched schema: ' + match.name);
        }
      } catch (e) {
        debug.errors.push('all schemas: ' + e.message);
      }

      // Step 1: Get deals
      let dealIds = [];
      try {
        const d = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyId + '/associations/deals');
        dealIds = (d.results || []).map(r => r.toObjectId || r.id);
        debug.steps.push('deals: ' + dealIds.length);
      } catch (e) { debug.errors.push('deals: ' + e.message); }

      // Step 2: Get placement IDs via associations
      let allPlacementIds = [];
      for (const dealId of dealIds) {
        try {
          const poData = await hubspotRequest('GET', '/crm/v3/objects/deals/' + dealId + '/associations/0-970');
          const ids = (poData.results || []).map(r => r.toObjectId || r.id);
          allPlacementIds = allPlacementIds.concat(ids);
        } catch (e) { debug.errors.push('deal assoc: ' + e.message); }
      }
      allPlacementIds = [...new Set(allPlacementIds.map(String))];
      debug.steps.push('IDs found: ' + allPlacementIds.length);

      // Step 3: Try reading with each name variant
      let allPlacements = [];
      for (const name of [...new Set(namesToTry)]) {
        if (allPlacements.length > 0) break;
        // Try search
        try {
          const searchData = await hubspotRequest('POST', '/crm/v3/objects/' + name + '/search', {
            filterGroups: [{ filters: [{ propertyName: 'hs_object_id', operator: 'IN', values: allPlacementIds }] }],
            properties: ['candidate_name', 'csat', 'hs_object_id'],
            limit: 100
          });
          allPlacements = (searchData.results || []).map(r => ({
            id: r.id, candidate_name: r.properties?.candidate_name || null, csat: r.properties?.csat || null
          }));
          debug.steps.push('search "' + name + '": ' + allPlacements.length);
        } catch (e) {
          debug.errors.push('search "' + name + '": ' + e.message);
        }
        // Try individual read
        if (allPlacements.length === 0) {
          try {
            const po = await hubspotRequest('GET', '/crm/v3/objects/' + name + '/' + allPlacementIds[0] + '?properties=candidate_name,csat');
            allPlacements.push({ id: po.id, candidate_name: po.properties?.candidate_name || null, csat: po.properties?.csat || null });
            debug.steps.push('read "' + name + '": worked');
            // Fetch rest
            for (const poId of allPlacementIds.slice(1)) {
              try {
                const p2 = await hubspotRequest('GET', '/crm/v3/objects/' + name + '/' + poId + '?properties=candidate_name,csat');
                allPlacements.push({ id: p2.id, candidate_name: p2.properties?.candidate_name || null, csat: p2.properties?.csat || null });
              } catch (e2) {}
            }
          } catch (e) {
            debug.errors.push('read "' + name + '": ' + e.message);
          }
        }
      }

      return res.status(200).json({ placements: allPlacements, debug });
    }

    if (action === 'submit_feedback') {
      const results = { scoreUpdated: false, noteCreated: false, errors: [] };
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
