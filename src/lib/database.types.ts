/**
 * Database type definitions for the Bbettr Agency Client Portal.
 *
 * These mirror the SQL schema in `supabase/migrations`. In a live project
 * these are typically generated with `supabase gen types typescript`, but we
 * hand-maintain them here so the app is fully typed without a live connection.
 */

export type UserRole = "admin" | "client";

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
