export function shortenAddress(value: string, edge = 6): string {
  if (value.length <= edge * 2) {
    return value;
  }

  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
}

export function formatBalance(balance: number | null): string {
  if (balance === null || Number.isNaN(balance)) {
    return "Unknown";
  }

  return `${balance.toFixed(2)} XLM`;
}

export function formatTime(value: string | null): string {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatLedgerTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}
