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
  | "select" // single choice (dropdown)
  | "boolean" // Yes/No toggle
  | "multitext" // repeatable list of strings (e.g. competitors)
  | "checkbox-group" // pick many from options
  | "group-list" // repeatable structured entries (uses subFields)
  | "note" // informational message (optionally conditional)
  | "file"; // file upload field

/**
 * Conditional visibility for a field or section. The field/section shows only
 * when the referenced field's value satisfies the condition:
 *  - `equals`   → value === equals (booleans are stored as "Yes"/"No")
 *  - `includes` → value is an array containing `includes` (e.g. checkbox-group)
 */
export interface VisibleWhen {
  field: string;
  equals?: string;
  includes?: string;
}

export interface OnboardingField {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: string[];
  accept?: string; // for file fields
  /** Sub-fields for a `group-list` entry. */
  subFields?: OnboardingField[];
  /** Conditional visibility. */
  visibleWhen?: VisibleWhen;
  /** Message body for a `note` field. */
  note?: string;
}

export interface OnboardingSection {
  title: string;
  description?: string;
  fields: OnboardingField[];
  /** Conditional visibility for the whole section. */
  visibleWhen?: VisibleWhen;
  /** Final review/submit step — rendered as a summary, not input fields. */
  review?: boolean;
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

const CTA_OPTIONS = [
  "Call Us",
  "WhatsApp Us",
  "Book Appointment",
  "Request Quote",
  "Buy Online",
  "Visit Store",
  "Send Enquiry",
];

const RESPONSE_TIME_OPTIONS = [
  "Under 5 Minutes",
  "Under 30 Minutes",
  "Same Day",
  "Next Day",
];

const LEAD_DESTINATION_OPTIONS = [
  "WhatsApp",
  "Phone",
  "Website Form",
  "CRM",
  "Email",
];

const AGE_RANGE_OPTIONS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+", "All ages"];
const GENDER_OPTIONS = ["All", "Mostly women", "Mostly men"];

const REVIEW_SECTION: OnboardingSection = {
  title: "Final Review",
  description: "Review your answers, then submit. You can reopen any section to edit.",
  review: true,
  fields: [],
};

/**
 * The catalog of services Bbettr Agency offers, each with its own dynamic
 * onboarding definition. The onboarding flow renders only the services a
 * client has purchased — driving the "dynamic onboarding" requirement.
 *
 * Field `name`s are stable keys persisted in onboarding_submissions.data — never
 * rename an existing key (older drafts would lose that value). New/replacement
 * fields use new keys; superseded keys (e.g. brand_colours, ad_objectives,
 * google_ads_access) are simply no longer rendered but remain in stored JSON.
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
        title: "Business Information",
        description: "Tell us about your brand so we can represent it perfectly.",
        fields: [
          { name: "business_name", label: "Business Name", type: "text", required: true },
          {
            name: "business_description",
            label: "Business Description",
            type: "textarea",
            required: true,
            placeholder: "Who are you? What do you do? Why should customers choose you?",
          },
          {
            name: "services",
            label: "Services You Offer",
            type: "textarea",
            required: true,
            placeholder: "List the products/services your business provides…",
          },
          {
            name: "unique_selling_points",
            label: "Unique Selling Points",
            type: "textarea",
            placeholder: "What makes your business different?",
          },
          {
            name: "primary_cta",
            label: "Primary Call To Action",
            type: "select",
            required: true,
            options: CTA_OPTIONS,
            help: "The main action you want visitors to take.",
          },
          { name: "existing_website_url", label: "Existing Website URL", type: "url" },
          {
            name: "google_business_profile_url",
            label: "Google Business Profile URL",
            type: "url",
          },
          { name: "physical_address", label: "Physical Address", type: "textarea" },
          { name: "operating_hours", label: "Operating Hours", type: "textarea" },
          {
            name: "target_locations",
            label: "Target Locations",
            type: "multitext",
            help: "Cities, regions or countries you serve.",
          },
        ],
      },
      {
        title: "Brand & Assets",
        description: "Your visual identity and the assets we'll work with.",
        fields: [
          {
            name: "preferred_brand_colours",
            label: "Preferred Brand Colours",
            type: "multitext",
            placeholder: "e.g. #38B6FF, navy, white",
            help: "Add each colour (hex or name).",
          },
          {
            name: "brand_guidelines",
            label: "Brand Guidelines Upload",
            type: "file",
            accept: "image/*,.pdf,.ai,.svg,.zip",
          },
          { name: "logo", label: "Logo Upload", type: "file", accept: "image/*,.pdf,.ai,.svg", help: "Vector preferred." },
          { name: "images", label: "Image Uploads", type: "file", accept: "image/*", help: "Photos of your team, products, premises, etc." },
        ],
      },
      {
        title: "Website Content",
        description: "What goes on the site.",
        fields: [
          {
            name: "required_pages",
            label: "Required Pages",
            type: "checkbox-group",
            options: [
              "Home", "About", "Services", "Portfolio / Gallery", "Pricing",
              "Blog", "Contact", "Booking", "Shop / E-commerce",
            ],
          },
          {
            name: "team_members",
            label: "Team Information",
            type: "group-list",
            help: "Add each team member you'd like featured.",
            subFields: [
              { name: "name", label: "Team Member Name", type: "text" },
              { name: "position", label: "Position", type: "text" },
              { name: "photo", label: "Photo Upload", type: "file", accept: "image/*" },
            ],
          },
          {
            name: "testimonials",
            label: "Testimonials / Reviews",
            type: "textarea",
            placeholder: "Paste reviews or testimonials you'd like featured.",
          },
          { name: "review_uploads", label: "Review Uploads", type: "file", accept: "image/*,.pdf" },
          // E-commerce — only shown when a Shop / E-commerce page is selected.
          {
            name: "payment_methods",
            label: "Payment Methods",
            type: "checkbox-group",
            options: ["PayFast", "Paystack", "Yoco", "EFT", "Other"],
            visibleWhen: { field: "required_pages", includes: "Shop / E-commerce" },
          },
          {
            name: "shipping_areas",
            label: "Shipping Areas",
            type: "multitext",
            visibleWhen: { field: "required_pages", includes: "Shop / E-commerce" },
          },
          {
            name: "number_of_products",
            label: "Number Of Products",
            type: "number",
            visibleWhen: { field: "required_pages", includes: "Shop / E-commerce" },
          },
          {
            name: "product_csv",
            label: "Product CSV Upload",
            type: "file",
            accept: ".csv",
            visibleWhen: { field: "required_pages", includes: "Shop / E-commerce" },
          },
        ],
      },
      {
        title: "Design Preferences",
        description: "Look, feel and inspiration.",
        fields: [
          { name: "example_websites", label: "Example Websites You Like", type: "multitext" },
          {
            name: "website_goals",
            label: "Website Goals",
            type: "textarea",
            required: true,
            placeholder: "What does success look like for this website?",
          },
        ],
      },
      {
        title: "SEO & Marketing",
        description: "Search visibility, marketing assets and legal readiness.",
        fields: [
          { name: "seo_services_to_rank", label: "Services You Want To Rank For", type: "multitext" },
          { name: "seo_locations_to_rank", label: "Locations You Want To Rank For", type: "multitext" },
          { name: "seo_competitors_to_outrank", label: "Competitors You Want To Outrank", type: "multitext" },
          { name: "facebook_page_url", label: "Facebook Page URL", type: "url" },
          { name: "instagram_profile_url", label: "Instagram Profile URL", type: "url" },
          { name: "google_ads_account_id", label: "Google Ads Account ID", type: "text" },
          { name: "currently_running_ads", label: "Currently Running Ads?", type: "boolean" },
          {
            name: "legal_documents",
            label: "Legal Documents You Already Have",
            type: "checkbox-group",
            options: ["Privacy Policy", "POPIA Policy", "Terms & Conditions", "Disclaimer"],
          },
          {
            name: "legal_help_note",
            label: "",
            type: "note",
            note: "Don't have all of these? No problem — we can assist in generating these documents for you.",
          },
        ],
      },
      {
        title: "Technical Access",
        description:
          "Access we need to build and launch your site. Not sure about any of these? Choose “Not sure” and our team will sort it out with you — none of these are required to continue.",
        fields: [
          { name: "domain_exists", label: "Do You Already Have a Domain?", type: "boolean" },
          { name: "domain_provider", label: "Domain Provider", type: "text", placeholder: "e.g. GoDaddy, Afrihost, Xneelo" },
          { name: "domain_access", label: "Domain Login / Access", type: "text" },
          { name: "hosting_provider", label: "Hosting Provider", type: "text" },
          { name: "hosting_access", label: "Hosting Login / Access", type: "text" },
        ],
      },
      {
        title: "Contact Information",
        description: "How clients and we reach you.",
        fields: [
          { name: "contact_email", label: "Contact Email", type: "email", required: true },
          { name: "contact_phone", label: "Contact Phone", type: "tel", required: true },
          { name: "whatsapp_number", label: "WhatsApp Number", type: "tel" },
          { name: "social_links", label: "Social Links", type: "multitext", help: "Facebook, Instagram, LinkedIn, TikTok, etc." },
        ],
      },
      REVIEW_SECTION,
    ],
  },

  meta_ads: {
    id: "meta_ads",
    name: "Meta Ads",
    tagline: "Demand generation across Facebook & Instagram.",
    icon: Megaphone,
    accent: "from-indigo-500 to-purple-600",
    sections: [
      // Objective FIRST — Meta is demand generation. Not every campaign is about
      // leads; it can be awareness, engagement, video views, traffic or sales.
      // Lead-specific questions later appear only for the "Leads & Enquiries"
      // objective, so an awareness campaign never gets a lead-gen interrogation.
      {
        title: "Campaign Objective",
        description: "What do you mainly want these ads to achieve?",
        fields: [
          {
            name: "campaign_objective",
            label: "Primary Objective",
            type: "select",
            required: true,
            options: [
              "Brand Awareness & Reach",
              "Engagement & Followers",
              "Video Views",
              "Website Traffic",
              "Leads & Enquiries",
              "Sales / Purchases",
              "App Installs",
            ],
            help: "Meta can do far more than leads — pick the goal that matters most for this campaign.",
          },
          {
            name: "objective_detail",
            label: "What would make this campaign a success?",
            type: "textarea",
            placeholder: "e.g. more brand awareness in Cape Town, 50 leads a month, more Reel views…",
          },
          { name: "budget", label: "Monthly Ad Budget", type: "number", required: true },
        ],
      },
      {
        title: "Business & Offer",
        fields: [
          { name: "business_description", label: "Business Description", type: "textarea", required: true },
          { name: "unique_selling_points", label: "What makes you different?", type: "textarea" },
          { name: "product_service_to_advertise", label: "What are we promoting?", type: "textarea", required: true },
          { name: "offer_description", label: "Any specific offer, promotion or hook?", type: "textarea" },
          { name: "website_url", label: "Website / Landing Page URL", type: "url" },
        ],
      },
      {
        title: "Meta Account Access",
        fields: [
          { name: "facebook_page", label: "Facebook Page", type: "url" },
          { name: "instagram_account", label: "Instagram Account", type: "text" },
          { name: "meta_business_manager", label: "Meta Business Manager Access", type: "text", help: "Business Manager ID or the email to add us to." },
          { name: "ad_account_id", label: "Ad Account ID", type: "text" },
          { name: "pixel_id", label: "Meta Pixel / Dataset ID", type: "text" },
          { name: "pixel_installed", label: "Is the Meta Pixel installed on your site?", type: "boolean" },
        ],
      },
      {
        title: "Audience",
        description: "Who should see these ads? Meta is brilliant at reaching the right people.",
        fields: [
          { name: "ideal_customer_description", label: "Describe your ideal customer", type: "textarea", required: true },
          { name: "age_range", label: "Age Range", type: "select", options: AGE_RANGE_OPTIONS },
          { name: "gender", label: "Gender", type: "select", options: GENDER_OPTIONS },
          { name: "target_locations", label: "Target Locations", type: "multitext" },
          {
            name: "interests_behaviours",
            label: "Interests, behaviours or passions",
            type: "multitext",
            help: "Things your audience is into — e.g. fitness, home décor, small business owners.",
          },
          {
            name: "customer_list_available",
            label: "Do you have a customer list for lookalike audiences?",
            type: "boolean",
            help: "An email/phone list lets us target people similar to your best customers.",
          },
        ],
      },
      {
        title: "Creative",
        description: "Creative is the single biggest driver of results on Meta.",
        fields: [
          { name: "creative_uploads", label: "Photos & Video", type: "file", accept: "image/*,video/*", help: "Anything we can use — product shots, behind-the-scenes, clips, testimonials." },
          {
            name: "has_video",
            label: "Do you have video content we can use?",
            type: "boolean",
            help: "Short video and Reels typically outperform static images on Meta.",
          },
          {
            name: "preferred_creative_type",
            label: "Preferred creative styles",
            type: "checkbox-group",
            options: ["Images", "Video / Reels", "Carousel", "Testimonials", "User-generated (UGC)", "Before & After", "Educational", "Promotional"],
          },
          {
            name: "brand_tone",
            label: "How should your brand sound & feel?",
            type: "checkbox-group",
            options: ["Friendly", "Professional", "Bold", "Fun", "Premium", "Inspirational", "Educational"],
          },
          { name: "posts_organically", label: "Do you already post on Facebook / Instagram?", type: "boolean" },
          { name: "ads_you_like", label: "Ads or brands whose style you like (links)", type: "multitext" },
          { name: "brand_guidelines", label: "Brand Guidelines Upload", type: "file", accept: "image/*,.pdf,.zip" },
        ],
      },
      {
        title: "Competitors & Inspiration",
        fields: [
          { name: "competitor_facebook_pages", label: "Competitor Facebook Pages", type: "multitext" },
          { name: "competitor_instagram_pages", label: "Competitor Instagram Accounts", type: "multitext" },
        ],
      },
      // Lead handling — only relevant when the objective is leads/enquiries.
      {
        title: "Lead Handling",
        description: "How enquiries reach you and get followed up.",
        visibleWhen: { field: "campaign_objective", equals: "Leads & Enquiries" },
        fields: [
          { name: "lead_destination", label: "Where should leads go?", type: "select", options: LEAD_DESTINATION_OPTIONS },
          { name: "responsible_contact_person", label: "Who handles new leads?", type: "text" },
          { name: "average_response_time", label: "How quickly can you respond?", type: "select", options: RESPONSE_TIME_OPTIONS, help: "Fast responses win far more business on Meta." },
          { name: "crm_in_use", label: "Do you use a CRM?", type: "boolean" },
          { name: "crm_name", label: "CRM Name", type: "text", visibleWhen: { field: "crm_in_use", equals: "Yes" } },
        ],
      },
      {
        title: "Tracking",
        description: "So we can measure what's working. We'll help set anything up that's missing.",
        fields: [
          { name: "conversion_tracking_installed", label: "Is conversion tracking set up on your site?", type: "boolean" },
          {
            name: "key_conversion_action",
            label: "What action counts as a win?",
            type: "text",
            placeholder: "e.g. purchase, form submit, WhatsApp click, booking",
          },
        ],
      },
      {
        title: "Previous Meta Ads",
        fields: [
          { name: "ran_meta_ads", label: "Have you run Meta ads before?", type: "boolean" },
          { name: "previous_avg_spend", label: "Roughly how much per month?", type: "number", visibleWhen: { field: "ran_meta_ads", equals: "Yes" } },
          { name: "what_worked", label: "What worked well?", type: "textarea", visibleWhen: { field: "ran_meta_ads", equals: "Yes" } },
          { name: "what_didnt_work", label: "What didn't work?", type: "textarea", visibleWhen: { field: "ran_meta_ads", equals: "Yes" } },
        ],
      },
      REVIEW_SECTION,
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
        title: "Business Information",
        fields: [
          { name: "business_description", label: "Business Description", type: "textarea", required: true },
          { name: "unique_selling_points", label: "Unique Selling Points", type: "textarea" },
          { name: "website_url", label: "Website URL", type: "url" },
        ],
      },
      {
        title: "Google Account Access",
        description: "Grant Bbettr Agency manager access so we can run and measure campaigns.",
        fields: [
          { name: "google_ads_customer_id", label: "Google Ads Customer ID", type: "text", placeholder: "e.g. 123-456-7890" },
          { name: "google_ads_access_email", label: "Access Email", type: "email" },
          { name: "analytics_access", label: "Google Analytics Access", type: "text" },
          { name: "gtm_access", label: "Google Tag Manager Access", type: "text" },
        ],
      },
      {
        title: "Offer & Services",
        fields: [
          { name: "services_to_promote", label: "Services/Products To Advertise", type: "textarea", required: true },
          { name: "offer_description", label: "Offer Description", type: "textarea" },
          { name: "promotions", label: "Promotions", type: "textarea" },
          { name: "pricing_information", label: "Pricing Information", type: "textarea" },
          { name: "guarantees", label: "Guarantees", type: "textarea" },
        ],
      },
      {
        title: "Services & Landing Pages",
        fields: [
          { name: "landing_page_url", label: "Landing Page URL", type: "url" },
          { name: "pages_to_send_traffic", label: "Pages To Send Traffic To", type: "multitext" },
          { name: "need_landing_page", label: "Need Landing Page Built?", type: "boolean" },
        ],
      },
      {
        title: "Keywords & Search Intent",
        fields: [
          { name: "keywords", label: "Keywords Customers Search For", type: "multitext", help: "Phrases your customers type into Google." },
          { name: "highest_priority_services", label: "Highest Priority Services", type: "textarea" },
          { name: "services_not_to_advertise", label: "Services Not To Advertise", type: "textarea" },
        ],
      },
      {
        title: "Target Customer",
        fields: [
          { name: "ideal_customer_description", label: "Ideal Customer Description", type: "textarea" },
          { name: "residential_business_both", label: "Residential / Business / Both", type: "select", options: ["Residential", "Business", "Both"] },
          { name: "industries_to_target", label: "Industries To Target", type: "multitext" },
          { name: "age_range", label: "Age Range", type: "select", options: AGE_RANGE_OPTIONS },
        ],
      },
      {
        title: "Target Locations",
        fields: [
          { name: "locations", label: "Target Locations", type: "multitext", required: true },
        ],
      },
      {
        title: "Competitors",
        fields: [
          { name: "competitor_websites", label: "Competitor Websites", type: "multitext" },
          { name: "competitors_to_outrank", label: "Competitors To Outrank", type: "multitext" },
          { name: "competitor_ad_examples", label: "Competitor Ad Examples", type: "multitext" },
        ],
      },
      {
        title: "Conversion Tracking",
        fields: [
          { name: "ga_installed", label: "Google Analytics Installed?", type: "boolean" },
          { name: "gtm_installed", label: "Google Tag Manager Installed?", type: "boolean" },
          { name: "conversion_tracking_installed", label: "Conversion Tracking Installed?", type: "boolean" },
          { name: "call_tracking_installed", label: "Call Tracking Installed?", type: "boolean" },
          { name: "form_tracking_installed", label: "Form Tracking Installed?", type: "boolean" },
        ],
      },
      {
        title: "Previous Google Ads History",
        fields: [
          { name: "ran_google_ads", label: "Run Google Ads Before?", type: "boolean" },
          { name: "previous_monthly_spend", label: "Monthly Spend", type: "number", visibleWhen: { field: "ran_google_ads", equals: "Yes" } },
          { name: "what_worked", label: "What Worked?", type: "textarea", visibleWhen: { field: "ran_google_ads", equals: "Yes" } },
          { name: "what_didnt_work", label: "What Didn't Work?", type: "textarea", visibleWhen: { field: "ran_google_ads", equals: "Yes" } },
          { name: "why_stopped", label: "Why Did You Stop?", type: "textarea", visibleWhen: { field: "ran_google_ads", equals: "Yes" } },
        ],
      },
      {
        title: "Campaign Goals",
        fields: [
          { name: "campaign_goals", label: "Campaign Goals", type: "textarea", required: true },
          { name: "conversion_goals", label: "Conversion Goals", type: "textarea", required: true, placeholder: "Form fills, calls, purchases, bookings…" },
          { name: "budget", label: "Monthly Budget", type: "number", required: true, placeholder: "e.g. 15000" },
          { name: "lead_destination", label: "Lead Destination", type: "select", required: true, options: ["Phone Calls", "WhatsApp", "Website Form", "CRM", "Email"] },
          { name: "responsible_contact_person", label: "Responsible Contact Person", type: "text" },
          { name: "best_contact_number", label: "Best Contact Number", type: "tel" },
          { name: "best_contact_email", label: "Best Contact Email", type: "email" },
          { name: "average_response_time", label: "Average Response Time", type: "select", options: RESPONSE_TIME_OPTIONS },
        ],
      },
      {
        title: "Assets",
        fields: [
          { name: "logo", label: "Logo Upload", type: "file", accept: "image/*,.pdf,.ai,.svg" },
          { name: "images", label: "Image Uploads", type: "file", accept: "image/*" },
          { name: "brand_guidelines", label: "Brand Guidelines", type: "file", accept: "image/*,.pdf,.zip" },
          { name: "certifications", label: "Certifications / Accreditations", type: "file", accept: "image/*,.pdf" },
        ],
      },
      {
        title: "Business Operations",
        fields: [
          { name: "operating_hours", label: "Operating Hours", type: "textarea" },
          { name: "service_areas", label: "Service Areas", type: "multitext" },
          { name: "physical_address", label: "Physical Address", type: "textarea" },
          { name: "google_business_profile_url", label: "Google Business Profile URL", type: "url" },
          { name: "review_information", label: "Review Information", type: "textarea" },
        ],
      },
      REVIEW_SECTION,
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
          { name: "keywords", label: "Target Keywords", type: "multitext", help: "Phrases you want to rank for." },
          { name: "seo_goals", label: "SEO Goals", type: "textarea" },
          { name: "search_console_access", label: "Search Console Access", type: "text", help: "Email to grant Google Search Console access." },
        ],
      },
    ],
  },
};

/**
 * Plain-language help for technical fields, keyed by field `name` (shared across
 * services where the concept is identical, e.g. `ga_installed`). A field's
 * presence here is what marks it "technical" in the onboarding renderer, which
 * then offers a "Not sure" option, this contextual help, a "Need help?" panel
 * and a "Schedule setup call" shortcut. We never assume the client knows the
 * jargon — every entry explains the concept in everyday terms.
 */
export const TECHNICAL_FIELD_HELP: Record<string, string> = {
  // Website — domain & hosting
  domain_exists:
    "Your domain is your web address, like yourbusiness.co.za. If you're not sure whether you have one, that's completely fine — we'll check for you.",
  domain_provider:
    "This is the company you bought your web address from (e.g. GoDaddy, Afrihost or Xneelo). Not sure? Choose “Not sure” and we'll find it for you.",
  domain_access:
    "To connect your web address to your new site we need access to where it's managed. You can share login details securely or add us as a user — or pick “Not sure” and we'll guide you step by step.",
  hosting_provider:
    "Hosting is where your website's files live online. If you already have a website, you have hosting somewhere. Not sure? We'll help you find it.",
  hosting_access:
    "Access to your hosting lets us publish your new site. Share it securely or add us as a user — or choose “Not sure” and we'll walk you through it.",

  // Website — marketing
  google_ads_account_id:
    "Your Google Ads account ID (if you've run Google Ads before). Don't have one or can't find it? Choose “Not sure”.",
  currently_running_ads:
    "Are any paid ads (Google, Facebook, Instagram) running for your business right now? It's okay if you're not certain.",

  // Meta — accounts & tracking
  meta_business_manager:
    "Meta Business Manager is the central account that holds your Facebook Page, Instagram and ad account. If you don't have one or aren't sure, we set these up for clients all the time.",
  meta_business_manager_id:
    "This is a long number found in Business Settings → Business Info on Meta. Can't find it? Choose “Not sure”.",
  ad_account_id:
    "Your Meta ad account is what's billed for ads and holds your campaigns. Not sure if you have one? We'll create it.",
  pixel_id:
    "The Meta Pixel is a small piece of code on your website that measures ad results. If you don't have one, we'll create and install it for you.",
  pixel_installed:
    "This asks whether ad-tracking code is already on your website. If you don't know, choose “Not sure” — we'll check and handle it.",

  // CRM
  crm_in_use:
    "A CRM is software that stores your leads and customers (e.g. HubSpot, Pipedrive — even a spreadsheet counts). Not sure? No problem.",

  // Google — access
  google_ads_customer_id:
    "Your Google Ads Customer ID is the 10-digit number at the top of your Google Ads account (e.g. 123-456-7890). Don't have an account yet? Choose “Not sure”.",
  google_ads_access_email:
    "The email address we should request manager access for. If you're unsure, choose “Not sure” and we'll guide you.",
  analytics_access:
    "Google Analytics measures who visits your website and what they do. Share the email to grant access, or choose “Not sure” and we'll set it up.",
  gtm_access:
    "Google Tag Manager is a tool that installs tracking codes without changing your website's code. Not sure? We'll handle it.",

  // Shared tracking toggles (Meta + Google)
  ga_installed:
    "This asks whether Google Analytics is already set up on your website. If you don't know, choose “Not sure”.",
  gtm_installed:
    "This asks whether Google Tag Manager is already installed. Unsure? Choose “Not sure” and we'll check.",
  conversion_tracking_installed:
    "Conversion tracking measures valuable actions like form fills, calls or sales. Not sure if it's set up? We'll verify and configure it.",
  call_tracking_installed:
    "Call tracking measures phone calls generated by your ads. If you're not sure, choose “Not sure”.",
  form_tracking_installed:
    "Form tracking measures enquiries submitted through your website forms. Unsure? We'll take care of it.",
};

/** The on-screen options offered when a client books an onboarding session. */
export const ONBOARDING_CALL_PLATFORMS = ["Google Meet"];

export const SERVICE_LIST = Object.values(SERVICES);

export function getService(service: ServiceType): ServiceDefinition {
  return SERVICES[service];
}
