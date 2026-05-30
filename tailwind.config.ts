import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Bbettr Agency brand palette — built around the primary #38B6FF
        brand: {
          50: "#eef9ff",
          100: "#d9f1ff",
          200: "#bce7ff",
          300: "#8edaff",
          400: "#59c4ff",
          500: "#38b6ff", // Primary brand colour
          600: "#1f97f5",
          700: "#177ee1",
          800: "#1a66b6",
          900: "#1b568f",
          950: "#153657",
        },
        ink: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d4d9e2",
          300: "#aeb7c8",
          400: "#8290a9",
          500: "#63718d",
          600: "#4e5a74",
          700: "#40495e",
          800: "#373e50",
          900: "#0f1729", // Deep ink for premium dark surfaces
          950: "#080d1a",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15, 23, 41, 0.04), 0 4px 16px -4px rgba(15, 23, 41, 0.08)",
        "card-hover":
          "0 2px 4px 0 rgba(15, 23, 41, 0.05), 0 12px 32px -8px rgba(15, 23, 41, 0.14)",
        brand: "0 8px 24px -6px rgba(56, 182, 255, 0.45)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
