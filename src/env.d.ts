/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTRACT_ID?: string;
  readonly VITE_SIMULATION_ACCOUNT?: string;
  readonly VITE_SOROBAN_RPC_URL?: string;
  readonly VITE_HORIZON_URL?: string;
  readonly VITE_NETWORK_PASSPHRASE?: string;
  readonly VITE_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
