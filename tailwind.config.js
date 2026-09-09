import { fontFamily } from "tailwindcss/defaultTheme";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./approve.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "12px" },
    extend: {
      screens: { xs: "360px" },
      colors: {
        bg: {
          0: "#010000",
          1: "#171413",
          2: "#241e1b",
          3: "#483c35",
        },
        fg: {
          0: "#ebeae9",
          1: "#c4c0bd",
          2: "#959190",
          3: "#6b6764",
        },
        brand: {
          a: "#ff7b16",
          b: "#d1671f",
          c: "#ed690b",
          deep: "#773506",
          purple: "#6b4a7a",
        },
        ui: {
          border: "rgba(235, 234, 233, 0.12)",
          focus: "#ff7b16",
          success: "#7DAB7A",
          danger: "#E07070",
          warning: "#d1671f",
          info: "#959190",
        },
      },
      borderRadius: {
        squircle: "32%",
        xl: "20px",
        lg: "16px",
        md: "12px",
        sm: "10px",
      },
      boxShadow: {
        card: "0 0 0 1px rgba(235,234,233,0.08), 0 12px 40px rgba(0,0,0,0.45)",
        press: "0 0 24px rgba(255,123,22,0.28)",
        focus: "0 0 0 3px rgba(255,123,22,0.35)",
        glow: "0 0 32px rgba(255,123,22,0.35)",
      },
      fontFamily: {
        sans: ["Sora", ...fontFamily.sans],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      spacing: {
        px2: "2px",
        px3: "3px",
      },
      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "280ms",
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        scaleIn: { from: { opacity: 0, transform: "scale(.96)" }, to: { opacity: 1, transform: "scale(1)" } },
        slideUp: { from: { transform: "translateY(12px)", opacity: 0 }, to: { transform: "translateY(0)", opacity: 1 } },
        sheetIn: { from: { transform: "translateY(16px)", opacity: 0 }, to: { transform: "translateY(0)", opacity: 1 } },
      },
      animation: {
        fadeIn: "fadeIn 180ms ease-out",
        scaleIn: "scaleIn 180ms ease-out",
        slideUp: "slideUp 180ms ease-out",
        sheetIn: "sheetIn 220ms ease-out",
      },
    },
  },
  plugins: [],
};
