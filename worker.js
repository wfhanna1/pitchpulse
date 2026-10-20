// PitchPulse poll server: a Cloudflare Worker with one KV namespace bound as VOTES.
//   GET  /votes?match=<id>              -> { votes: { home, draw, away } }
//   POST /vote  { match, choice }       -> { votes: { home, draw, away }, alreadyVoted }
// One vote per IP per match is enforced with a KV key that expires after 7 days.
// KV is not atomic, so two votes at the exact same moment can be lost; fine for a casual poll.

const ALLOWED_ORIGIN = 'https://wfhanna1.github.io';
const CHOICES = ['home', 'draw', 'away'];
const EMPTY = { home: 0, draw: 0, away: 0 };

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin'
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const validMatch = (id) => typeof id === 'string' && /^\d{1,12}$/.test(id);

async function readVotes(env, match) {
  const saved = await env.VOTES.get(`votes:${match}`, 'json');
  return { ...EMPTY, ...(saved || {}) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (request.method === 'GET' && url.pathname === '/votes') {
      const match = url.searchParams.get('match');
      if (!validMatch(match)) return json({ error: 'bad match id' }, 400);
      return json({ votes: await readVotes(env, match) });
    }

    if (request.method === 'POST' && url.pathname === '/vote') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
      const match = String(body.match ?? '');
      if (!validMatch(match) || !CHOICES.includes(body.choice)) return json({ error: 'bad vote' }, 400);

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const seenKey = `seen:${match}:${ip}`;
      const votes = await readVotes(env, match);

      if (await env.VOTES.get(seenKey)) return json({ votes, alreadyVoted: true }, 409);

      votes[body.choice] += 1;
      await env.VOTES.put(`votes:${match}`, JSON.stringify(votes));
      await env.VOTES.put(seenKey, '1', { expirationTtl: 60 * 60 * 24 * 7 });
      return json({ votes, alreadyVoted: false });
    }

    return json({ error: 'not found' }, 404);
  }
};
