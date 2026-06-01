const https = require('https');
const MAX_ENGINEERS = 10;

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

  const { action, contactId, companyName, noteBody, scores } = body || {};

  try {
    if (action === 'search_companies') {
      const data = await hubspotRequest('POST', '/crm/v3/objects/companies/search', {
        query: companyName || '', limit: 10, properties: ['name', 'domain']
      });
      return res.status(200).json({
        companies: (data.results || []).map(r => ({ id: r.id, name: r.properties?.name, domain: r.properties?.domain }))
      });
    }

    if (action === 'get_contact') {
      const props = ['firstname', 'lastname', 'email', 'jobtitle', 'company'];
      for (let i = 1; i <= MAX_ENGINEERS; i++) {
        props.push('engineer_' + i);
        props.push('engineer_' + i + '_csat');
        props.push('engineer_' + i + '_ai_score');
      }

      const contact = await hubspotRequest('GET', '/crm/v3/objects/contacts/' + contactId + '?properties=' + props.join(','));

      const engineers = [];
      for (let i = 1; i <= MAX_ENGINEERS; i++) {
        const name = contact.properties?.['engineer_' + i];
        if (name && name.trim()) {
          engineers.push({
            slot: i,
            name: name.trim(),
            csat: contact.properties?.['engineer_' + i + '_csat'] || null,
            ai_score: contact.properties?.['engineer_' + i + '_ai_score'] || null
          });
        }
      }

      let companyName = contact.properties?.company || '';
      try {
        const assocData = await hubspotRequest('GET', '/crm/v3/objects/contacts/' + contactId + '/associations/companies');
        const companyIds = (assocData.results || []).map(r => r.toObjectId || r.id);
        if (companyIds.length > 0) {
          const comp = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyIds[0] + '?properties=name');
          companyName = comp.properties?.name || companyName;
        }
      } catch (e) {}

      return res.status(200).json({
        contact: {
          id: contact.id,
          firstname: contact.properties?.firstname || '',
          lastname: contact.properties?.lastname || '',
          email: contact.properties?.email || '',
          company: companyName
        },
        engineers: engineers
      });
    }

    if (action === 'submit_feedback') {
      const results = { scoresUpdated: false, noteCreated: false, errors: [] };

      if (scores && scores.length > 0) {
        const properties = {};
        for (const s of scores) {
          properties['engineer_' + s.slot + '_csat'] = String(s.csat);
          properties['engineer_' + s.slot + '_ai_score'] = String(s.ai_score);
        }
        try {
          await hubspotRequest('PATCH', '/crm/v3/objects/contacts/' + contactId, { properties });
          results.scoresUpdated = true;
        } catch (e) { results.errors.push('Scores: ' + e.message); }
      }

      try {
        await hubspotRequest('POST', '/crm/v3/objects/notes', {
          properties: { hs_note_body: noteBody, hs_timestamp: new Date().toISOString() },
          associations: [{
