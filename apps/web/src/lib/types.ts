export type Role = 'APPLICANT' | 'MEMBER' | 'SECRETARY' | 'GS' | 'PRESIDENT' | 'ADMIN';
export type ProposalStatus = 'DRAFT' | 'WITH_SECRETARY' | 'REVISION_REQUESTED' | 'REVISED' | 'WITH_GS' | 'APPROVED' | 'NOT_APPROVED' | 'DEFERRED' | 'WITHDRAWN';
export type ExecutionStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'AT_RISK' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
export type MilestoneStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'AT_RISK' | 'BLOCKED' | 'READY_FOR_VERIFICATION' | 'VERIFIED' | 'CANCELLED';
export type ProjectHealth = 'ON_TRACK' | 'WATCH' | 'AT_RISK' | 'BLOCKED';
export type ProjectSetupStatus = 'AWAITING_SETUP' | 'AWAITING_GS_APPROVAL' | 'ACTIVE';

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
  secretariat?: Secretariat | null;
}

export interface Secretariat { id: string; code: string; name_ar: string; active: boolean; }
export interface Cycle { id: string; code: string; name: string; is_current: boolean; status: string; }

export interface Proposal {
  id: string; internal_id: string; title: string; applicant_id: string; applicant_name: string; applicant_email: string;
  secretariat_id: string; status: ProposalStatus; execution_status: ExecutionStatus; current_version: number;
  submitted_at: string | null; needed_by: string | null; urgency: string | null; proposed_period: string | null;
  primary_beneficiaries: string | null; trigger_reality: string | null; primary_benefit: string | null;
  secondary_benefits: string | null; intervention: string | null; success_criterion: string | null;
  context_factors: string | null; funding_needed: string | null; funding_dependence: string | null;
  estimated_cost: string | null; funding_source: string | null; urgency_reason: string | null; updated_at: string;
  secretariat?: Secretariat;
}

export interface Plan { id: string; title: string; cycle_id: string; secretariat_id: string; period_start: string | null; period_end: string | null; status: string; }
export interface Initiative {
  id: string; plan_id: string | null; proposal_id: string | null; title: string; objective: string | null;
  owner_id: string; secretary_id: string | null; secretariat_id: string; status: string; source_type: string;
  setup_status: ProjectSetupStatus | string; approval_status?: 'DRAFT'|'PENDING_GS'|'APPROVED'|'RETURNED'|string; gs_review_note?: string|null; gs_approved_at?: string|null; assignment_start_at?: string|null; health: ProjectHealth; target_due_at: string | null; activated_at: string | null;
  last_update_at: string | null; update_interval_days?: number; next_update_due_at?: string | null; completed_at: string | null; created_at?: string; updated_at?: string;
  owner?: Pick<Profile,'id'|'full_name'>; secretary?: Pick<Profile,'id'|'full_name'>; secretariat?: Secretariat;
}
export interface ResultItem { id: string; initiative_id: string; statement: string; success_measure: string | null; owner_id: string | null; due_at: string | null; assignment_status?: string; assignment_feedback?: string | null; accepted_at?: string | null; completed_at?: string | null; owner?: Pick<Profile,'id'|'full_name'>; }
export interface Milestone {
  id: string; result_id: string; title: string; description: string | null; owner_id: string; due_at: string;
  status: MilestoneStatus; priority: string; verification_criteria: string; verified_at: string | null; design_status?: string; sequence_no?: number|null; deadline_mode?: 'ABSOLUTE'|'RELATIVE'|string; relative_days?: number|null; relative_to_milestone_id?: string|null; outcome_text?: string|null; lead_note?: string|null; secretary_note?: string|null; status_updated_at?: string|null;
  result?: ResultItem; owner?: Pick<Profile,'id'|'full_name'>;
}
export interface WeeklyCommitment { id: string; milestone_id: string; week_start: string; commitment_text: string; target_at: string | null; status: string; owner_id: string; }
export interface Blocker { id: string; milestone_id: string; description: string; severity: string; status: string; created_at: string; resolved_at: string | null; }
export interface Intervention { id: string; milestone_id: string; secretary_id: string; action_text: string; due_at: string | null; created_at: string; }
export interface Evidence { id: string; milestone_id: string; submitted_by: string; evidence_type: string; note: string | null; drive_file_id: string | null; url: string | null; created_at: string; }
export interface Verification { id: string; milestone_id: string; verifier_id: string; decision: 'VERIFIED' | 'RETURNED'; note: string | null; created_at: string; }

