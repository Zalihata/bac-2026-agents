const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function notionHeaders(token) {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': NOTION_VERSION };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not configured' });

  const { action, ...payload } = req.body || {};

  try {
    if (action === 'get_matieres') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({ sorts: [{ property: 'Date épreuve', direction: 'ascending' }] })
      });
      return res.status(r.status).json(await r.json());
    }

    if (action === 'get_diagnostics') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({ sorts: [{ property: 'Date', direction: 'descending' }] })
      });
      return res.status(r.status).json(await r.json());
    }

    // Planning actif — exclut En pause, Annulé, Fait
    if (action === 'get_planning') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({
          filter: { and: [
            { property: 'Statut', select: { does_not_equal: 'Annulé' } },
            { property: 'Statut', select: { does_not_equal: 'Fait' } },
            { property: 'Statut', select: { does_not_equal: 'En pause' } }
          ]},
          sorts: [{ property: 'Date', direction: 'ascending' }]
        })
      });
      return res.status(r.status).json(await r.json());
    }

    // Sessions optionnelles en attente (score 3)
    if (action === 'get_paused_sessions') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({
          filter: { property: 'Statut', select: { equals: 'En pause' } },
          sorts: [{ property: 'Date', direction: 'ascending' }]
        })
      });
      return res.status(r.status).json(await r.json());
    }

    if (action === 'get_checkins') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({ sorts: [{ property: 'Jour', direction: 'descending' }], page_size: payload.limit || 14 })
      });
      return res.status(r.status).json(await r.json());
    }

    if (action === 'create_checkin') {
      const r = await fetch(`${NOTION_API}/pages`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({
          parent: { database_id: payload.database_id },
          properties: {
            'Date': { title: [{ text: { content: payload.label } }] },
            'Jour': { date: { start: payload.date } },
            'Moment': { select: { name: payload.moment } },
            'Energie': { select: { name: payload.energie } },
            'Sessions faites': { number: payload.sessions_faites || 0 },
            'Ressenti': { select: { name: payload.ressenti } },
            ...(payload.blocage ? { 'Blocage': { rich_text: [{ text: { content: payload.blocage } }] } } : {})
          }
        })
      });
      return res.status(r.status).json(await r.json());
    }

    if (action === 'update_session') {
      const props = {};
      if (payload.statut)      props['Statut'] = { select: { name: payload.statut } };
      if (payload.completee_le) props['Complétée le'] = { date: { start: payload.completee_le } };
      if (payload.new_date)    props['Date'] = { date: { start: payload.new_date } };
      const r = await fetch(`${NOTION_API}/pages/${payload.page_id}`, {
        method: 'PATCH', headers: notionHeaders(token),
        body: JSON.stringify({ properties: props })
      });
      return res.status(r.status).json(await r.json());
    }

    // Révision hebdo — met à jour dates et statuts en batch
    if (action === 'reschedule_sessions') {
      const results = [];
      for (const c of payload.changes) {
        const props = {};
        if (c.new_date) props['Date']   = { date: { start: c.new_date } };
        if (c.statut)   props['Statut'] = { select: { name: c.statut } };
        const r = await fetch(`${NOTION_API}/pages/${c.page_id}`, {
          method: 'PATCH', headers: notionHeaders(token),
          body: JSON.stringify({ properties: props })
        });
        results.push(await r.json());
      }
      return res.status(200).json({ updated: results.length, results });
    }

    if (action === 'create_sessions') {
      const results = [];
      for (const s of payload.sessions) {
        const r = await fetch(`${NOTION_API}/pages`, {
          method: 'POST', headers: notionHeaders(token),
          body: JSON.stringify({
            parent: { database_id: payload.database_id },
            properties: {
              'Session':   { title: [{ text: { content: s.titre } }] },
              'Date':      { date: { start: s.date } },
              'Duree min': { number: s.duree },
              'Type':      { select: { name: s.type } },
              'Statut':    { select: { name: s.statut || 'À faire' } },
              'Urgence':   { select: { name: s.urgence || 'normale' } },
              'Optionnel': { checkbox: s.optionnel || false },
              ...(s.matiere ? { 'Matière': { select: { name: s.matiere } } } : {}),
              ...(s.notes ? { 'Notes': { rich_text: [{ text: { content: s.notes } }] } } : {})
            }
          })
        });
        results.push(await r.json());
      }
      return res.status(200).json({ created: results.length, results });
    }

    // Lire les activités optionnelles (réserve)
    if (action === 'get_reserve') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({
          filter: { property: 'Statut', select: { equals: 'Disponible' } },
          sorts: [{ property: 'Urgence', direction: 'ascending' }]
        })
      });
      return res.status(r.status).json(await r.json());
    }

    // Créer une activité dans la réserve
    if (action === 'create_reserve_item') {
      const s = payload.item;
      const r = await fetch(`${NOTION_API}/pages`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({
          parent: { database_id: payload.database_id },
          properties: {
            'Activité': { title: [{ text: { content: s.titre || s.nom || 'Activité' } }] },
            'Matière':  { rich_text: [{ text: { content: s.matiere || '' } }] },
            'Domaine':  { rich_text: [{ text: { content: s.domaine || '' } }] },
            'Durée min':{ number: s.duree || 45 },
            'Type':     { select: { name: s.type || 'Fiche' } },
            'Urgence':  { select: { name: s.urgence || 'normale' } },
            'Statut':   { select: { name: 'Disponible' } },
            ...(s.notes ? { 'Notes': { rich_text: [{ text: { content: s.notes } }] } } : {})
          }
        })
      });
      return res.status(r.status).json(await r.json());
    }

    // Tous les chapitres avec leur matière et urgence
    if (action === 'get_chapitres') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST', headers: notionHeaders(token),
        body: JSON.stringify({
          sorts: [{ property: 'Urgence', direction: 'ascending' }],
          page_size: 100
        })
      });
      return res.status(r.status).json(await r.json());
    }

        // Action générique pour patcher n'importe quelle propriété d'une page
    // Utile pour corriger des relations manquantes
    if (action === 'patch_page') {
      const body = { properties: {} };
      // payload.properties est un objet { nomProp: valeur_notion_api }
      if (payload.properties) {
        Object.assign(body.properties, payload.properties);
      }
      const r = await fetch(`${NOTION_API}/pages/${payload.page_id}`, {
        method: 'PATCH', headers: notionHeaders(token),
        body: JSON.stringify(body)
      });
      return res.status(r.status).json(await r.json());
    }

        return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('Notion proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
