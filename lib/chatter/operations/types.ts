import { z } from "zod";

export const employeeIdSchema = z.enum(["hermes", "luna", "diego", "mateo", "valentina", "ana", "lucia", "jorge", "pablo", "carlos"]);
export const jobSourceSchema = z.enum(["telegram", "schedule", "office", "api"]);
export const jobStatusSchema = z.enum(["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]);

export const createJobSchema = z.object({
  employeeId: employeeIdSchema,
  objective: z.string().trim().min(3).max(4_000),
  source: jobSourceSchema,
  requestedBy: z.string().trim().min(1).max(120),
  conversationId: z.string().trim().max(160).optional(),
  idempotencyKey: z.string().trim().min(12).max(160),
});

export type EmployeeId = z.infer<typeof employeeIdSchema>;
export type CreateJob = z.infer<typeof createJobSchema>;

export type ToolPolicy = {
  id: string;
  kind: "api" | "mcp";
  risk: "read" | "write" | "external";
  approval: "never" | "before_external_action" | "always";
};

export type Artifact = {
  name: string;
  contentType: string;
  storagePath: string;
  sizeBytes: number;
};

