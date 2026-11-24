import { Router } from 'express';
import {
  updateIncidentStatusSchema,
  addIncidentNoteSchema,
  resolveIncidentSchema,
} from '@pulsewatch/shared';
import { authenticate, requireProjectAccess } from '../../middleware/auth';
import { asyncHandler, validateBody } from '../../middleware/validate';
import {
  listProjectIncidents,
  getIncidentById,
  acknowledgeIncident,
  updateIncidentStatus,
  addIncidentInvestigationNote,
  resolveIncidentManually,
} from './incidents.service';

export const incidentsRouter = Router({ mergeParams: true });

incidentsRouter.use(authenticate);

incidentsRouter.get(
  '/',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const incidents = await listProjectIncidents(req.projectAccess!.projectId, {
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
      monitorId: typeof req.query.monitorId === 'string' ? req.query.monitorId : undefined,
    });
    res.status(200).json({ incidents });
  }),
);

incidentsRouter.get(
  '/:incidentId',
  requireProjectAccess('VIEWER'),
  asyncHandler(async (req, res) => {
    const incident = await getIncidentById(
      req.projectAccess!.projectId,
      req.params.incidentId,
    );
    res.status(200).json({ incident });
  }),
);

incidentsRouter.post(
  '/:incidentId/acknowledge',
  requireProjectAccess('MEMBER'),
  asyncHandler(async (req, res) => {
    const incident = await acknowledgeIncident(
      req.projectAccess!.projectId,
      req.params.incidentId,
      req.user!,
      req,
    );
    res.status(200).json({ incident });
  }),
);

incidentsRouter.patch(
  '/:incidentId/status',
  requireProjectAccess('MEMBER'),
  validateBody(updateIncidentStatusSchema),
  asyncHandler(async (req, res) => {
    const incident = await updateIncidentStatus(
      req.projectAccess!.projectId,
      req.params.incidentId,
      req.user!,
      req.body,
      req,
    );
    res.status(200).json({ incident });
  }),
);

incidentsRouter.post(
  '/:incidentId/notes',
  requireProjectAccess('MEMBER'),
  validateBody(addIncidentNoteSchema),
  asyncHandler(async (req, res) => {
    const event = await addIncidentInvestigationNote(
      req.projectAccess!.projectId,
      req.params.incidentId,
      req.user!,
      req.body.message,
      req,
    );
    res.status(201).json({ event });
  }),
);

incidentsRouter.post(
  '/:incidentId/resolve',
  requireProjectAccess('MEMBER'),
  validateBody(resolveIncidentSchema),
  asyncHandler(async (req, res) => {
    const incident = await resolveIncidentManually(
      req.projectAccess!.projectId,
      req.params.incidentId,
      req.user!,
      req.body.resolutionNotes,
      req,
    );
    res.status(200).json({ incident });
  }),
);
