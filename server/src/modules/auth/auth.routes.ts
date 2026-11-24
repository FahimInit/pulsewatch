import { Router } from 'express';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from '@pulsewatch/shared';
import { getEnv } from '../../config/env';
import { authenticate } from '../../middleware/auth';
import { authRateLimiter } from '../../middleware/rate-limit';
import { asyncHandler, validateBody } from '../../middleware/validate';
import {
  registerUser,
  loginUser,
  rotateRefreshToken,
  logoutSession,
  setRefreshCookie,
  clearRefreshCookie,
  getCurrentUserProfile,
  updateUserProfile,
  changeUserPassword,
} from './auth.service';

export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await registerUser(req.body, req);
    setRefreshCookie(res, result.rawRefreshToken);
    res.status(201).json({
      user: result.user,
      defaultProjectId: result.defaultProjectId,
      accessToken: result.accessToken,
    });
  }),
);

authRouter.post(
  '/login',
  authRateLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await loginUser(req.body, req);
    setRefreshCookie(res, result.rawRefreshToken);
    res.status(200).json({
      user: result.user,
      accessToken: result.accessToken,
    });
  }),
);

authRouter.post(
  '/refresh',
  authRateLimiter,
  asyncHandler(async (req, res) => {
    const cookieName = getEnv().REFRESH_COOKIE_NAME;
    const rawToken =
      (req.cookies?.[cookieName] as string | undefined) ||
      (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined);

    try {
      const result = await rotateRefreshToken(rawToken, req);
      setRefreshCookie(res, result.rawRefreshToken);
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
      });
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const cookieName = getEnv().REFRESH_COOKIE_NAME;
    const rawToken = req.cookies?.[cookieName] as string | undefined;
    await logoutSession(rawToken);
    clearRefreshCookie(res);
    res.status(200).json({ message: 'Logged out successfully' });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await getCurrentUserProfile(req.user!.id);
    res.status(200).json({ user });
  }),
);

authRouter.patch(
  '/me',
  authenticate,
  validateBody(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const user = await updateUserProfile(req.user!.id, req.body);
    res.status(200).json({ user });
  }),
);

authRouter.patch(
  '/me/password',
  authenticate,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await changeUserPassword(
      req.user!.id,
      req.body.currentPassword,
      req.body.newPassword,
      req,
    );
    clearRefreshCookie(res);
    res.status(200).json({ message: 'Password updated. Please sign in again on other devices.' });
  }),
);
