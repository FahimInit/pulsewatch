import rateLimit from 'express-rate-limit';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => (process.env.NODE_ENV === 'test' && process.env.ENFORCE_RATE_LIMIT !== 'true' ? 1000 : 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many authentication attempts. Please try again in 15 minutes.',
    },
  },
});

export const checkNowRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () => (process.env.NODE_ENV === 'test' && process.env.ENFORCE_RATE_LIMIT !== 'true' ? 500 : 12),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'CHECK_NOW_RATE_LIMITED',
      message: 'Manual check rate limit exceeded. Please wait before triggering again.',
    },
  },
});

export const publicStatusRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () => (process.env.NODE_ENV === 'test' ? 1000 : 120),
  standardHeaders: true,
  legacyHeaders: false,
});
