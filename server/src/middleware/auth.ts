import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { Project, ProjectRole } from '@prisma/client';
import { getEnv } from '../config/env';
import { prisma } from '../config/prisma';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/errors';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

export interface ProjectAccessContext {
  projectId: string;
  role: ProjectRole;
  project: Project;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      projectAccess?: ProjectAccessContext;
    }
  }
}

export interface AccessTokenJwtPayload {
  sub: string;
  email: string;
  name: string;
}

const ROLE_WEIGHT: Record<ProjectRole, number> = {
  VIEWER: 1,
  MEMBER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or malformed Authorization header'));
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    next(new UnauthorizedError('Missing bearer token'));
    return;
  }

  try {
    const decoded = jwt.verify(token, getEnv().JWT_ACCESS_SECRET) as AccessTokenJwtPayload;
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
    };
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired access token', 'TOKEN_EXPIRED_OR_INVALID'));
  }
}

/**
 * Verifies the authenticated user belongs to `:projectId` with at least `minimumRole`.
 * Prevents cross-tenant IDOR across all project-scoped resources.
 */
export function requireProjectAccess(minimumRole: ProjectRole = 'VIEWER') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new UnauthorizedError();
      }
      const projectId = req.params.projectId;
      if (!projectId || !/^[0-9a-fA-F-]{36}$/.test(projectId)) {
        throw new NotFoundError('Project not found');
      }

      const membership = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId: req.user.id,
          },
        },
        include: {
          project: true,
        },
      });

      // Return 404 when not a member to avoid leaking project UUID existence (Anti-IDOR)
      if (!membership) {
        throw new NotFoundError('Project not found');
      }

      if (ROLE_WEIGHT[membership.role] < ROLE_WEIGHT[minimumRole]) {
        throw new ForbiddenError(
          `This action requires at least ${minimumRole} permissions in the project`,
        );
      }

      req.projectAccess = {
        projectId: membership.projectId,
        role: membership.role,
        project: membership.project,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
