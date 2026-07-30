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

// Planner (Bbettr OS — internal, admin-only)
export type TaskStatus = "todo" | "in_progress" | "completed";
export type TaskPriority = "normal" | "high" | "urgent";
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
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          client_id: string | null;
          full_name: string | null;
          email: string | null;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          role?: UserRole;
          client_id?: string | null;
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
      tasks: {
        Row: {
          id: string;
          title: string;
          notes: string | null;
          client_or_project: string | null;
          assignee_id: string;
          scheduled_date: string | null; // 'YYYY-MM-DD' or null (Inbox)
          status: TaskStatus;
          priority: TaskPriority;
          estimated_minutes: number | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          completed_by: string | null;
          completed_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          // Audit fields (created_by/at, completed_*) are server-stamped by a
          // trigger — never send them from app code.
          title: string;
          notes?: string | null;
          client_or_project?: string | null;
          assignee_id: string;
          scheduled_date?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          estimated_minutes?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Row"]>;
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
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type CalendarCredential = Database["public"]["Tables"]["calendar_credentials"]["Row"];
export type Meeting = Database["public"]["Tables"]["meetings"]["Row"];
export type MeetingAttendee = Database["public"]["Tables"]["meeting_attendees"]["Row"];
export type CalendarProjection = Database["public"]["Tables"]["calendar_projections"]["Row"];
