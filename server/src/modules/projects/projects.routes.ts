import { Router } from 'express';
import {
  createProjectSchema,
  updateProjectSchema,
  addProjectMemberSchema,
  updateProjectMemberSchema,
} from '@pulsewatch/shared';
import { authenticate, requireProjectAccess } from '../../middleware/auth';
import { asyncHandler, validateBody } from '../../middleware/validate';
import {
  listUserProjects,
  createProject,
  getProjectDetail,
  updateProject,
  deleteProject,
  listProjectMembers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  listProjectAuditLogs,
} from './projects.service';

export const projectsRouter = Router();

projectsRouter.use(authenticate);

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = await listUserProjects(req.user!.id);
    res.status(200).json({ projects });
  }),
);

projectsRouter.post(
  '/',
  validateBody(createProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await createProject(req.user!.id, req.user!.email, req.body, req);
    res.status(201).json({ project });
  }),
);

projectsRouter.get(
  '/:projectId',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const project = await getProjectDetail(
      req.projectAccess!.projectId,
      req.projectAccess!.role,
    );
    res.status(200).json({ project });
  }),
);

projectsRouter.patch(
  '/:projectId',
  requireProjectAccess('ADMIN'),
  validateBody(updateProjectSchema),
  asyncHandler(async (req, res) => {
    const project = await updateProject(
      req.projectAccess!.projectId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(200).json({ project });
  }),
);

projectsRouter.delete(
  '/:projectId',
  requireProjectAccess('OWNER'),
  asyncHandler(async (req, res) => {
    await deleteProject(req.projectAccess!.projectId, req.user!.id, req);
    res.status(204).send();
  }),
);

projectsRouter.get(
  '/:projectId/members',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const members = await listProjectMembers(req.projectAccess!.projectId);
    res.status(200).json({ members });
  }),
);

projectsRouter.post(
  '/:projectId/members',
  requireProjectAccess('ADMIN'),
  validateBody(addProjectMemberSchema),
  asyncHandler(async (req, res) => {
    const member = await addProjectMember(
      req.projectAccess!.projectId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(201).json({ member });
  }),
);

projectsRouter.patch(
  '/:projectId/members/:memberId',
  requireProjectAccess('ADMIN'),
  validateBody(updateProjectMemberSchema),
  asyncHandler(async (req, res) => {
    const member = await updateProjectMemberRole(
      req.projectAccess!.projectId,
      req.params.memberId,
      req.user!.id,
      req.body.role,
      req,
    );
    res.status(200).json({ member });
  }),
);

projectsRouter.delete(
  '/:projectId/members/:memberId',
  requireProjectAccess('ADMIN'),
  asyncHandler(async (req, res) => {
    await removeProjectMember(
      req.projectAccess!.projectId,
      req.params.memberId,
      req.user!.id,
      req,
    );
    res.status(204).send();
  }),
);

projectsRouter.get(
  '/:projectId/audit-logs',
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 50);
    const auditLogs = await listProjectAuditLogs(req.projectAccess!.projectId, limit);
    res.status(200).json({ auditLogs });
  }),
);
