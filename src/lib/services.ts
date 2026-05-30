import type { ServiceType } from "@/lib/database.types";
import { Globe, Search, Megaphone, type LucideIcon } from "lucide-react";

/** Field types supported by the dynamic onboarding renderer. */
export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "color"
  | "multitext" // repeatable list of strings (e.g. competitors)
  | "checkbox-group" // pick many from options
  | "file"; // file upload field

export interface OnboardingField {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: string[];
  accept?: string; // for file fields
}

export interface OnboardingSection {
  title: string;
  description?: string;
  fields: OnboardingField[];
}

export interface ServiceDefinition {
  id: ServiceType;
  name: string;
  tagline: string;
  icon: LucideIcon;
  /** Tailwind gradient classes for the service accent. */
  accent: string;
  sections: OnboardingSection[];
}

/**
 * The catalog of services Bbettr Agency offers, each with its own dynamic
 * onboarding definition. The onboarding flow renders only the services a
 * client has purchased — driving the "dynamic onboarding" requirement.
 */
export const SERVICES: Record<ServiceType, ServiceDefinition> = {
  website: {
    id: "website",
    name: "Website Design",
    tagline: "Conversion-focused websites that build trust.",
    icon: Globe,
    accent: "from-brand-500 to-brand-700",
    sections: [
      {
        title: "Business Details",
        description: "Tell us about your brand so we can represent it perfectly.",
        fields: [
          { name: "business_name", label: "Business Name", type: "text", required: true },
          {
            name: "services",
            label: "Services You Offer",
            type: "textarea",
            placeholder: "List the products/services your business provides…",
            required: true,
          },
          {
            name: "target_locations",
            label: "Target Locations",
            type: "multitext",
            help: "Add each city, region or country you want to target.",
          },
          {
            name: "competitors",
            label: "Competitors",
            type: "multitext",
            help: "Websites of competitors you admire or want to outrank.",
          },
        ],
      },
      {
        title: "Brand & Assets",
        description: "Your visual identity and the assets we'll work with.",
        fields: [
          {
            name: "brand_colours",
            label: "Primary Brand Colour",
            type: "color",
            help: "Pick your main brand colour. Add more in the notes if needed.",
          },
          {
            name: "logo",
            label: "Logo Upload",
            type: "file",
            accept: "image/*,.pdf,.ai,.svg",
            help: "Upload your logo (vector preferred).",
          },
          {
            name: "images",
            label: "Image Uploads",
            type: "file",
            accept: "image/*",
            help: "Photos of your team, products, premises, etc.",
          },
        ],
      },
      {
        title: "Contact & Social",
        fields: [
          { name: "whatsapp_number", label: "WhatsApp Number", type: "tel" },
          { name: "contact_email", label: "Contact Email", type: "email" },
          { name: "contact_phone", label: "Contact Phone", type: "tel" },
          {
            name: "social_links",
            label: "Social Links",
            type: "multitext",
            help: "Facebook, Instagram, LinkedIn, TikTok, etc.",
          },
        ],
      },
      {
        title: "Website Requirements",
        fields: [
          {
            name: "example_websites",
            label: "Example Websites You Like",
            type: "multitext",
          },
          {
            name: "required_pages",
            label: "Required Pages",
            type: "checkbox-group",
            options: [
              "Home",
              "About",
              "Services",
              "Portfolio / Gallery",
              "Pricing",
              "Blog",
              "Contact",
              "Booking",
              "Shop / E-commerce",
            ],
          },
          {
            name: "website_goals",
            label: "Website Goals",
            type: "textarea",
            placeholder: "What does success look like for this website?",
            required: true,
          },
        ],
      },
    ],
  },
  google_ads: {
    id: "google_ads",
    name: "Google Ads",
    tagline: "High-intent traffic that converts.",
    icon: Search,
    accent: "from-emerald-500 to-emerald-700",
    sections: [
      {
        title: "Access & Tracking",
        description: "We'll need access to run and measure your campaigns.",
        fields: [
          {
            name: "google_ads_access",
            label: "Google Ads Access",
            type: "text",
            placeholder: "Google Ads account ID or email granted access",
            help: "Grant Bbettr Agency manager access to your Google Ads account.",
          },
          { name: "analytics_access", label: "Google Analytics Access", type: "text" },
          { name: "gtm_access", label: "Google Tag Manager Access", type: "text" },
        ],
      },
      {
        title: "Campaign Setup",
        fields: [
          {
            name: "budget",
            label: "Monthly Budget",
            type: "number",
            placeholder: "e.g. 15000",
            required: true,
          },
          {
            name: "services_to_promote",
            label: "Services To Promote",
            type: "textarea",
            required: true,
          },
          { name: "competitors", label: "Competitors", type: "multitext" },
          { name: "locations", label: "Target Locations", type: "multitext" },
        ],
      },
      {
        title: "Goals",
        fields: [
          { name: "campaign_goals", label: "Campaign Goals", type: "textarea" },
          {
            name: "conversion_goals",
            label: "Conversion Goals",
            type: "textarea",
            placeholder: "Form fills, calls, purchases, bookings…",
          },
        ],
      },
    ],
  },
  meta_ads: {
    id: "meta_ads",
    name: "Meta Ads",
    tagline: "Demand generation across Facebook & Instagram.",
    icon: Megaphone,
    accent: "from-indigo-500 to-purple-600",
    sections: [
      {
        title: "Accounts & Access",
        fields: [
          { name: "facebook_page", label: "Facebook Page", type: "url" },
          { name: "instagram_account", label: "Instagram Account", type: "text" },
          {
            name: "meta_business_manager",
            label: "Meta Business Manager Access",
            type: "text",
            help: "Business Manager ID or the email we should be added to.",
          },
        ],
      },
      {
        title: "Campaign Strategy",
        fields: [
          { name: "budget", label: "Monthly Budget", type: "number", required: true },
          {
            name: "ad_objectives",
            label: "Ad Objectives",
            type: "checkbox-group",
            options: [
              "Awareness",
              "Traffic",
              "Engagement",
              "Leads",
              "App Promotion",
              "Sales",
            ],
          },
          { name: "target_audience", label: "Target Audience", type: "textarea" },
          {
            name: "existing_campaigns",
            label: "Existing Campaigns",
            type: "textarea",
            placeholder: "Describe any campaigns currently running or paused.",
          },
        ],
      },
      {
        title: "Creative",
        fields: [
          {
            name: "creative_uploads",
            label: "Creative Uploads",
            type: "file",
            accept: "image/*,video/*",
            help: "Photos or video clips we can use for ads.",
          },
        ],
      },
    ],
  },
  seo: {
    id: "seo",
    name: "SEO",
    tagline: "Sustainable organic growth.",
    icon: Search,
    accent: "from-amber-500 to-orange-600",
    sections: [
      {
        title: "Site & Competition",
        fields: [
          { name: "website", label: "Website", type: "url", required: true },
          { name: "competitors", label: "Competitors", type: "multitext" },
          { name: "locations", label: "Target Locations", type: "multitext" },
        ],
      },
      {
        title: "Keywords & Goals",
        fields: [
          {
            name: "keywords",
            label: "Target Keywords",
            type: "multitext",
            help: "Phrases you want to rank for.",
          },
          { name: "seo_goals", label: "SEO Goals", type: "textarea" },
          {
            name: "search_console_access",
            label: "Search Console Access",
            type: "text",
            help: "Email to grant Google Search Console access.",
          },
        ],
      },
    ],
  },
};

export const SERVICE_LIST = Object.values(SERVICES);

export function getService(service: ServiceType): ServiceDefinition {
  return SERVICES[service];
}
