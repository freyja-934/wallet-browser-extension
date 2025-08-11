# Solana Wallet Browser Extension - UI Style Guide

> Stack: React + TypeScript + Vite, TailwindCSS, Radix UI, Redux Toolkit
> Scope: Solana only for now. Multi chain later, but do not surface any non Solana UI.

---

## 1) Design Tokens

### 1.1 Tailwind config

```ts
// tailwind.config.ts
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
  plugins: [require("@tailwindcss/forms")],
};
```

### 1.2 Global CSS variables

```css
/* src/styles.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --radius: 12px;
}

html, body, #root {
  height: 100%;
  background: #0B0B0C;
  color: #FFF;
  font-synthesis-weight: none;
}

.radix-themes {
  --cursor-focus-ring: 0 0 0 3px rgba(46,231,242,0.35);
}

/* Gradient helper */
.grad-solana {
  background-image: linear-gradient(135deg, #9945FF 0%, #14F195 50%, #00C2FF 100%);
}
```

---

## 2) Layouts

### 2.1 Extension surfaces

* Popup: 380 x 640. Scrollable content area under a sticky header.
* Expanded tab (full page): 1024 width fluid container with same components.
* All cards use `rounded-xl shadow-card bg-bg-1 border border-ui-border`.

### 2.2 App shell

```tsx
// src/components/shell/AppShell.tsx
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full w-[380px] bg-bg-0 text-fg-0">
      <header className="sticky top-0 z-20 bg-bg-1/80 backdrop-blur border-b border-ui-border">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full grad-solana" />
            <span className="text-sm text-fg-1">Surfer</span>
          </div>
          <div className="flex items-center gap-2">
            {/* network pill and settings icon go here */}
          </div>
        </div>
      </header>
      <main className="p-4 space-y-4">{children}</main>
    </div>
  );
}
```

---

## 3) Core Components

### 3.1 Balance card

```tsx
// src/components/wallet/BalanceCard.tsx
export function BalanceCard() {
  return (
    <section className="rounded-xl bg-bg-1 border border-ui-border shadow-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight">$12,345.67</div>
          <div className="text-sm text-fg-2">$1,234.56 available</div>
        </div>
        <button aria-label="Settings" className="p-2 rounded-md hover:bg-bg-2">
          <svg className="h-5 w-5 text-fg-1" viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor"/></svg>
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button className="h-10 rounded-lg border border-ui-border hover:bg-bg-2 transition duration-base">Receive</button>
        <button className="h-10 rounded-lg border border-ui-border hover:bg-bg-2 transition duration-base">Send</button>
      </div>
    </section>
  );
}
```

### 3.2 Asset list item

```tsx
// src/components/assets/AssetRow.tsx
type Props = { icon: React.ReactNode; name: string; subtitle: string; value: string; badge?: string; delta?: string };
export function AssetRow(p: Props) {
  return (
    <button className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-bg-2 border border-transparent hover:border-ui-border transition duration-fast">
      <div className="h-9 w-9 rounded-full grid place-items-center bg-bg-2">{p.icon}</div>
      <div className="flex-1 text-left">
        <div className="text-[15px]">{p.name}</div>
        <div className="text-xs text-fg-2">{p.subtitle}</div>
      </div>
      <div className="text-right">
        <div className="text-[15px]">{p.value}</div>
        {p.delta && <div className="text-xs text-ui-success">{p.delta}</div>}
      </div>
      {p.badge && (
        <span className="ml-2 text-[11px] px-1.5 py-px2 rounded-md bg-bg-2 text-fg-2 border border-ui-border">{p.badge}</span>
      )}
    </button>
  );
}
```

### 3.3 Primary button

```tsx
export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`h-11 w-full rounded-lg text-[15px] font-medium shadow-press transition duration-base
                  hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus:shadow-focus
                  grad-solana text-black ${props.className ?? ""}`}
    />
  );
}
```

### 3.4 Input primitives

