import { fontFamily } from "tailwindcss/defaultTheme";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "12px" },
    extend: {
      screens: { xs: "360px" }, // extension popup target
      colors: {
        bg: {
          0: "#0B0B0C", // canvas
          1: "#111214", // elevated-1
          2: "#17181B", // elevated-2
        },
        fg: {
          0: "#FFFFFF",
          1: "#C9CFD6",
          2: "#788392",
          3: "#4C5663",
        },
        brand: {
          // Solana gradient stops used for accents
          a: "#9945FF",
          b: "#14F195",
          c: "#00C2FF",
        },
        ui: {
          border: "#23262B",
          focus: "#2EE7F2",
          success: "#2BD576",
          danger: "#FF5A5A",
          warning: "#FFCD4D",
          info: "#4DA7FF",
        },
      },
      borderRadius: {
        xl: "16px",
        lg: "12px",
        md: "10px",
        sm: "8px",
      },
      boxShadow: {
        card: "0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.40)",
        press: "0 0 0 1px rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.35)",
        focus: "0 0 0 3px rgba(46,231,242,0.35)",
      },
      fontFamily: {
        sans: ["Inter", ...fontFamily.sans],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      spacing: {
        "px2": "2px",
        "px3": "3px",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        scaleIn: { from: { opacity: 0, transform: "scale(.96)" }, to: { opacity: 1, transform: "scale(1)" } },
        slideUp: { from: { transform: "translateY(8px)", opacity: 0 }, to: { transform: "translateY(0)", opacity: 1 } },
      },
      animation: {
        fadeIn: "fadeIn 200ms ease-out",
        scaleIn: "scaleIn 180ms ease-out",
        slideUp: "slideUp 180ms ease-out",
      },
    },
  },
  plugins: [],
};