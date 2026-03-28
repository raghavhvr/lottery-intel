// api/health.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const data = await redis.get('lottery:gdelt:v1');
    const topics = data?.topics || [];
    const populated = topics.filter(t => t.articles?.length > 0).length;
    res.status(200).json({
      status:    'ok',
      seeded:    populated > 0,
      topics:    populated,
      fetchedAt: data?.fetchedAt || null,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
}
