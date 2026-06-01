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

  var token = process.env.HUBSPOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'HUBSPOT_TOKEN not configured.' });

  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); } }

  var action = body?.action;
  var contactId = body?.contactId;
  var companyName = body?.companyName;
  var noteBody = body?.noteBody;
  var scores = body?.scores;
  var period = body?.period;

  try {
    if (action === 'search_companies') {
      var data = await hubspotRequest('POST', '/crm/v3/objects/companies/search', {
        query: companyName || '', limit: 10, properties: ['name', 'domain']
      });
      return res.status(200).json({
        companies: (data.results || []).map(function(r) { return { id: r.id, name: r.properties?.name, domain: r.properties?.domain }; })
      });
    }

    if (action === 'get_contact') {
      var basicProps = ['firstname', 'lastname', 'email', 'jobtitle', 'company', 'last_csat_period'];
      for (var i = 1; i <= MAX_ENGINEERS; i++) {
        basicProps.push('engineer_' + i);
      }

      var contact;
      try {
        contact = await hubspotRequest('GET', '/crm/v3/objects/contacts/' + contactId + '?properties=' + basicProps.join(','));
      } catch (e) {
        return res.status(500).json({ error: 'Failed to load contact: ' + e.message });
      }

      var scoreProps = {};
      try {
        var scoreFields = [];
        for (var j = 1; j <= MAX_ENGINEERS; j++) {
          scoreFields.push('engineer_' + j + '_csat');
          scoreFields.push('engineer_' + j + '_ai_score');
        }
        var scoreContact = await hubspotRequest('GET', '/crm/v3/objects/contacts/' + contactId + '?properties=' + scoreFields.join(','));
        scoreProps = scoreContact.properties || {};
      } catch (e) {}

      var engineers = [];
      for (var k = 1; k <= MAX_ENGINEERS; k++) {
        var name = contact.properties?.['engineer_' + k];
        if (name && name.trim()) {
          engineers.push({
            slot: k,
            name: name.trim(),
            csat: scoreProps['engineer_' + k + '_csat'] || null,
            ai_score: scoreProps['engineer_' + k + '_ai_score'] || null
          });
        }
      }

      var companyNameResult = contact.properties?.company || '';
      try {
        var assocData = await hubspotRequest('GET', '/crm/v3/objects/contacts/' + contactId + '/associations/companies');
        var companyIds = (assocData.results || []).map(function(r) { return r.toObjectId || r.id; });
        if (companyIds.length > 0) {
          var comp = await hubspotRequest('GET', '/crm/v3/objects/companies/' + companyIds[0] + '?properties=name');
          companyNameResult = comp.properties?.name || companyNameResult;
        }
      } catch (e) {}

      return res.status(200).json({
        contact: {
          id: contact.id,
          firstname: contact.properties?.firstname || '',
          lastname: contact.properties?.lastname || '',
          email: contact.properties?.email || '',
          company: companyNameResult,
          last_csat_period: contact.properties?.last_csat_period || null
        },
        engineers: engineers
      });
    }

    if (action === 'submit_feedback') {
      var results = { scoresUpdated: false, noteCreated: false, errors: [] };

      // Write scores + period to contact
      if (scores && scores.length > 0) {
        var properties = {};
        for (var s = 0; s < scores.length; s++) {
          properties['engineer_' + scores[s].slot + '_csat'] = String(scores[s].csat);
          properties['engineer_' + scores[s].slot + '_ai_score'] = String(scores[s].ai_score);
        }
        // Mark the period as submitted
        if (period) {
          properties['last_csat_period'] = period;
        }
        try {
          await hubspotRequest('PATCH', '/crm/v3/objects/contacts/' + contactId, { properties: properties });
          results.scoresUpdated = true;
        } catch (e) { results.errors.push('Scores: ' + e.message); }
      }

      // Create note
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
        try {
          await hubspotRequest('POST', '/crm/v3/objects/notes', {
            properties: { hs_note_body: noteBody + '\n[Contact ID: ' + contactId + ']', hs_timestamp: new Date().toISOString() }
          });
          results.noteCreated = true;
        } catch (e2) { results.errors.push('Note: ' + e2.message); }
      }

      return res.status(200).json({ success: results.scoresUpdated || results.noteCreated, ...results });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
