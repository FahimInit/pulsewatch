import { Router } from 'express';
import {
  createStatusPageSchema,
  updateStatusPageSchema,
  createMaintenanceWindowSchema,
  updateMaintenanceWindowSchema,
} from '@pulsewatch/shared';
import { authenticate, requireProjectAccess } from '../../middleware/auth';
import { publicStatusRateLimiter } from '../../middleware/rate-limit';
import { asyncHandler, validateBody } from '../../middleware/validate';
import {
  listProjectStatusPages,
  createStatusPage,
  updateStatusPage,
  deleteStatusPage,
  listMaintenanceWindows,
  createMaintenanceWindow,
  updateMaintenanceWindow,
  deleteMaintenanceWindow,
  getPublicStatusPageBySlug,
} from './status-pages.service';

export const projectStatusPagesRouter = Router({ mergeParams: true });
projectStatusPagesRouter.use(authenticate);

projectStatusPagesRouter.get(
  '/status-pages',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const statusPages = await listProjectStatusPages(req.projectAccess!.projectId);
    res.status(200).json({ statusPages });
  }),
);

projectStatusPagesRouter.post(
  '/status-pages',
  requireProjectAccess('MEMBER'),
  validateBody(createStatusPageSchema),
  asyncHandler(async (req, res) => {
    const statusPage = await createStatusPage(
      req.projectAccess!.projectId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(201).json({ statusPage });
  }),
);

projectStatusPagesRouter.patch(
  '/status-pages/:pageId',
  requireProjectAccess('MEMBER'),
  validateBody(updateStatusPageSchema),
  asyncHandler(async (req, res) => {
    const statusPage = await updateStatusPage(
      req.projectAccess!.projectId,
      req.params.pageId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(200).json({ statusPage });
  }),
);

projectStatusPagesRouter.delete(
  '/status-pages/:pageId',
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    await deleteStatusPage(
      req.projectAccess!.projectId,
      req.params.pageId,
      req.user!.id,
      req,
    );
    res.status(204).send();
  }),
);

projectStatusPagesRouter.get(
  '/maintenance-windows',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const maintenanceWindows = await listMaintenanceWindows(req.projectAccess!.projectId);
    res.status(200).json({ maintenanceWindows });
  }),
);

projectStatusPagesRouter.post(
  '/maintenance-windows',
  requireProjectAccess('MEMBER'),
  validateBody(createMaintenanceWindowSchema),
  asyncHandler(async (req, res) => {
    const maintenanceWindow = await createMaintenanceWindow(
      req.projectAccess!.projectId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(201).json({ maintenanceWindow });
  }),
);

projectStatusPagesRouter.patch(
  '/maintenance-windows/:windowId',
  requireProjectAccess('MEMBER'),
  validateBody(updateMaintenanceWindowSchema),
  asyncHandler(async (req, res) => {
    const maintenanceWindow = await updateMaintenanceWindow(
      req.projectAccess!.projectId,
      req.params.windowId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(200).json({ maintenanceWindow });
  }),
);

projectStatusPagesRouter.delete(
  '/maintenance-windows/:windowId',
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    await deleteMaintenanceWindow(
      req.projectAccess!.projectId,
      req.params.windowId,
      req.user!.id,
      req,
    );
    res.status(204).send();
  }),
);

export const publicStatusRouter = Router();

publicStatusRouter.get(
  '/status-pages/:slug',
  publicStatusRateLimiter,
  asyncHandler(async (req, res) => {
    const data = await getPublicStatusPageBySlug(req.params.slug);
    res.status(200).json(data);
  }),
);
