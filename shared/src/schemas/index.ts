import { z } from 'zod';

// =============================================================================
// Authentication & User Schemas
// =============================================================================
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Invalid email address').max(255).transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address').transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Password is required').max(128),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Must include an uppercase letter')
    .regex(/[a-z]/, 'Must include a lowercase letter')
    .regex(/[0-9]/, 'Must include a number'),
});

// =============================================================================
// Project Schemas
// =============================================================================
export const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(80),
  description: z.string().trim().max(500).optional().nullable(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
});

export const addProjectMemberSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});

export const updateProjectMemberSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

// =============================================================================
// Monitor Schemas
// =============================================================================
export const createMonitorSchema = z.object({
  name: z.string().trim().min(2, 'Monitor name must be at least 2 characters').max(100),
  url: z.string().trim().min(4).max(2048),
  method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(16384).optional().nullable(),
  expectedStatusCodes: z
    .array(z.number().int().min(100).max(599))
    .min(1, 'At least one expected status code is required')
    .max(20)
    .default([200, 201, 202, 204]),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  intervalSeconds: z.number().int().min(15).max(3600).default(60),
  degradedThresholdMs: z.number().int().min(100).max(30000).default(1000),
  failureThreshold: z.number().int().min(1).max(10).default(2),
  recoveryThreshold: z.number().int().min(1).max(10).default(2),
  keyword: z.string().max(500).optional().nullable(),
  keywordMatchType: z.enum(['CONTAINS', 'NOT_CONTAINS']).optional().nullable(),
  followRedirects: z.boolean().default(true),
});

export const updateMonitorSchema = createMonitorSchema.partial();

// =============================================================================
// Incident Schemas
// =============================================================================
export const updateIncidentStatusSchema = z.object({
  status: z.enum(['INVESTIGATING', 'IDENTIFIED', 'MONITORING']),
  message: z.string().trim().max(1000).optional(),
});

export const addIncidentNoteSchema = z.object({
  message: z.string().trim().min(2, 'Investigation note cannot be empty').max(4000),
});

export const resolveIncidentSchema = z.object({
  resolutionNotes: z.string().trim().min(2, 'Please provide resolution details').max(4000),
});

// =============================================================================
// Alert Rule Schemas
// =============================================================================
export const createAlertRuleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  monitorId: z.string().uuid().optional().nullable(),
  triggerType: z.enum([
    'MONITOR_DOWN',
    'MONITOR_RECOVERED',
    'HIGH_LATENCY',
    'INCIDENT_CREATED',
    'INCIDENT_RESOLVED',
  ]),
  thresholdValue: z.number().int().min(50).max(30000).optional().nullable(),
  consecutiveCount: z.number().int().min(1).max(20).default(1),
  cooldownMinutes: z.number().int().min(1).max(1440).default(15),
  channels: z.array(z.enum(['IN_APP', 'EMAIL'])).min(1, 'Select at least one channel'),
  recipientEmails: z.array(z.string().trim().email()).max(20).default([]),
  enabled: z.boolean().default(true),
});

export const updateAlertRuleSchema = createAlertRuleSchema.partial();

// =============================================================================
// Status Page & Maintenance Window Schemas
// =============================================================================
export const statusPageMonitorItemSchema = z.object({
  monitorId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(100),
  groupName: z.string().trim().max(80).optional().nullable(),
  sortOrder: z.number().int().min(0).max(500).default(0),
});

export const createStatusPageSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().trim().max(500).optional().nullable(),
  customHeadline: z.string().trim().max(140).optional().nullable(),
  isPublic: z.boolean().default(true),
  showUptimeHistory: z.boolean().default(true),
  showIncidents: z.boolean().default(true),
  monitors: z.array(statusPageMonitorItemSchema).max(50).default([]),
});

export const updateStatusPageSchema = createStatusPageSchema.partial();

export const createMaintenanceWindowSchema = z
  .object({
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().max(2000).optional().nullable(),
    statusPageId: z.string().uuid().optional().nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    suppressAlerts: z.boolean().default(true),
    monitorIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .refine((d) => new Date(d.endsAt).getTime() > new Date(d.startsAt).getTime(), {
    message: 'Maintenance end time must be after start time',
    path: ['endsAt'],
  });

export const updateMaintenanceWindowSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  statusPageId: z.string().uuid().optional().nullable(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  suppressAlerts: z.boolean().optional(),
  monitorIds: z.array(z.string().uuid()).max(50).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
export type CreateStatusPageInput = z.infer<typeof createStatusPageSchema>;
export type UpdateStatusPageInput = z.infer<typeof updateStatusPageSchema>;
export type CreateMaintenanceWindowInput = z.infer<typeof createMaintenanceWindowSchema>;
export type UpdateMaintenanceWindowInput = z.infer<typeof updateMaintenanceWindowSchema>;
