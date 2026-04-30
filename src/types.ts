export type TxState = "idle" | "pending" | "success" | "failed";

export type ErrorKind =
  | "wallet_not_found"
  | "rejected"
  | "insufficient_balance"
  | "contract_read"
  | "unknown";

export interface AppError {
  kind: ErrorKind;
  title: string;
  description: string;
}

export interface WalletSession {
  address: string;
  walletId: string;
  walletName: string;
}

export interface MintFormState {
  name: string;
  description: string;
  image: string;
}

export interface MintedToken {
  tokenId: number;
  owner: string;
  name: string;
  description: string;
  image: string;
  mintedAt: number;
  txHash?: string | null;
}

export interface ContractSnapshot {
  totalMinted: number;
  tokens: MintedToken[];
  lastLedger: number | null;
  lastSyncedAt: string | null;
}

export interface TxStatus {
  state: TxState;
  hash: string | null;
  tokenId: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