export interface ProjectUpdate { id:string; initiative_id:string; result_id:string|null; author_id:string; health:ProjectHealth; progress_note:string; next_step:string|null; next_check_at:string|null; assistance_needed:string|null; created_at:string; author?:Pick<Profile,'id'|'full_name'>; }
export interface ProjectPermissionApproval { id:string; permission_id:string; approval_kind:'PROJECT_SECRETARY'|'TARGET_SECRETARY'|'EXECUTIVE_COMMITTEE'; target_secretariat_id:string|null; status:'PENDING'|'APPROVED'|'REJECTED'; decided_by:string|null; decision_id:string|null; note:string|null; created_at:string; decided_at:string|null; target_secretariat?:Secretariat; }
export interface ProjectPermission { id:string; initiative_id:string; permission_key:string|null; title:string; description:string|null; permission_type:'STANDARD'|'SPECIAL'; scope_type:'OWN_SECRETARIAT'|'CROSS_SECRETARIAT'|'EXECUTIVE_COMMITTEE'; target_secretariat_id:string|null; requested_by:string|null; requested_for:string; rationale:string|null; status:'PENDING'|'ACTIVE'|'REJECTED'|'REVOKED'; decided_by:string|null; decision_id:string|null; valid_until:string|null; created_at:string; target_secretariat?:Secretariat; requester?:Pick<Profile,'id'|'full_name'>; initiative?:Partial<Initiative>; approvals?:ProjectPermissionApproval[]; }
export interface ProjectIntervention { id:string; initiative_id:string; result_id:string|null; milestone_id:string|null; secretary_id:string; trigger_type:string; reason:string|null; action_text:string; due_at:string|null; status:'OPEN'|'CLOSED'; created_at:string; closed_at:string|null; secretary?:Pick<Profile,'id'|'full_name'>; }
export interface ProjectBundle { initiative:Initiative; results:ResultItem[]; milestones:Milestone[]; updates:ProjectUpdate[]; permissions:ProjectPermission[]; interventions:ProjectIntervention[]; blockers:Blocker[]; oversight:any[]; }


export interface ProjectSheetRow {
  project_id:string; secretariat_id:string; secretariat_name:string; project_title:string; approval_status:string; setup_status:string;
  project_status:string; health:string; lead_id:string; lead_name:string; secretary_id:string|null; secretary_name:string|null;
  result_statement:string|null; success_measure:string|null; assignment_start_at:string|null; target_due_at:string|null;
  update_interval_days:number; next_update_due_at:string|null; update_overdue:boolean; total_milestones:number; verified_milestones:number; current_milestone:string|null; current_milestone_due_at:string|null;
  current_milestone_status:string|null; current_milestone_overdue:boolean; days_to_current_milestone:number|null; latest_update_note:string|null; latest_update_health:string|null; last_lead_note:string|null; last_lead_update_at:string|null; last_intervention:string|null;
  last_intervention_at:string|null; open_blockers:number; latest_blocker_at:string|null; pending_special_permissions:number; needs_attention:boolean; secretary_response_needed:boolean;
}
export interface ProposalSheetRow {
  proposal_id:string; internal_id:string; title:string; applicant_name:string; secretariat_id:string; secretariat_name:string;
  status:string; execution_status:string; submitted_at:string|null; updated_at:string; stage_due_at:string|null; overdue:boolean;
  days_in_current_stage:number; current_version:number; current_pdf_drive_file_id:string|null; document_status:string; document_error:string|null;
}
export interface MemberDirectoryItem { id:string; full_name:string; university_id:string|null; email:string; }


export interface RoutineObligationRow {
  obligation_id:string; secretariat_id:string; secretariat_name:string; title:string; description:string|null; expected_output:string|null;
  owner_id:string; owner_name:string; secretary_id:string|null; secretary_name:string|null; cadence:'WEEKLY'|'MONTHLY'|'QUARTERLY'|'CUSTOM'|string;
  next_due_at:string; overdue:boolean; days_to_due:number; last_status:string|null; last_report:string|null; last_output:string|null;
  last_secretary_note:string|null; last_submitted_at:string|null;
}
export interface ProposalDocumentStatus {
  pdfReady:boolean; pdfDriveFileId:string|null; docxDriveFileId:string|null; jobStatus:string; lastError:string|null; attempts:number; updatedAt:string|null;
}
