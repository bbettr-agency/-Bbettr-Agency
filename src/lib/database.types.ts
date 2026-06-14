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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          name: string;
          description?: string | null;
          status?: StageStatus;
          position?: number;
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
          notes: string | null;
          status: DealStatus;
          client_id: string | null;
          quickbooks_customer_id: string | null;
          package_key: string | null;
          custom_package_name: string | null;
          custom_package_description: string | null;
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
          notes?: string | null;
          status?: DealStatus;
          client_id?: string | null;
          quickbooks_customer_id?: string | null;
          package_key?: string | null;
          custom_package_name?: string | null;
          custom_package_description?: string | null;
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
