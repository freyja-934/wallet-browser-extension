/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HELIUS_API_KEY?: string;
  readonly VITE_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  Buffer: typeof Buffer;
  global: Window;
}
