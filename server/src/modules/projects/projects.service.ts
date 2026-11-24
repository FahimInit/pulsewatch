import crypto from 'node:crypto';
import type { Request } from 'express';
import type { ProjectRole } from '@prisma/client';
import { prisma } from '../../config/prisma';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors';
import { recordAuditLog } from '../audit/audit.service';

function makeProjectSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'project'}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function listUserProjects(userId: string) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    include: {
      project: {
        include: {
          _count: {
            select: {
              monitors: true,
              members: true,
            },
          },
          incidents: {
            where: { status: { not: 'RESOLVED' } },
            select: { id: true },
          },
        },
      },
    },
  });

  return memberships.map((m) => ({
    id: m.project.id,
    name: m.project.name,
    slug: m.project.slug,
    description: m.project.description,
    planTier: m.project.planTier,
    monitorLimit: m.project.monitorLimit,
    role: m.role,
    monitorCount: m.project._count.monitors,
    memberCount: m.project._count.members,
    activeIncidentCount: m.project.incidents.length,
    createdAt: m.project.createdAt,
    updatedAt: m.project.updatedAt,
  }));
}

export async function createProject(
  userId: string,
  userEmail: string,
  input: { name: string; description?: string | null },
  req: Request,
) {
  const project = await prisma.project.create({
    data: {
      name: input.name,
      slug: makeProjectSlug(input.name),
      description: input.description ?? null,
      planTier: 'FREE',
      monitorLimit: 20,
      members: {
        create: {
          userId,
          role: 'OWNER',
        },
      },
      alertRules: {
        create: [
          {
            name: 'Incident Opened Alert',
            triggerType: 'INCIDENT_CREATED',
            channels: ['IN_APP', 'EMAIL'],
            recipientEmails: [userEmail],
            cooldownMinutes: 5,
          },
          {
            name: 'Incident Resolved Alert',
            triggerType: 'INCIDENT_RESOLVED',
            channels: ['IN_APP', 'EMAIL'],
            recipientEmails: [userEmail],
            cooldownMinutes: 1,
          },
        ],
      },
    },
    include: {
      _count: { select: { monitors: true, members: true } },
    },
  });

  await recordAuditLog({
    projectId: project.id,
    actorId: userId,
    action: 'project.created',
    entityType: 'Project',
    entityId: project.id,
    metadata: { name: project.name },
    req,
  });

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    planTier: project.planTier,
    monitorLimit: project.monitorLimit,
    role: 'OWNER' as ProjectRole,
    monitorCount: project._count.monitors,
    memberCount: project._count.members,
    activeIncidentCount: 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export async function getProjectDetail(projectId: string, role: ProjectRole) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      _count: {
        select: { monitors: true, members: true, statusPages: true },
      },
      incidents: {
        where: { status: { not: 'RESOLVED' } },
        select: { id: true },
      },
    },
  });

  if (!project) throw new NotFoundError('Project not found');

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    planTier: project.planTier,
    monitorLimit: project.monitorLimit,
    role,
    monitorCount: project._count.monitors,
    memberCount: project._count.members,
    statusPageCount: project._count.statusPages,
    activeIncidentCount: project.incidents.length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export async function updateProject(
  projectId: string,
  actorId: string,
  input: { name?: string; description?: string | null },
  req: Request,
) {
  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'project.updated',
    entityType: 'Project',
    entityId: projectId,
    metadata: { name: updated.name },
    req,
  });

  return updated;
}

export async function deleteProject(projectId: string, actorId: string, req: Request) {
  const ownerProjectsCount = await prisma.projectMember.count({
    where: { userId: actorId },
  });
  if (ownerProjectsCount <= 1) {
    throw new BadRequestError(
      'Cannot delete your only workspace project. Create another project first.',
      'LAST_PROJECT_PROTECTED',
    );
  }

  await recordAuditLog({
    actorId,
    action: 'project.deleted',
    entityType: 'Project',
    entityId: projectId,
    req,
  });

  await prisma.project.delete({
    where: { id: projectId },
  });
}

export async function listProjectMembers(projectId: string) {
  return prisma.projectMember.findMany({
    where: { projectId },
    orderBy: { joinedAt: 'asc' },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });
}

export async function addProjectMember(
  projectId: string,
  actorId: string,
  input: { email: string; role: 'ADMIN' | 'MEMBER' | 'VIEWER' },
  req: Request,
) {
  const targetUser = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (!targetUser) {
    throw new NotFoundError('No registered Pulsewatch user found with that email address');
  }

  const existing = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: targetUser.id,
      },
    },
  });
  if (existing) {
    throw new ConflictError('User is already a member of this project');
  }

  const member = await prisma.projectMember.create({
    data: {
      projectId,
      userId: targetUser.id,
      role: input.role,
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'project.member_added',
    entityType: 'ProjectMember',
    entityId: member.id,
    metadata: { email: input.email, role: input.role },
    req,
  });

  return member;
}

export async function updateProjectMemberRole(
  projectId: string,
  memberId: string,
  actorId: string,
  role: 'ADMIN' | 'MEMBER' | 'VIEWER',
  req: Request,
) {
  const existing = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId },
  });
  if (!existing) throw new NotFoundError('Project member not found');
  if (existing.role === 'OWNER') {
    throw new ForbiddenError('Project OWNER role cannot be downgraded');
  }

  const updated = await prisma.projectMember.update({
    where: { id: memberId },
    data: { role },
    include: {
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'project.member_role_updated',
    entityType: 'ProjectMember',
    entityId: memberId,
    metadata: { role },
    req,
  });

  return updated;
}

export async function removeProjectMember(
  projectId: string,
  memberId: string,
  actorId: string,
  req: Request,
) {
  const existing = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId },
  });
  if (!existing) throw new NotFoundError('Project member not found');
  if (existing.role === 'OWNER') {
    throw new ForbiddenError('Cannot remove the project OWNER');
  }

  await prisma.projectMember.delete({ where: { id: memberId } });

  await recordAuditLog({
    projectId,
    actorId,
    action: 'project.member_removed',
    entityType: 'ProjectMember',
    entityId: memberId,
    req,
  });
}

export async function listProjectAuditLogs(projectId: string, limit = 50) {
  return prisma.auditLog.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      actor: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}
