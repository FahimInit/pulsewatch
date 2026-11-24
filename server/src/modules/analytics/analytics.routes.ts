import { Router } from 'express';
import { authenticate, requireProjectAccess } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/validate';
import {
  getProjectOverviewAnalytics,
  getResponseTimeSeries,
  getUptimeHistorySeries,
  getMonitorHealthDistribution,
} from './analytics.service';

export const analyticsRouter = Router({ mergeParams: true });

analyticsRouter.use(authenticate);

analyticsRouter.get(
  '/overview',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const overview = await getProjectOverviewAnalytics(
      req.projectAccess!.projectId,
      typeof req.query.range === 'string' ? req.query.range : '24h',
    );
    res.status(200).json({ overview });
  }),
);

analyticsRouter.get(
  '/response-times',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const series = await getResponseTimeSeries(req.projectAccess!.projectId, {
      range: typeof req.query.range === 'string' ? req.query.range : '24h',
      monitorId: typeof req.query.monitorId === 'string' ? req.query.monitorId : undefined,
    });
    res.status(200).json({ series });
  }),
);

analyticsRouter.get(
  '/uptime',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const series = await getUptimeHistorySeries(req.projectAccess!.projectId, {
      range: typeof req.query.range === 'string' ? req.query.range : '30d',
      monitorId: typeof req.query.monitorId === 'string' ? req.query.monitorId : undefined,
    });
    res.status(200).json({ series });
  }),
);

analyticsRouter.get(
  '/health-distribution',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const distribution = await getMonitorHealthDistribution(req.projectAccess!.projectId);
    res.status(200).json({ distribution });
  }),
);
