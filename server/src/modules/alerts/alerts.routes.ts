import { Router } from 'express';
import { createAlertRuleSchema, updateAlertRuleSchema } from '@pulsewatch/shared';
import { authenticate, requireProjectAccess } from '../../middleware/auth';
import { asyncHandler, validateBody } from '../../middleware/validate';
import {
  listAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  listUserInAppNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listProjectNotificationLogs,
} from './alerts.service';

export const projectAlertsRouter = Router({ mergeParams: true });
projectAlertsRouter.use(authenticate);

projectAlertsRouter.get(
  '/alert-rules',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const alertRules = await listAlertRules(req.projectAccess!.projectId);
    res.status(200).json({ alertRules });
  }),
);

projectAlertsRouter.post(
  '/alert-rules',
  requireProjectAccess('MEMBER'),
  validateBody(createAlertRuleSchema),
  asyncHandler(async (req, res) => {
    const alertRule = await createAlertRule(
      req.projectAccess!.projectId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(201).json({ alertRule });
  }),
);

projectAlertsRouter.patch(
  '/alert-rules/:ruleId',
  requireProjectAccess('MEMBER'),
  validateBody(updateAlertRuleSchema),
  asyncHandler(async (req, res) => {
    const alertRule = await updateAlertRule(
      req.projectAccess!.projectId,
      req.params.ruleId,
      req.user!.id,
      req.body,
      req,
    );
    res.status(200).json({ alertRule });
  }),
);

projectAlertsRouter.delete(
  '/alert-rules/:ruleId',
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    await deleteAlertRule(
      req.projectAccess!.projectId,
      req.params.ruleId,
      req.user!.id,
      req,
    );
    res.status(204).send();
  }),
);

projectAlertsRouter.get(
  '/notifications',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const notifications = await listProjectNotificationLogs(
      req.projectAccess!.projectId,
      Number(req.query.limit || 50),
    );
    res.status(200).json({ notifications });
  }),
);

export const userNotificationsRouter = Router();
userNotificationsRouter.use(authenticate);

userNotificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await listUserInAppNotifications(req.user!.id);
    res.status(200).json(data);
  }),
);

userNotificationsRouter.patch(
  '/:notificationId/read',
  asyncHandler(async (req, res) => {
    const notification = await markNotificationRead(
      req.user!.id,
      req.params.notificationId,
    );
    res.status(200).json({ notification });
  }),
);

userNotificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await markAllNotificationsRead(req.user!.id);
    res.status(200).json({ message: 'All notifications marked as read' });
  }),
);
