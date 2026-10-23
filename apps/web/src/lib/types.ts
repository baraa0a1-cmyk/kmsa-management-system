export type Role = 'APPLICANT' | 'MEMBER' | 'SECRETARY' | 'GS' | 'ADMIN';
export type ProposalStatus = 'DRAFT' | 'WITH_SECRETARY' | 'REVISION_REQUESTED' | 'REVISED' | 'WITH_GS' | 'APPROVED' | 'NOT_APPROVED' | 'DEFERRED' | 'WITHDRAWN';
export type ExecutionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'AT_RISK' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
export type MilestoneStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'AT_RISK' | 'BLOCKED' | 'READY_FOR_VERIFICATION' | 'VERIFIED' | 'CANCELLED';

export interface Profile {
  id: string;
  auth_user_id: string;
  university_id: string | null;
  email: string;
  full_name: string;
  role: Role;
  secretariat_id: string | null;
  active: boolean;
  must_change_password: boolean;
}

export interface Secretariat { id: string; code: string; name_ar: string; active: boolean; }
export interface Cycle { id: string; code: string; name: string; is_current: boolean; status: string; }

export interface Proposal {
  id: string;
  internal_id: string;
  title: string;
  applicant_id: string;
  applicant_name: string;
  applicant_email: string;
  secretariat_id: string;
  status: ProposalStatus;
  execution_status: ExecutionStatus;
  current_version: number;
  submitted_at: string | null;
  needed_by: string | null;
  urgency: string | null;
  proposed_period: string | null;
  primary_beneficiaries: string | null;
  trigger_reality: string | null;
  primary_benefit: string | null;
  secondary_benefits: string | null;
  intervention: string | null;
  success_criterion: string | null;
  context_factors: string | null;
  funding_needed: string | null;
  funding_dependence: string | null;
  estimated_cost: string | null;
  funding_source: string | null;
  urgency_reason: string | null;
  updated_at: string;
  secretariat?: Secretariat;
}

export interface Plan { id: string; title: string; cycle_id: string; secretariat_id: string; period_start: string | null; period_end: string | null; status: string; }
export interface Initiative { id: string; plan_id: string | null; proposal_id: string | null; title: string; objective: string | null; owner_id: string; secretariat_id: string; status: string; source_type: string; }
export interface ResultItem { id: string; initiative_id: string; statement: string; success_measure: string | null; owner_id: string | null; due_at: string | null; }
export interface Milestone {
  id: string;
  result_id: string;
  title: string;
  description: string | null;
  owner_id: string;
  due_at: string;
  status: MilestoneStatus;
  priority: string;
  verification_criteria: string;
  verified_at: string | null;
  result?: ResultItem;
  owner?: Pick<Profile,'id'|'full_name'>;
}
export interface WeeklyCommitment { id: string; milestone_id: string; week_start: string; commitment_text: string; target_at: string | null; status: string; owner_id: string; }
export interface Blocker { id: string; milestone_id: string; description: string; severity: string; status: string; created_at: string; resolved_at: string | null; }
export interface Intervention { id: string; milestone_id: string; secretary_id: string; action_text: string; due_at: string | null; created_at: string; }
export interface Evidence { id: string; milestone_id: string; submitted_by: string; evidence_type: string; note: string | null; drive_file_id: string | null; url: string | null; created_at: string; }
export interface Verification { id: string; milestone_id: string; verifier_id: string; decision: 'VERIFIED' | 'RETURNED'; note: string | null; created_at: string; }
