/**
 * Database type definitions for the Bbettr Agency Client Portal.
 *
 * These mirror the SQL schema in `supabase/migrations`. In a live project
 * these are typically generated with `supabase gen types typescript`, but we
 * hand-maintain them here so the app is fully typed without a live connection.
 */

export type UserRole = "admin" | "client" | "rep";

export type BillingType = "once_off" | "monthly";
export type ClientLocation = "south_africa" | "international";
export type Currency = "ZAR" | "USD";
export type DealStatus =
  | "new"
  | "invoice_requested"
  | "invoiced"
  | "won"
  | "lost";
export type InvoiceRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "invoiced"
  | "failed";
export type CommissionStatus = "pending" | "paid";

export type InternalNotificationType =
  | "deal_submitted"
  | "invoice_request"
  | "rep_created"
  | "rep_deactivated"
  | "maintenance_toggled"
  | "invoice_approved"
  | "invoice_rejected"
  | "commission_recorded"
  | "deal_status"
  | "admin_comment";

export type ClientStatus =
  | "lead"
  | "onboarding"
  | "in_progress"
  | "active"
  | "paused"
  | "completed";

export type ServiceType = "website" | "google_ads" | "meta_ads" | "seo";

export type OnboardingStatus = "not_started" | "in_progress" | "submitted" | "approved";

export type StageStatus = "completed" | "in_progress" | "pending";

export type FileCategory =
  | "logo"
  | "image"
  | "video"
  | "pdf"
  | "brand_guide"
  | "document"
  | "report";

export type AssetCategory =
  | "contracts"
  | "branding"
  | "website_content"
  | "media"
  | "documents"
  | "deliverables"
  | "reports"
  | "invoices";

export type ContractStatus = "not_sent" | "sent" | "signed";

export type OnboardingType = "legacy" | "new";

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export type InvoiceKind = "one_off" | "retainer" | "custom";
export type InvoiceSource = "admin" | "rep_deal" | "quickbooks";

// Planner Tasks domain (Bbettr OS — internal, admin-only). Bounded unions below
// mirror the DB CHECK constraints exactly (migrations 0035–0047). Constrained
// text, never DB enums (see schema-and-migration-spec.md §2/§20).
export type TaskStatus =
  | "inbox"
  | "planned"
  | "scheduled"
  | "in_progress"
  | "waiting"
  | "completed"
  | "archived";
export type TaskPriority = "critical" | "high" | "normal" | "low";
export type ResumeTarget = "planned" | "scheduled";
export type ArchiveReason = "retention" | "cancelled";
export type BlockerClass = "person" | "client" | "approval" | "asset" | "dependency";
export type DependencyKind = "hard" | "info";
export type ReminderState = "pending" | "due" | "delivered" | "cancelled";
export type ActorKind = "user" | "automation" | "system";
export type RecurrenceMode = "completion" | "schedule";
export type MissedPolicy = "skip" | "roll";
export type RecurrenceRuleUnit = "day" | "week" | "month";
export type LabelColorToken =
  | "gray"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "blue"
  | "indigo"
  | "purple"
  | "pink";
export type RedactionMode = "suppress" | "replace";
// Stored receipt outcomes only. `replayed` is a return-only application result
// (never a stored row) — see TaskCommandResult.
export type ReceiptOutcome = "applied" | "accepted_noop";
// The fixed v1 event vocabulary (task-domain-architecture.md §9 + EventRedacted).
export type TaskEventType =
  | "TaskCaptured"
  | "TaskTriaged"
  | "TaskScheduled"
  | "TaskRescheduled"
  | "TaskUnscheduled"
  | "TaskStarted"
  | "TaskBlocked"
  | "TaskUnblocked"
  | "TaskDeferred"
  | "TaskCompleted"
  | "TaskReopened"
  | "TaskArchived"
  | "TaskDropped"
  | "TaskRestored"
  | "TaskOwnerChanged"
  | "TaskAssigned"
  | "TaskUnassigned"
  | "TaskRenamed"
  | "TaskDescriptionEdited"
  | "TaskPriorityChanged"
  | "TaskDueDateChanged"
  | "TaskEstimateChanged"
  | "TaskLabeled"
  | "TaskUnlabeled"
  | "SubtaskAdded"
  | "ChecklistItemAdded"
  | "ChecklistItemChecked"
  | "DependencyAdded"
  | "DependencyRemoved"
  | "DependencyResolved"
  | "RecurringDefinitionCreated"
  | "RecurringDefinitionUpdated"
  | "RecurringInstanceGenerated"
  | "RecurringInstanceMissed"
  | "TaskBecameOverdue"
  | "ReminderDue"
  | "EventRedacted";
