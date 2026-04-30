import { LOW_BALANCE_THRESHOLD } from "../config";
import type { AppError } from "../types";

function getMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function insufficientBalanceError(): AppError {
  return {
    kind: "insufficient_balance",
    title: "Insufficient testnet balance",
    description: `This wallet needs at least ${LOW_BALANCE_THRESHOLD.toFixed(
      1,
    )} XLM on testnet before minting. Fund the account with Friendbot and try again.`,
  };
}

export function classifyError(error: unknown): AppError {
  const message = getMessage(error).trim();
  const lower = message.toLowerCase();

  if (
    lower.includes("not installed") ||
    lower.includes("not available") ||
    lower.includes("wallet not found") ||
    lower.includes("wallet missing") ||
    lower.includes("extension")
  ) {
    return {
      kind: "wallet_not_found",
      title: "Wallet not found",
      description:
        "The selected wallet is not available in this browser yet. Install or unlock one of the supported Stellar wallets and try again.",
    };
  }

  if (
    lower.includes("rejected") ||
    lower.includes("declined") ||
    lower.includes("cancelled") ||
    lower.includes("denied")
  ) {
    return {
      kind: "rejected",
      title: "Wallet request rejected",
      description:
        "The wallet prompt was closed or rejected before signing completed.",
    };
  }

  if (
    lower.includes("insufficient") ||
    lower.includes("op_underfunded") ||
    lower.includes("underfunded") ||
    lower.includes("balance")
  ) {
    return insufficientBalanceError();
  }

  if (lower.includes("simulate") || lower.includes("contract")) {
    return {
      kind: "contract_read",
      title: "Contract sync failed",
      description:
        message || "The app could not read the latest contract state from testnet.",
    };
  }

  return {
    kind: "unknown",
    title: "Something went wrong",
    description: message || "The request failed for an unknown reason.",
  };
}
