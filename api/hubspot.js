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

  const { action, companyId, companyName, contactId, noteBody, csatScore, aiScore } = body || {};

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

    // GET SMART WORKERS FOR A COMPANY
    if (action === 'get_placements') {
      const debug = { steps: [], errors: [] };

      let smartWorkers = [];
      let after = undefined;
      let page = 0;

      do {
        try {
          const searchBody = {
            filterGroups: [{
              filters: [
                {
                  propertyName: 'contact_type',
                  operator: 'EQ',
                  value: 'Smart Worker'
                },
                {
                  propertyName: 'associations.company',
                  operator: 'EQ',
                  value: companyId
                }
              ]
            }],
            properties: ['firstname', 'lastname', 'email', 'contact_type', 'csat_score', 'ai_score', 'jobtitle'],
            limit: 100
          };
          if (after) searchBody.after = after;

          const searchData = await hubspotRequest('POST', '/crm/v3/objects/contacts/search', searchBody);
          const contacts = (searchData.results || []).map(r => ({
            id: r.id,
            candidate_name: [r.properties?.firstname, r.properties?.lastname].filter(Boolean).join(' ') || null,
            email: r.properties?.email || null,
            jobtitle: r.properties?.jobtitle || null,
            csat_score: r.properties?.csat_score || null,
            ai_score: r.properties?.ai_score || null
          }));
          smartWorkers = smartWorkers.concat(contacts);
          after = searchData.paging?.next?.after || null;
          page++;
          debug.steps.push('page ' + page + ': ' + contacts.length + ' contacts');
        } catch (e) {
          debug.errors.push('search page ' + page + ': ' + e.message);

          // Fallback: get all contacts for the company, then filter
          if (page === 0) {
            debug.steps.push('trying fallback: all contacts for company');
            try {
              const assocData = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyId + '/associations/contacts');
              const contactIds = (assocData.results || []).map(r => String(r.toObjectId || r.id));
              debug.steps.push('company contacts: ' + contactIds.length);

              if (contactIds.length > 0) {
                for (const cid of contactIds) {
                  try {
                    const c = await hubspotRequest('GET', '/crm/v3/objects/contacts/' + cid + '?properties=firstname,lastname,email,contact_type,csat_score,ai_score,jobtitle');
                    if (c.properties?.contact_type === 'Smart Worker') {
                      smartWorkers.push({
                        id: c.id,
                        candidate_name: [c.properties?.firstname, c.properties?.lastname].filter(Boolean).join(' ') || null,
                        email: c.properties?.email || null,
                        jobtitle: c.properties?.jobtitle || null,
                        csat_score: c.properties?.csat_score || null,
                        ai_score: c.properties?.ai_score || null
                      });
                    }
                  } catch (e2) {
                    debug.errors.push('contact ' + cid + ': ' + e2.message);
                  }
                }
                debug.steps.push('smart workers found: ' + smartWorkers.length);
              }
            } catch (e2) {
              debug.errors.push('fallback: ' + e2.message);
            }
          }
          after = null;
        }
      } while (after && page < 5);

      debug.steps.push('total smart workers: ' + smartWorkers.length);
      return res.status(200).json({ placements: smartWorkers, debug });
    }

    // SUBMIT FEEDBACK — writes csat_score + ai_score to contact + creates note
    if (action === 'submit_feedback') {
      const results = { scoreUpdated: false, noteCreated: false, errors: [] };

      // Step 1: Update csat_score and ai_score on the contact
      try {
        await hubspotRequest('PATCH', '/crm/v3/objects/contacts/' + contactId, {
          properties: {
            csat_score: String(csatScore),
            ai_score: String(aiScore)
          }
        });
        results.scoreUpdated = true;
      } catch (e) { results.errors.push('Score: ' + e.message); }

      // Step 2: Create note associated with contact
      try {
        await hubspotRequest('POST', '/crm/v3/objects/notes', {
          properties: { hs_note_body: noteBody, hs_timestamp: new Date().toISOString() },
          associations: [{
            to: { id: Number(contactId) },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }]
          }]
        });
        results.noteCreated = true;
      } catch (e) {
        // Fallback without association
        try {
          await hubspotRequest('POST', '/crm/v3/objects/notes', {
            properties: { hs_note_body: noteBody + '\n[Contact ID: ' + contactId + ']', hs_timestamp: new Date().toISOString() }
          });
          results.noteCreated = true;
        } catch (e2) { results.errors.push('Note: ' + e2.message); }
      }

      return res.status(200).json({ success: results.scoreUpdated, ...results });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