```tsx
export function TextField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-11 rounded-lg bg-bg-2 border border-ui-border px-3 text-[15px] placeholder:text-fg-3
                  focus:outline-none focus:shadow-focus ${props.className ?? ""}`}
    />
  );
}
```

### 3.5 Amount input with token switch

```tsx
// src/components/tx/AmountInput.tsx
export function AmountInput() {
  return (
    <div className="rounded-xl bg-bg-1 border border-ui-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-fg-2">Amount</div>
        <div className="flex gap-1 rounded-md bg-bg-2 p-1">
          <button className="px-2 h-7 rounded-sm bg-bg-1 text-xs">SOL</button>
          <button className="px-2 h-7 rounded-sm hover:bg-bg-1 text-xs text-fg-1">USD</button>
        </div>
      </div>
      <div className="flex items-end gap-2">
        <input inputMode="decimal" placeholder="0.00" className="bg-transparent outline-none text-3xl w-full" />
        <div className="text-fg-2 text-sm">10.12 SOL available</div>
      </div>
      <div className="flex items-center justify-between">
        <button className="text-xs text-fg-1 underline underline-offset-4">Max</button>
        <select className="h-9 rounded-md bg-bg-2 border border-ui-border text-sm px-2">
          <option>Normal fee</option>
          <option>Fast fee</option>
        </select>
      </div>
    </div>
  );
}
```

### 3.6 Address input with memo checkbox

```tsx
// src/components/tx/AddressSection.tsx
export function AddressSection() {
  return (
    <section className="rounded-xl bg-bg-1 border border-ui-border p-4 space-y-3">
      <label className="text-sm text-fg-2">Recipient address</label>
      <TextField placeholder="Enter Solana address" />
      <div className="grid grid-cols-[1rem_1fr] gap-2 text-xs text-fg-2">
        <input id="ack" type="checkbox" className="mt-0.5 h-3.5 w-3.5 rounded border-ui-border bg-bg-2" />
        <label htmlFor="ack">
          I understand that incorrect addresses can result in loss of funds.
        </label>
      </div>
    </section>
  );
}
```

### 3.7 Review card

```tsx
// src/components/tx/ReviewCard.tsx
export function ReviewCard() {
  return (
    <section className="rounded-xl bg-bg-1 border border-ui-border p-4 space-y-3">
      <Row k="Send" v="0.1234 SOL" />
      <Row k="From" v="Main wallet • HJ...9q" />
      <Row k="Fee" v="0.000005 SOL" />
      <Row k="To" v="8vK...q3Z" />
      <p className="text-xs text-fg-3">
        Once processed transactions cannot be canceled or reversed.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button className="h-10 rounded-lg border border-ui-border">Reject</button>
        <PrimaryButton>Confirm & Send</PrimaryButton>
      </div>
    </section>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-[15px]">
      <span className="text-fg-2">{k}</span>
      <span>{v}</span>
    </div>
  );
}
```

---

## 4) Pages and Flows

### 4.1 Home

* Sections: BalanceCard, Quick actions, Asset list.
* Asset list sorted by USD value. Unknown tokens show grey icon and zero price.
* Empty state shows hero illustration block with a single CTA: Receive.

```tsx
// src/pages/Home.tsx
export default function Home() {
  return (
    <AppShell>
      <BalanceCard />
      <section className="rounded-xl bg-bg-1 border border-ui-border p-4">
        <h3 className="text-sm mb-2">Assets</h3>
        <div className="divide-y divide-ui-border/60">
          <AssetRow icon={<div className="h-5 w-5 grad-solana rounded-full" />} name="Solana" subtitle="↑ 12.34%" value="$4,266.43" badge="3" delta="+12.34%" />
          {/* map tokens here */}
        </div>
      </section>
    </AppShell>
  );
}
```

### 4.2 Receive flow

* Step 1: Choose asset. Only SPL tokens and NFTs. Use searchable sheet.
* Step 2: Show address QR and base58 address. Copy and share buttons.
* Warnings: Network is Solana only. Show simple banner if user scans EVM QR.

```tsx
// pseudo structure
<AppShell>
  <SelectAssetSheet />  // Radix Dialog + Command style list
  <ReceiveCard />       // QR, copy, share
</AppShell>
```

### 4.3 Send flow

* Step 1: Select asset.
* Step 2: Recipient address with validation against `@solana/web3.js` `PublicKey`.
* Step 3: AmountInput with SOL or USD toggle.
* Step 4: ReviewCard then Confirm.
* Edge cases: show memo input only for specific program derived needs, default hidden.

### 4.4 Token detail

* Header: token icon and symbol.
* Cards: Available, Staked, Unstaking timers if present via Helius.
* Actions: Receive, Send, Stake external link.
* Sections: balances on different accounts if user uses multiple accounts.

---

## 5) Radix UI mapping

* Dialog for sheets and modals. Use `content` class `rounded-xl bg-bg-1 border border-ui-border shadow-card animate-scaleIn`.
* DropdownMenu for account switcher and network selector.
* Tooltip for helper text. Use `animate-fadeIn`.
* Tabs for asset detail sub sections.
* Progress for unstaking timers.

```tsx
// example Dialog content classNames
<Dialog.Content className="rounded-xl bg-bg-1 border border-ui-border shadow-card p-4 w-[360px] outline-none">
  {/* content */}
