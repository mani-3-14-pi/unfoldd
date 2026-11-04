import { rateLimit } from 'express-rate-limit'

/** For login and signup: 10 attempts per IP per 15 minutes. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } })
  },
})
