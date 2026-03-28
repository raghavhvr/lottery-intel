// api/topics.js
// GET /api/topics — returns the seeded lottery topic articles from Redis

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = await redis.get('lottery:gdelt:v1');
    if (!data?.topics?.length) {
      return res.status(200).json({ topics: [], fetchedAt: null, error: 'seed-unavailable' });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('[/api/topics]', err.message);
    return res.status(500).json({ topics: [], error: 'redis-error' });
  }
}
