import { Router } from 'express';
import { createMonitorSchema, updateMonitorSchema } from '@pulsewatch/shared';
import { authenticate, requireProjectAccess } from '../../middleware/auth';
import { checkNowRateLimiter } from '../../middleware/rate-limit';
import { asyncHandler, validateBody } from '../../middleware/validate';
import {
  listProjectMonitors,
  createMonitor,
  getMonitorById,
  updateMonitor,
  deleteMonitor,
  pauseMonitor,
  resumeMonitor,
  triggerManualCheck,
  getMonitorCheckResults,
} from './monitors.service';

export const monitorsRouter = Router({ mergeParams: true });

monitorsRouter.use(authenticate);

monitorsRouter.get(
  '/',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const monitors = await listProjectMonitors(req.projectAccess!.projectId, {
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    res.status(200).json({ monitors });
  }),
);

monitorsRouter.post(
  '/',
  requireProjectAccess('MEMBER'),
  validateBody(createMonitorSchema),
  asyncHandler(async (req, res) => {
    const monitor = await createMonitor(
      req.projectAccess!.projectId,
      req.projectAccess!.project.monitorLimit,
      req.user!.id,
      req.body,
      req,
    );
    res.status(201).json({ monitor });
  }),
);

monitorsRouter.get(
  '/:monitorId',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const monitor = await getMonitorById(
      req.projectAccess!.projectId,
      req.params.monitorId,
    );
    res.status(200).json({ monitor });
  }),
);

monitorsRouter.patch(
  '/:monitorId',
  requireProjectAccess('MEMBER'),
  validateBody(updateMonitorSchema),
  asyncHandler(async (req, res) => {
    const monitor = await updateMonitor(
      req.projectAccess!.projectId,
      req.params.monitorId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(200).json({ monitor });
  }),
);

monitorsRouter.delete(
  '/:monitorId',
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    await deleteMonitor(
      req.projectAccess!.projectId,
      req.params.monitorId,
      req.user!.id,
      req,
    );
    res.status(204).send();
  }),
);

monitorsRouter.post(
  '/:monitorId/pause',
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    const monitor = await pauseMonitor(
      req.projectAccess!.projectId,
      req.params.monitorId,
      req.user!.id,
      req,
    );
    res.status(200).json({ monitor });
  }),
);

monitorsRouter.post(
  '/:monitorId/resume',
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    const monitor = await resumeMonitor(
      req.projectAccess!.projectId,
      req.params.monitorId,
      req.user!.id,
      req,
    );
    res.status(200).json({ monitor });
  }),
);

monitorsRouter.post(
  '/:monitorId/check-now',
  checkNowRateLimiter,
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    const result = await triggerManualCheck(
      req.projectAccess!.projectId,
      req.params.monitorId,
      req.user!.id,
      req,
    );
    res.status(202).json(result);
  }),
);

monitorsRouter.get(
  '/:monitorId/results',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const results = await getMonitorCheckResults(
      req.projectAccess!.projectId,
      req.params.monitorId,
      {
        limit: req.query.limit ? Number(req.query.limit) : 50,
        range: typeof req.query.range === 'string' ? req.query.range : '24h',
      },
    );
    res.status(200).json({ results });
  }),
);
