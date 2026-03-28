// api/timeline.js
// GET /api/timeline?topic=jackpot — returns tone + volume timeline for a topic

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const VALID_TOPICS = new Set(['jackpot', 'winners', 'draws', 'regulation', 'scams', 'fundraising']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { topic } = req.query;
  if (!topic || !VALID_TOPICS.has(topic)) {
    return res.status(400).json({ error: 'Invalid topic. Must be one of: ' + [...VALID_TOPICS].join(', ') });
  }

  try {
    const [toneRaw, volRaw] = await Promise.all([
      redis.get(`lottery:tone:${topic}`),
      redis.get(`lottery:vol:${topic}`),
    ]);

    return res.status(200).json({
      topic,
      tone:      toneRaw?.data || [],
      vol:       volRaw?.data  || [],
      fetchedAt: toneRaw?.fetchedAt || volRaw?.fetchedAt || null,
    });
  } catch (err) {
    console.error('[/api/timeline]', err.message);
    return res.status(500).json({ tone: [], vol: [], error: 'redis-error' });
  }
}
