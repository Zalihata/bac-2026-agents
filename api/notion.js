const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function notionHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
  };
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

    // ── LECTURE ──────────────────────────────────────────────

    // Lire tous les diagnostics
    if (action === 'get_diagnostics') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST',
        headers: notionHeaders(token),
        body: JSON.stringify({ sorts: [{ property: 'Date', direction: 'descending' }] })
      });
      return res.status(r.status).json(await r.json());
    }

    // Lire le planning (sessions à faire)
    if (action === 'get_planning') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST',
        headers: notionHeaders(token),
        body: JSON.stringify({
          filter: {
            and: [
              { property: 'Statut', select: { does_not_equal: 'Annulé' } },
              { property: 'Statut', select: { does_not_equal: 'Fait' } }
            ]
          },
          sorts: [{ property: 'Date', direction: 'ascending' }]
        })
      });
      return res.status(r.status).json(await r.json());
    }

    // Lire les matières avec scores
    if (action === 'get_matieres') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST',
        headers: notionHeaders(token),
        body: JSON.stringify({ sorts: [{ property: 'Date épreuve', direction: 'ascending' }] })
      });
      return res.status(r.status).json(await r.json());
    }

    // Lire les check-ins (base Énergie)
    if (action === 'get_checkins') {
      const r = await fetch(`${NOTION_API}/databases/${payload.database_id}/query`, {
        method: 'POST',
        headers: notionHeaders(token),
        body: JSON.stringify({
          sorts: [{ property: 'Jour', direction: 'descending' }],
          page_size: payload.limit || 14
        })
      });
      return res.status(r.status).json(await r.json());
    }

    // Lire une page Notion (contenu)
    if (action === 'get_page') {
      const r = await fetch(`${NOTION_API}/pages/${payload.page_id}`, {
        headers: notionHeaders(token)
      });
      return res.status(r.status).json(await r.json());
    }

    // ── ÉCRITURE ─────────────────────────────────────────────

    // Créer un check-in (base Énergie)
    if (action === 'create_checkin') {
      const body = {
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
      };
      const r = await fetch(`${NOTION_API}/pages`, {
        method: 'POST',
        headers: notionHeaders(token),
        body: JSON.stringify(body)
      });
      return res.status(r.status).json(await r.json());
    }

    // Mettre à jour le statut d'une session planning
    if (action === 'update_session') {
      const body = {
        properties: {
          'Statut': { select: { name: payload.statut } },
          ...(payload.completee_le ? { 'Complétée le': { date: { start: payload.completee_le } } } : {})
        }
      };
      const r = await fetch(`${NOTION_API}/pages/${payload.page_id}`, {
        method: 'PATCH',
        headers: notionHeaders(token),
        body: JSON.stringify(body)
      });
      return res.status(r.status).json(await r.json());
    }

    // Créer des sessions dans le planning
    if (action === 'create_sessions') {
      const results = [];
      for (const session of payload.sessions) {
        const body = {
          parent: { database_id: payload.database_id },
          properties: {
            'Session': { title: [{ text: { content: session.titre } }] },
            'Date': { date: { start: session.date } },
            'Durée (min)': { number: session.duree },
            'Type': { select: { name: session.type } },
            'Statut': { select: { name: 'À faire' } },
            'Urgence': { select: { name: session.urgence } },
            ...(session.notes ? { 'Notes': { rich_text: [{ text: { content: session.notes } }] } } : {})
          }
        };
        const r = await fetch(`${NOTION_API}/pages`, {
          method: 'POST',
          headers: notionHeaders(token),
          body: JSON.stringify(body)
        });
        results.push(await r.json());
      }
      return res.status(200).json({ created: results.length, results });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('Notion proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