</Dialog.Content>
```

---

## 6) Lists, Badges, Pills

* Badges use compact `text-[11px] px-1.5 py-px2 rounded-md bg-bg-2 border border-ui-border text-fg-2`.
* Pills for toggles `rounded-md bg-bg-2 p-1` with selected tab `bg-bg-1`.

---

## 7) Icons and Illustration

* Use simple duotone SVG.
* Token icons are 36 px rounded.
* System icons 20 px.
* Do not use heavy color accents except brand gradient for CTAs and highlights.

---

## 8) Motion

* Hover on rows: background to `bg-bg-2`, border appears.
* Buttons: subtle scale.
* Dialogs: `animate-scaleIn`.
* Tooltips: `animate-slideUp`.
* Keep durations under 200 ms.

---

## 9) Accessibility

* Focus ring: `shadow-focus`.
* Colors meet 4.5:1 on text.
* All icon buttons have `aria-label`.
* Reduce motion respects `prefers-reduced-motion`.

---

## 10) Empty states

* Home zero balance block uses centered illustration, headline 18 px, body 13 px, single `PrimaryButton` labeled Receive.

---

## 11) Data formatting

* Fiat amounts use commas and 2 decimals.
* SOL amounts up to 6 decimals, trimmed right zeros.
* Addresses shortened as `HJ...9q`.
* Use monospaced font for addresses in details.

---

## 12) Toasts

* Position bottom center inside popup.
* Styles `rounded-lg bg-bg-1 border border-ui-border shadow-card px-3 py-2 text-sm`.
* Success uses left bar accent `before:bg-ui-success`.

---

## 13) Error banners

```tsx
export function InlineError({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-ui-border bg-[#1A0F10] p-3">
      <span className="mt-[2px] h-4 w-4 rounded-full bg-ui-danger" />
      <p className="text-sm text-fg-1">{text}</p>
    </div>
  );
}
```

---

## 14) Account switcher

* Radix DropdownMenu with account avatar left and checkmark on active.
* Each account row shows name and shortened address.

---

## 15) Network indicator

* Solana only. A small pill in the header `px-2 h-6 rounded-md bg-bg-2 border border-ui-border text-xs text-fg-2` with text `Solana`.
* Future chains live behind a Dropdown but keep disabled for now.

---

## 16) QR receive card

```tsx
export function ReceiveCard() {
  return (
    <section className="rounded-xl bg-bg-1 border border-ui-border p-4 space-y-3">
      <h3 className="text-sm">Receive SOL</h3>
      <div className="grid place-items-center py-2">
        <div className="h-40 w-40 rounded-lg bg-bg-2" /> {/* inject QR canvas */}
      </div>
      <code className="block text-center text-xs text-fg-2">HJ9S...3KqP8h1</code>
      <div className="grid grid-cols-2 gap-3">
        <button className="h-10 rounded-lg border border-ui-border">Copy</button>
        <PrimaryButton>Share</PrimaryButton>
      </div>
      <p className="text-xs text-fg-3 text-center">Solana network only. Sending other assets to this address can result in loss of funds.</p>
    </section>
  );
}
```

---

## 17) Security nudges

* Checkbox acknowledgment on first send only, persisted per device.
* When pasting an address, auto validate and color the border green or red.

---

## 18) Theming rules

* Background stack

  * Canvas bg-bg-0
  * Cards bg-bg-1
  * Nested surfaces bg-bg-2
* Text hierarchy

  * Title: 28 to 32 px
  * Section header: 13 px uppercase tracking tight optional
  * Body: 13 to 15 px
  * Meta: 11 to 12 px text-fg-3

---

## 19) Example Home assembly

```tsx
// src/app/App.tsx
export default function App() {
  return (
    <AppShell>
      <BalanceCard />
      <section className="rounded-xl bg-bg-1 border border-ui-border p-4">
        <div className="mb-2 text-sm">Assets</div>
        <div className="divide-y divide-ui-border/60">
          {/* map real portfolio */}
          <AssetRow icon={<div className="h-5 w-5 grad-solana rounded-full" />} name="Solana" subtitle="10.12 SOL" value="$1,234.56" badge="3" delta="+2.34%" />
        </div>
      </section>
    </AppShell>
  );
}
```

---

## 20) QA checklist for Cursor

* Popup width 380, header height 56, card radius 16, row height 48 to 56.
* All borders use `border-ui-border`.
* No light theme for now.
* All actions reachable with keyboard.
* Animations under 200 ms, none on layout shift.
* Do not expose other chains in UI.
* Use brand gradient only for primary CTAs and small accents.

This gives Cursor everything needed to implement the exact look and flows shown while staying Solana first.
