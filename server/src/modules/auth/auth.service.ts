import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { getEnv } from '../../config/env';
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
} from '../../utils/errors';
import { recordAuditLog } from '../audit/audit.service';
import type {
  RegisterInput,
  LoginInput,
} from '@pulsewatch/shared';

const DUMMY_BCRYPT_HASH = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

export function hashOpaqueToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function signAccessToken(user: { id: string; email: string; name: string }): string {
  const env = getEnv();
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  );
}

export function setRefreshCookie(res: Response, rawToken: string): void {
  const env = getEnv();
  const sameSite = env.CROSS_SITE_COOKIES ? 'none' : 'strict';
  const secure = env.NODE_ENV === 'production' || env.CROSS_SITE_COOKIES;
  res.cookie(env.REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  const env = getEnv();
  const sameSite = env.CROSS_SITE_COOKIES ? 'none' : 'strict';
  const secure = env.NODE_ENV === 'production' || env.CROSS_SITE_COOKIES;
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/v1/auth',
  });
}

function slugifyWorkspace(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base || 'workspace'}-${suffix}`;
}

export async function registerUser(input: RegisterInput, req: Request) {
  const env = getEnv();
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError('An account with this email address already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  const rawRefreshToken = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(rawRefreshToken);
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { user, project } = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
      },
    });

    const defaultProject = await tx.project.create({
      data: {
        name: `${input.name.split(' ')[0]}'s Workspace`,
        slug: slugifyWorkspace(`${input.name}-workspace`),
        description: 'Default monitoring workspace',
        planTier: 'FREE',
        monitorLimit: 20,
        members: {
          create: {
            userId: createdUser.id,
            role: 'OWNER',
          },
        },
        alertRules: {
          create: [
            {
              name: 'Default Outage & Recovery Alerts',
              triggerType: 'INCIDENT_CREATED',
              channels: ['IN_APP', 'EMAIL'],
              recipientEmails: [createdUser.email],
              cooldownMinutes: 5,
            },
            {
              name: 'Default Recovery Notification',
              triggerType: 'INCIDENT_RESOLVED',
              channels: ['IN_APP', 'EMAIL'],
              recipientEmails: [createdUser.email],
              cooldownMinutes: 1,
            },
          ],
        },
      },
    });

    await tx.refreshToken.create({
      data: {
        userId: createdUser.id,
        tokenHash,
        familyId,
        expiresAt,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
      },
    });

    return { user: createdUser, project: defaultProject };
  });

  await recordAuditLog({
    projectId: project.id,
    actorId: user.id,
    action: 'auth.registered',
    entityType: 'User',
    entityId: user.id,
    req,
  });

  const accessToken = signAccessToken(user);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      createdAt: user.createdAt,
    },
    defaultProjectId: project.id,
    accessToken,
    rawRefreshToken,
  };
}

export async function loginUser(input: LoginInput, req: Request) {
  const env = getEnv();
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Mitigate user enumeration timing differences
  const hashToCompare = user ? user.passwordHash : DUMMY_BCRYPT_HASH;
  const validPassword = await bcrypt.compare(input.password, hashToCompare);

  if (!user || !validPassword) {
    if (user) {
      await recordAuditLog({
        actorId: user.id,
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user.id,
        req,
      });
    }
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const rawRefreshToken = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(rawRefreshToken);
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt,
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
    },
  });

  await recordAuditLog({
    actorId: user.id,
    action: 'auth.login',
    entityType: 'User',
    entityId: user.id,
    req,
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      createdAt: user.createdAt,
    },
    accessToken: signAccessToken(user),
    rawRefreshToken,
  };
}

export async function rotateRefreshToken(rawToken: string | undefined, req: Request) {
  if (!rawToken) {
    throw new UnauthorizedError('Missing refresh token', 'MISSING_REFRESH_TOKEN');
  }

  const env = getEnv();
  const tokenHash = hashOpaqueToken(rawToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) {
    throw new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  // Reuse detection: if an already-revoked token is replayed, revoke the entire token family!
  if (stored.revokedAt !== null) {
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAuditLog({
      actorId: stored.userId,
      action: 'auth.refresh_token_reuse_detected',
      entityType: 'RefreshToken',
      entityId: stored.id,
      req,
    });
    throw new UnauthorizedError('Session invalidated due to token replay', 'TOKEN_REUSE_DETECTED');
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    throw new UnauthorizedError('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  }

  const nextRawToken = generateOpaqueToken();
  const nextHash = hashOpaqueToken(nextRawToken);
  const nextExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const replacement = await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: nextHash,
        familyId: stored.familyId,
        expiresAt: nextExpiresAt,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
      },
    });

    await tx.refreshToken.update({
      where: { id: stored.id },
      data: {
        revokedAt: new Date(),
        replacedByTokenId: replacement.id,
      },
    });
  });

  return {
    user: {
      id: stored.user.id,
      name: stored.user.name,
      email: stored.user.email,
      timezone: stored.user.timezone,
      createdAt: stored.user.createdAt,
    },
    accessToken: signAccessToken(stored.user),
    rawRefreshToken: nextRawToken,
  };
}

export async function logoutSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashOpaqueToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (stored) {
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export async function getCurrentUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      timezone: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  return user;
}

export async function updateUserProfile(
  userId: string,
  data: { name?: string; timezone?: string },
) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      timezone: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  req: Request,
): Promise<void> {
  const env = getEnv();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError();

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    throw new BadRequestError('Current password is incorrect', 'INCORRECT_PASSWORD');
  }

  const nextHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: nextHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAuditLog({
    actorId: userId,
    action: 'auth.password_changed',
    entityType: 'User',
    entityId: userId,
    req,
  });
}