// Sanitized JSON value (task_events.payload domain facts only — no secrets).
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];
// Phase 3 — meetings + calendar projection.
export type MeetingStatus = "scheduled" | "cancelled";
export type MeetState = "not_requested" | "pending" | "ready" | "failed";
export type ProjectionSyncState =
  | "not_applicable"
  | "pending"
  | "synced"
  | "failed"
  | "disconnected";
export type PaymentMethod = "eft" | "payfast" | "quickbooks" | "cash" | "manual";

export type IntakeStatus =
  | "draft"
  | "contract_sent"
  | "contract_signed"
  | "invoice_sent"
  | "paid"
  | "portal_access_sent"
  | "onboarding_started"
  | "onboarding_submitted";

export type NotificationType =
  | "report_published"
  | "update_posted"
  | "stage_advanced"
  | "assets_needed"
  | "action_required";

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string;
          name: string;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          company: string | null;
          status: ClientStatus;
          logo_url: string | null;
          notes: string | null;
          estimated_launch_date: string | null;
          success_manager_id: string | null;
          onboarding_type: OnboardingType;
          intake_status: IntakeStatus;
          portal_access_granted_at: string | null;
          portal_access_granted_by: string | null;
          welcome_email_sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["clients"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Row"]>;
        Relationships: [];
      };
      weekly_updates: {
        Row: {
          id: string;
          workspace_id: string;
          author_user_id: string;
          summary: string;
          client_id: string | null;
          update_date: string; // agency-local YYYY-MM-DD
          created_at: string;
          updated_at: string;
        };
        // workspace_id + author_user_id are derived server-side; the audit trigger
        // stamps created_at/updated_at — callers supply summary/client_id/update_date.
        Insert: {
          id?: string;
          workspace_id: string;
          author_user_id: string;
          summary: string;
          client_id?: string | null;
          update_date: string;
        };
        Update: Partial<Database["public"]["Tables"]["weekly_updates"]["Row"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          client_id: string | null;
          // Planner workspace binding (added in migration 0036; nullable FK to
          // public.workspaces). Admins are backfilled to the seeded agency
          // workspace; clients/reps stay null.
          workspace_id: string | null;
          full_name: string | null;
          email: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          role?: UserRole;
          client_id?: string | null;
          workspace_id?: string | null;
          full_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      client_services: {
        Row: {
          id: string;
          client_id: string;
          service: ServiceType;
          onboarding_status: OnboardingStatus;
          created_at: string;
        };
        Insert: {
          client_id: string;
          service: ServiceType;
          onboarding_status?: OnboardingStatus;
        };
        Update: Partial<Database["public"]["Tables"]["client_services"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "client_services_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      onboarding_submissions: {
        Row: {
          id: string;
          client_id: string;
          service: ServiceType;
          data: Record<string, unknown>;
          status: OnboardingStatus;
          submitted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          service: ServiceType;
          data?: Record<string, unknown>;
          status?: OnboardingStatus;
          submitted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["onboarding_submissions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "onboarding_submissions_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      project_stages: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          description: string | null;
          status: StageStatus;
          position: number;
          target_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          name: string;
          description?: string | null;
          status?: StageStatus;
          position?: number;
          target_date?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["project_stages"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "project_stages_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      updates: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          body: string;
          published_at: string;
          author_id: string | null;
          author_name: string | null;
          created_at: string;
        };
        Insert: {
          client_id: string;
          title: string;
          body: string;
          published_at?: string;
          author_id?: string | null;
          author_name?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["updates"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "updates_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      update_reactions: {
        Row: {
          id: string;
          update_id: string;
          client_id: string;
          profile_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          update_id: string;
          client_id: string;
          profile_id: string;
          emoji: string;
        };
        Update: Partial<Database["public"]["Tables"]["update_reactions"]["Row"]>;
        Relationships: [];
      };
      update_questions: {
        Row: {
          id: string;
          update_id: string;
          client_id: string;
          profile_id: string | null;
          channel: "callback" | "email";
          message: string | null;
          status: "open" | "resolved";
          created_at: string;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          update_id: string;
          client_id: string;
          profile_id?: string | null;
          channel: "callback" | "email";
          message?: string | null;
          status?: "open" | "resolved";
        };
        Update: Partial<Database["public"]["Tables"]["update_questions"]["Row"]>;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          client_id: string;
          reporting_month: string; // ISO date (first of month)
          ad_spend: number | null;
          leads_generated: number | null;
          cost_per_lead: number | null;
          clicks: number | null;
          impressions: number | null;
          conversion_rate: number | null;
          summary: string | null;
          key_wins: string | null;
          opportunities: string | null;
          next_month_plan: string | null;
          pdf_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          reporting_month: string;
          ad_spend?: number | null;
          leads_generated?: number | null;
          cost_per_lead?: number | null;
          clicks?: number | null;
          impressions?: number | null;
          conversion_rate?: number | null;
          summary?: string | null;
          key_wins?: string | null;
          opportunities?: string | null;
          next_month_plan?: string | null;
          pdf_path?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "reports_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      files: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          path: string;
          category: FileCategory;
          asset_category: AssetCategory;
          subcategory: string | null;
          client_visible: boolean;
          mime_type: string | null;
          size_bytes: number | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          client_id: string;
          name: string;
          path: string;
          category?: FileCategory;
          asset_category?: AssetCategory;
          subcategory?: string | null;
          client_visible?: boolean;
          mime_type?: string | null;
          size_bytes?: number | null;
          uploaded_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["files"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "files_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      client_section_views: {
        Row: {
          client_id: string;
          section: string;
          last_viewed_at: string;
        };
        Insert: {
          client_id: string;
          section: string;
          last_viewed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_section_views"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "client_section_views_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      notifications: {
        Row: {
          id: string;
          client_id: string;
          type: NotificationType;
          title: string;
          body: string | null;
          link: string | null;
          action_required: boolean;
          resolved_at: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          client_id: string;
          type: NotificationType;
          title: string;
          body?: string | null;
          link?: string | null;
          action_required?: boolean;
          resolved_at?: string | null;
          read_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "notifications_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      portal_settings: {
        Row: {
          id: boolean;
          maintenance_mode: boolean;
          maintenance_message: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          maintenance_mode?: boolean;
          maintenance_message?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["portal_settings"]["Row"]>;
        Relationships: [];
      };
      reps: {
        Row: {
          id: string;
          display_name: string | null;
          phone: string | null;
          commission_rate: number;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          phone?: string | null;
          commission_rate?: number;
          active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["reps"]["Row"]>;
        Relationships: [];
      };
      deals: {
        Row: {
          id: string;
          rep_id: string;
          business_name: string;
          contact_name: string | null;
          email: string | null;
          phone: string | null;
          package: string | null;
          price: number | null;
          billing_type: BillingType;
          client_location: ClientLocation;
          currency: Currency;
          notes: string | null;
          status: DealStatus;
          client_id: string | null;
          quickbooks_customer_id: string | null;
          package_key: string | null;
          custom_package_name: string | null;
          custom_package_description: string | null;
          has_monthly_retainer: boolean;
          monthly_retainer_name: string | null;
          monthly_retainer_description: string | null;
          monthly_retainer_amount: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          rep_id: string;
          business_name: string;
          contact_name?: string | null;
          email?: string | null;
          phone?: string | null;
          package?: string | null;
          price?: number | null;
          billing_type?: BillingType;
          client_location?: ClientLocation;
          currency?: Currency;
          notes?: string | null;
          status?: DealStatus;
          client_id?: string | null;
          quickbooks_customer_id?: string | null;
          package_key?: string | null;
          custom_package_name?: string | null;
          custom_package_description?: string | null;
          has_monthly_retainer?: boolean;
          monthly_retainer_name?: string | null;
          monthly_retainer_description?: string | null;
          monthly_retainer_amount?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["deals"]["Row"]>;
        Relationships: [];
      };
      invoice_requests: {
        Row: {
          id: string;
          deal_id: string;
          rep_id: string;
          amount: number;
          billing_type: BillingType;
          status: InvoiceRequestStatus;
          quickbooks_invoice_id: string | null;
          quickbooks_invoice_number: string | null;
          quickbooks_customer_id: string | null;
          approved_by: string | null;
          error: string | null;
          invoiced_at: string | null;
          quickbooks_realm_id: string | null;
          quickbooks_email_status: string | null;
          quickbooks_emailed_at: string | null;
          quickbooks_last_attempt_at: string | null;
          quickbooks_log: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          deal_id: string;
          rep_id: string;
          amount: number;
          billing_type: BillingType;
          status?: InvoiceRequestStatus;
          quickbooks_invoice_id?: string | null;
          quickbooks_invoice_number?: string | null;
          quickbooks_customer_id?: string | null;
          approved_by?: string | null;
          error?: string | null;
          invoiced_at?: string | null;
          quickbooks_realm_id?: string | null;
          quickbooks_email_status?: string | null;
          quickbooks_emailed_at?: string | null;
          quickbooks_last_attempt_at?: string | null;
          quickbooks_log?: Record<string, unknown> | null;
        };
        Update: Partial<Database["public"]["Tables"]["invoice_requests"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "invoice_requests_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          }
        ];
      };
      commissions: {
        Row: {
          id: string;
          rep_id: string;
          deal_id: string;
          amount: number;
          rate: number;
          status: CommissionStatus;
          created_at: string;
        };
        Insert: {
          rep_id: string;
          deal_id: string;
          amount: number;
          rate?: number;
          status?: CommissionStatus;
        };
        Update: Partial<Database["public"]["Tables"]["commissions"]["Row"]>;
        Relationships: [];
      };
      internal_notifications: {
        Row: {
          id: string;
          recipient_id: string;
          type: InternalNotificationType;
          title: string;
          body: string | null;
          link: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          recipient_id: string;
          type: InternalNotificationType;
          title: string;
          body?: string | null;
          link?: string | null;
          read_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["internal_notifications"]["Row"]>;
        Relationships: [];
      };
      quickbooks_connection: {
        Row: {
          id: boolean;
          realm_id: string;
          access_token: string;
          refresh_token: string;
          token_expires_at: string;
          refresh_expires_at: string | null;
          environment: string;
          company_name: string | null;
          connected_by: string | null;
          connected_at: string;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          realm_id: string;
          access_token: string;
          refresh_token: string;
          token_expires_at: string;
          refresh_expires_at?: string | null;
          environment?: string;
          company_name?: string | null;
          connected_by?: string | null;
          connected_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["quickbooks_connection"]["Row"]>;
        Relationships: [];
      };
      payfast_payments: {
        Row: {
          id: string;
          invoice_request_id: string;
          deal_id: string | null;
          m_payment_id: string;
          amount: number;
          item_name: string;
          payment_url: string;
          status: string;
          pf_payment_id: string | null;
          paid_at: string | null;
          marked_paid_by: string | null;
          raw_itn: Record<string, unknown> | null;
          pf_payment_status: string | null;
          amount_gross: number | null;
          itn_received_at: string | null;
          itn_valid: boolean | null;
          itn_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          invoice_request_id: string;
          deal_id?: string | null;
          m_payment_id: string;
          amount: number;
          item_name: string;
          payment_url: string;
          status?: string;
          pf_payment_id?: string | null;
          paid_at?: string | null;
          marked_paid_by?: string | null;
          raw_itn?: Record<string, unknown> | null;
        };
        Update: Partial<Database["public"]["Tables"]["payfast_payments"]["Row"]>;
        Relationships: [];
      };
      team_members: {
        Row: {
          id: string;
          name: string;
          role: string | null;
          email: string | null;
          whatsapp: string | null;
          photo_url: string | null;
          calendly_url: string | null;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          name: string;
          role?: string | null;
          email?: string | null;
          whatsapp?: string | null;
          photo_url?: string | null;
          calendly_url?: string | null;
          is_default?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["team_members"]["Row"]>;
        Relationships: [];
      };
      activity_events: {
        Row: {
          id: string;
          client_id: string;
          type: string;
          title: string;
          description: string | null;
          visibility: string;
          icon: string | null;
          occurred_at: string;
          source: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          client_id: string;
          type: string;
          title: string;
          description?: string | null;
          visibility?: string;
          icon?: string | null;
          occurred_at?: string;
          source?: string;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["activity_events"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "activity_events_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      contracts: {
        Row: {
          id: string;
          client_id: string;
          title: string;
          status: ContractStatus;
          contract_url: string | null;
          signed_file_url: string | null;
          file_id: string | null;
          sent_at: string | null;
          signed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          title: string;
          status?: ContractStatus;
          contract_url?: string | null;
          signed_file_url?: string | null;
          file_id?: string | null;
          sent_at?: string | null;
          signed_at?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["contracts"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      client_invoices: {
        Row: {
          id: string;
          client_id: string;
          invoice_number: string;
          title: string;
          description: string | null;
          amount: number;
          currency: string;
          kind: InvoiceKind;
          status: InvoiceStatus;
          issued_at: string | null;
          due_at: string | null;
          paid_at: string | null;
          quickbooks_invoice_id: string | null;
          quickbooks_invoice_number: string | null;
          invoice_request_id: string | null;
          source: InvoiceSource;
          file_id: string | null;
          reminded_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          invoice_number: string;
          title: string;
          description?: string | null;
          amount: number;
          currency?: string;
          kind?: InvoiceKind;
          status?: InvoiceStatus;
          issued_at?: string | null;
          due_at?: string | null;
          paid_at?: string | null;
          quickbooks_invoice_id?: string | null;
          quickbooks_invoice_number?: string | null;
          invoice_request_id?: string | null;
          source?: InvoiceSource;
          file_id?: string | null;
          reminded_at?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["client_invoices"]["Row"]>;
        Relationships: [];
      };
      client_payments: {
        Row: {
          id: string;
          client_id: string;
          invoice_id: string | null;
          amount: number;
          method: PaymentMethod;
          reference: string | null;
          payfast_payment_id: string | null;
          received_at: string;
          recorded_by: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          client_id: string;
          invoice_id?: string | null;
          amount: number;
          method?: PaymentMethod;
          reference?: string | null;
          payfast_payment_id?: string | null;
          received_at?: string;
          recorded_by?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["client_payments"]["Row"]>;
        Relationships: [];
      };
      client_retainers: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          amount: number;
          cadence: string;
          active: boolean;
          started_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          name: string;
          amount: number;
          cadence?: string;
          active?: boolean;
          started_at?: string | null;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["client_retainers"]["Row"]>;
        Relationships: [];
      };
      // ── Planner Tasks domain (0035–0047) ────────────────────────────────
      // Every Tasks table is WRITE-LOCKED to authenticated: reads are governed
      // by admin+workspace RLS (or the safe-read functions for engine tables),
      // and ALL writes flow through the internal apply_task_command op. Insert
      // and Update are therefore `never` — direct client writes are impossible
      // by construction and rejected at the type level.
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          title: string;
          description: string | null;
          status: TaskStatus;
          created_by: string;
          owner_user_id: string | null;
          assignee_id: string | null;
          priority: TaskPriority;
          critical_reason: string | null;
          estimated_minutes: number | null;
          scheduled_date: string | null; // 'YYYY-MM-DD'
          due_date: string | null; // 'YYYY-MM-DD'
          started_at: string | null;
          completed_at: string | null;
          completed_by: string | null;
          archived_at: string | null;
          archive_reason: ArchiveReason | null;
          blocked_since: string | null;
          resume_target: ResumeTarget | null;
          aggregate_version: number;
          parent_id: string | null;
          client_id: string | null;
          recurrence_definition_id: string | null;
          occurrence_slot: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      task_blockers: {
        Row: {
          id: string;
          workspace_id: string;
          task_id: string;
          blocker_class: BlockerClass;
          blocker_key: string;
          reference_user_id: string | null;
          reference_task_id: string | null;
          reference_client_id: string | null;
          reason: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      task_dependencies: {
        Row: {
          id: string;
          workspace_id: string;
          dependent_id: string;
          prerequisite_id: string;
          kind: DependencyKind;
          resolved_at: string | null;
          removed_at: string | null;
          removal_reason: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      labels: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          color_token: LabelColorToken;
          archived_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      task_labels: {
        Row: {
          workspace_id: string;
          task_id: string;
          label_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      recurring_definitions: {
        Row: {
          id: string;
          workspace_id: string;
          owner_user_id: string;
          default_assignee_id: string | null;
          template_title: string;
          template_description: string | null;
          template_priority: TaskPriority;
          template_estimated_minutes: number | null;
          template_client_id: string | null;
          rule_interval: number;
          rule_unit: RecurrenceRuleUnit;
          mode: RecurrenceMode;
          timezone: string;
          missed_policy: MissedPolicy;
          due_offset_days: number | null;
          next_occurrence: string | null;
          anchor_day: number | null; // 1..31 intended day-of-month for monthly rules (0052)
          active: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // Written ONLY by the trusted service-role recurrence path (RLS blocks
        // authenticated writes); id/created_at/updated_at are DB/trigger-managed.
        Insert: {
          id?: string;
          workspace_id: string;
          owner_user_id: string;
          default_assignee_id?: string | null;
          template_title: string;
          template_description?: string | null;
          template_priority: TaskPriority;
          template_estimated_minutes?: number | null;
          template_client_id?: string | null;
          rule_interval: number;
          rule_unit: RecurrenceRuleUnit;
          mode: RecurrenceMode;
          timezone?: string;
          missed_policy: MissedPolicy;
          due_offset_days?: number | null;
          next_occurrence?: string | null;
          anchor_day?: number | null;
          active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["recurring_definitions"]["Insert"]> & {
          active?: boolean;
          next_occurrence?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      task_reminders: {
        Row: {
          id: string;
          workspace_id: string;
          task_id: string;
          remind_at: string;
          state: ReminderState;
          dedupe_key: string | null;
          claimed_at: string | null;
          claim_token: string | null;
          delivered_at: string | null;
          attempts: number;
          last_error: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      task_events: {
        // Append-only, service-role-only. Authenticated NEVER selects this raw —
        // reads go through read_task_events (SafeTaskEvent). Row typed for
        // server/service-role consumers.
        Row: {
          event_id: string;
          workspace_id: string;
          task_id: string;
          aggregate_version: number;
          event_sequence: number;
          event_type: TaskEventType;
          event_schema_version: number;
          actor_kind: ActorKind;
          actor_user_id: string | null;
          actor_ref: string | null;
          actor_display: string;
          occurred_at: string;
          correlation_id: string | null;
          causation_id: string | null;
          command_idempotency_key: string | null;
          payload: Json;
          global_seq: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      event_redactions: {
        // Append-only overlay, service-role-only (same narrow FK SET NULL
        // exception as task_events actors). Consumed only via read_task_events.
        Row: {
          id: string;
          workspace_id: string;
          target_event_id: string | null;
          subject_kind: string | null;
          subject_ref: string | null;
          redacted_fields: string[];
          mode: RedactionMode;
          replacement: string | null;
          reason: string;
          redacted_by: string | null;
          redacted_by_display: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      command_receipts: {
        // Success-only idempotency receipts, service-role-only engine table.
        Row: {
          id: string;
          workspace_id: string;
          idempotency_key: string;
          command_type: string;
          payload_hash: string;
          actor_kind: ActorKind | null;
          actor_user_id: string | null;
          actor_ref: string | null;
          result_task_id: string | null;
          result_aggregate_version: number | null;
          outcome: ReceiptOutcome;
          created_at: string;
          expires_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      calendar_credentials: {
        Row: {
          id: number;
          provider: string;
          google_account_email: string | null;
          google_calendar_id: string | null;
          scopes: string | null;
          status: "connected" | "reconnect_required" | "disconnected";
          refresh_token_enc: string | null;
          connected_by: string | null;
          connected_at: string | null;
          updated_at: string;
          disconnected_by: string | null;
          disconnected_at: string | null;
        };
        Insert: {
          id?: number;
          provider?: string;
          google_account_email?: string | null;
          google_calendar_id?: string | null;
          scopes?: string | null;
          status?: "connected" | "reconnect_required" | "disconnected";
          refresh_token_enc?: string | null;
          connected_by?: string | null;
          connected_at?: string | null;
          updated_at?: string;
          disconnected_by?: string | null;
          disconnected_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_credentials"]["Row"]>;
        Relationships: [];
      };
      meetings: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          starts_at: string;
          ends_at: string;
          time_zone: string;
          has_meet: boolean;
          status: MeetingStatus;
          idempotency_key: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          cancelled_by: string | null;
          cancelled_at: string | null;
          deleted_at: string | null;
        };
        // Audit fields (created_by/at, cancelled_by/at, updated_at) are
        // server-stamped by the meetings_enforce_audit trigger — omit on insert.
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          starts_at: string;
          ends_at: string;
          time_zone?: string;
          has_meet?: boolean;
          status?: MeetingStatus;
          idempotency_key?: string | null;
          deleted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["meetings"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "meetings_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      meeting_attendees: {
        Row: {
          id: string;
          meeting_id: string;
          email: string;
          display_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          email: string;
          display_name?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["meeting_attendees"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "meeting_attendees_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      calendar_projections: {
        Row: {
          id: string;
          entity_type: "meeting";
          entity_id: string;
          google_calendar_id: string;
          google_event_id: string | null;
          id_epoch: number;
          etag: string | null;
          meet_url: string | null;
          meet_state: MeetState;
          last_meet_error: string | null;
          sync_state: ProjectionSyncState;
          synced_hash: string | null;
          sync_attempts: number;
          next_attempt_at: string | null;
          locked_at: string | null;
          lock_token: string | null;
          last_sync_at: string | null;
          last_sync_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          entity_type?: "meeting";
          entity_id: string;
          google_calendar_id: string;
          google_event_id?: string | null;
          id_epoch?: number;
          etag?: string | null;
          meet_url?: string | null;
          meet_state?: MeetState;
          last_meet_error?: string | null;
          sync_state?: ProjectionSyncState;
          synced_hash?: string | null;
          sync_attempts?: number;
          next_attempt_at?: string | null;
          locked_at?: string | null;
          lock_token?: string | null;
          last_sync_at?: string | null;
          last_sync_error?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_projections"]["Row"]>;
        Relationships: [];
      };
    };
    Views: { [key: string]: never };
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_client_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      next_qbo_invoice_docnumber: {
        Args: Record<string, never>;
        Returns: string;
      };
      next_client_invoice_number: {
        Args: Record<string, never>;
        Returns: string;
      };
      create_meeting_with_attendees: {
        Args: {
          p_title: string;
          p_description: string | null;
          p_starts_at: string;
          p_ends_at: string;
          p_time_zone: string;
          p_has_meet: boolean;
          p_idempotency_key: string | null;
          p_attendees: { email: string; display_name: string | null }[];
        };
        Returns: string;
      };
      // Returns the affected meeting id, or null when the meeting is missing /
      // already deleted (idempotent no-op).
      soft_delete_meeting: {
        Args: { p_meeting_id: string };
        Returns: string;
      };
      // ── Planner Tasks domain (0036–0048) ────────────────────────────────
      // Admin-only permanent erase of a task (SECURITY DEFINER; re-checks
      // is_admin(); workspace-scoped). Sets deleted_at so the task disappears
      // from every view. Returns the id, or null when the task is missing /
      // already erased / outside the workspace (idempotent no-op).
      erase_task: {
        Args: { p_task_id: string };
        Returns: string | null;
      };
      // Resolves the acting admin's workspace; NULL (fail-closed) when unset.
      current_workspace_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      // Internal atomic write op (SECURITY INVOKER, service-role EXECUTE only).
      // DB signature is (jsonb)->jsonb; the true contract is the hand-authored
      // TaskCommandEnvelope → TaskCommandResult below.
      apply_task_command: {
        Args: { p_envelope: TaskCommandEnvelope };
        Returns: TaskCommandResult;
      };
      // Internal append-only redaction overlay writer (service-role only).
      apply_event_redaction: {
        Args: { p_envelope: EventRedactionInput };
        Returns: EventRedactionResult;
      };
      // Safe, admin+workspace-scoped, redaction-aware per-task event history
      // (SECURITY DEFINER; authenticated EXECUTE only). Keyset pagination on
      // (aggregate_version, event_sequence); p_limit normalized into [1, 200].
      read_task_events: {
        Args: {
          p_task_id: string;
          p_after_version?: number | null;
          p_after_seq?: number | null;
          p_limit?: number | null;
        };
        Returns: SafeTaskEvent[];
      };
      // Safe reminder INTENT (SECURITY DEFINER; authenticated EXECUTE only).
      read_task_reminders: {
        Args: { p_task_id: string };
        Returns: SafeTaskReminder[];
      };
    };
  };
}

// Convenience row aliases used throughout the app.
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ClientService = Database["public"]["Tables"]["client_services"]["Row"];
export type OnboardingSubmission =
  Database["public"]["Tables"]["onboarding_submissions"]["Row"];
export type ProjectStage = Database["public"]["Tables"]["project_stages"]["Row"];
export type Update = Database["public"]["Tables"]["updates"]["Row"];
export type UpdateReaction = Database["public"]["Tables"]["update_reactions"]["Row"];
export type UpdateQuestion = Database["public"]["Tables"]["update_questions"]["Row"];
export type QuestionChannel = "callback" | "email";
export type Report = Database["public"]["Tables"]["reports"]["Row"];
export type FileRecord = Database["public"]["Tables"]["files"]["Row"];
export type Notification = Database["public"]["Tables"]["notifications"]["Row"];
export type PortalSettings = Database["public"]["Tables"]["portal_settings"]["Row"];
export type Rep = Database["public"]["Tables"]["reps"]["Row"];
export type Deal = Database["public"]["Tables"]["deals"]["Row"];
export type InvoiceRequest = Database["public"]["Tables"]["invoice_requests"]["Row"];
export type Commission = Database["public"]["Tables"]["commissions"]["Row"];
export type InternalNotification = Database["public"]["Tables"]["internal_notifications"]["Row"];
export type QuickbooksConnection = Database["public"]["Tables"]["quickbooks_connection"]["Row"];
export type PayfastPayment = Database["public"]["Tables"]["payfast_payments"]["Row"];
export type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];
export type ActivityEvent = Database["public"]["Tables"]["activity_events"]["Row"];
export type Contract = Database["public"]["Tables"]["contracts"]["Row"];
export type ClientInvoice = Database["public"]["Tables"]["client_invoices"]["Row"];
export type ClientPayment = Database["public"]["Tables"]["client_payments"]["Row"];
export type ClientRetainer = Database["public"]["Tables"]["client_retainers"]["Row"];
// Planner Tasks domain row aliases (0035–0047).
export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type TaskBlocker = Database["public"]["Tables"]["task_blockers"]["Row"];
export type TaskDependency = Database["public"]["Tables"]["task_dependencies"]["Row"];
export type Label = Database["public"]["Tables"]["labels"]["Row"];
export type TaskLabel = Database["public"]["Tables"]["task_labels"]["Row"];
export type RecurringDefinition = Database["public"]["Tables"]["recurring_definitions"]["Row"];
export type WeeklyUpdate = Database["public"]["Tables"]["weekly_updates"]["Row"];
export type TaskReminder = Database["public"]["Tables"]["task_reminders"]["Row"];
export type TaskEvent = Database["public"]["Tables"]["task_events"]["Row"];
export type EventRedaction = Database["public"]["Tables"]["event_redactions"]["Row"];
export type CommandReceipt = Database["public"]["Tables"]["command_receipts"]["Row"];
export type CalendarCredential = Database["public"]["Tables"]["calendar_credentials"]["Row"];
export type Meeting = Database["public"]["Tables"]["meetings"]["Row"];
export type MeetingAttendee = Database["public"]["Tables"]["meeting_attendees"]["Row"];
export type CalendarProjection = Database["public"]["Tables"]["calendar_projections"]["Row"];

// ─────────────────────────────────────────────────────────────────────────────
// Planner Tasks — internal persistence & safe-read contracts (0046–0047).
//
// The DB signatures are (jsonb)->jsonb / RETURNS TABLE, which the generated
// types cannot express. These hand-authored shapes ARE the contract the
// TypeScript command layer must honor when it calls the internal op / safe reads
// (see schema-and-migration-spec.md §16–§17). The op — never the caller — owns
// aggregate_version, event identity (id/sequence/occurred_at) and all protected
// timestamps; those fields are deliberately absent from the envelope below.
// ─────────────────────────────────────────────────────────────────────────────

/** Verified actor identity, passed explicitly (the service-role connection has no auth.uid()). */
export interface CommandActor {
  actor_kind: ActorKind;
  actor_user_id?: string | null; // only when actor_kind === 'user'
  actor_ref?: string | null; // stable id for automation/system principals
  actor_display: string; // immutable snapshot recorded on the event
}

/** The ONLY task columns a caller may set (whitelisted; op ignores everything else). */
export interface TaskFieldDeltas {
  status?: TaskStatus;
  title?: string;
  description?: string | null;
  owner_user_id?: string | null;
  assignee_id?: string | null;
  priority?: TaskPriority;
  critical_reason?: string | null;
  estimated_minutes?: number | null;
  scheduled_date?: string | null;
  due_date?: string | null;
  resume_target?: ResumeTarget | null;
  parent_id?: string | null;
  client_id?: string | null;
  recurrence_definition_id?: string | null;
  occurrence_slot?: string | null;
}

/** Bounded satellite mutations the op accepts (no arbitrary SQL). */
export type SatelliteChange =
  | { op: "blocker_add"; blocker_class: BlockerClass; blocker_key: string; reference_user_id?: string | null; reference_task_id?: string | null; reference_client_id?: string | null; reason?: string | null }
  | { op: "blocker_resolve"; blocker_key: string }
  | { op: "dependency_add"; prerequisite_id: string; kind: DependencyKind }
  | { op: "dependency_resolve"; prerequisite_id: string; kind: DependencyKind }
  | { op: "dependency_remove"; prerequisite_id: string; kind: DependencyKind; removal_reason?: string | null }
  | { op: "label_add"; label_id: string }
  | { op: "label_remove"; label_id: string };

/** One event's INTENT — the op assigns event_id, aggregate_version, event_sequence, occurred_at. */
export interface OrderedEventInput {
  event_type: TaskEventType;
  event_schema_version: number;
  payload?: Json;
}

/** The controlled command-result envelope: TS command handler → apply_task_command. */
export interface TaskCommandEnvelope {
  actor: CommandActor;
  workspace_id: string;
  command_type: string;
  task_id?: string | null; // null on create (op generates)
  expected_aggregate_version?: number | null; // null on create
  command_idempotency_key: string;
  payload_hash: string;
  correlation_id?: string | null;
  causation_id?: string | null;
  task_field_deltas?: TaskFieldDeltas;
  satellite_changes?: SatelliteChange[];
  ordered_events: OrderedEventInput[];
  expected_result?: { outcome: ReceiptOutcome };
}

/** Result of apply_task_command. `replayed` is return-only (never a stored receipt). */
export interface TaskCommandResult {
  outcome: "applied" | "accepted_noop" | "replayed";
  result_task_id: string;
  result_aggregate_version: number;
  stored_outcome?: ReceiptOutcome; // present on a replay
}

/** Input to apply_event_redaction (append-only overlay; original event untouched). */
export interface EventRedactionInput {
  workspace_id: string;
  target_event_id?: string | null; // event-level
  subject_kind?: string | null; // subject-level (paired with subject_ref)
  subject_ref?: string | null;
  redacted_fields: string[];
  mode: RedactionMode;
  replacement?: string | null; // required when mode === 'replace'
  reason: string;
  actor: { actor_user_id?: string | null; actor_display: string };
}

export interface EventRedactionResult {
  outcome: "applied";
  redaction_id: string;
}

/** Safe, redaction-applied projection returned by read_task_events. */
export interface SafeTaskEvent {
  event_id: string;
  occurred_at: string;
  event_type: TaskEventType;
  aggregate_version: number;
  event_sequence: number;
  actor_display: string | null; // null/masked when redacted
  summary: string; // server-generated, non-PII
  details: Record<string, string | number | boolean>; // whitelisted scalars only
}

/** Safe reminder intent returned by read_task_reminders (engine fields hidden). */
export interface SafeTaskReminder {
  id: string;
  task_id: string;
  remind_at: string;
  state: ReminderState;
  created_at: string;
}
