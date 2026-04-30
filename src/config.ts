import { Networks } from "@stellar/stellar-sdk";

export const RPC_URL =
  import.meta.env.VITE_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const HORIZON_URL =
  import.meta.env.VITE_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE ?? Networks.TESTNET;

export const CONTRACT_ID = (
  import.meta.env.VITE_CONTRACT_ID ??
  "CDATIU6HBFB4JRQY2ELI62UPOT33C6O4VHHCJSOUT5TKGR7VJIMHNLHS"
).trim();

export const SIMULATION_ACCOUNT = (
  import.meta.env.VITE_SIMULATION_ACCOUNT ??
  "GCDNETPXBMI5FJONOLGZOKKDIUNHEEBZPPRJB5PFLOOU5FE2HZTO7NNM"
).trim();

export const APP_URL =
  import.meta.env.VITE_APP_URL ?? "http://localhost:5173";

export const LOW_BALANCE_THRESHOLD = 0.5;

export const SUPPORTED_WALLETS = [
  "Freighter",
  "xBull",
  "Albedo",
  "Hana",
  "Rabet",
  "Lobstr",
  "HOT Wallet",
  "Klever",
];
