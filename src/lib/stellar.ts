import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  CONTRACT_ID,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  RPC_URL,
  SIMULATION_ACCOUNT,
} from "../config";
import type { ContractSnapshot, MintedToken } from "../types";
import { signWithWallet } from "./wallet";

const server = new rpc.Server(RPC_URL);

function contract(): Contract {
  if (!CONTRACT_ID) {
    throw new Error("VITE_CONTRACT_ID is not configured.");
  }

  return new Contract(CONTRACT_ID);
}

function xdrErrorMessage(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === "object" &&
    "toXDR" in value &&
    typeof (value as { toXDR: (mode: string) => string }).toXDR === "function"
  ) {
    return (value as { toXDR: (mode: string) => string }).toXDR("base64");
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return fallback;
}

function u32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

function stringVal(value: string): xdr.ScVal {
  return nativeToScVal(value);
}

function toToken(raw: unknown): MintedToken {
  const item = raw as Record<string, unknown>;

  return {
    tokenId: Number(item.token_id ?? item.tokenId ?? 0),
    owner: String(item.owner ?? ""),
    name: String(item.name ?? ""),
    description: String(item.description ?? ""),
    image: String(item.image ?? ""),
    mintedAt: Number(item.minted_at ?? item.mintedAt ?? 0),
  };
}

async function buildContractTransaction(
  sourceAddress: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<Transaction> {
  const account = await server.getAccount(sourceAddress);

  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE || Networks.TESTNET,
  })
    .addOperation(contract().call(method, ...args))
    .setTimeout(30)
    .build();
}

export async function fetchNativeBalance(address: string): Promise<number> {
  const response = await fetch(`${HORIZON_URL}/accounts/${address}`);

  if (!response.ok) {
    throw new Error("Could not load the account balance from Horizon.");
  }

  const payload = (await response.json()) as {
    balances?: Array<{ asset_type?: string; balance?: string }>;
  };

  const nativeAsset = payload.balances?.find(
    (entry) => entry.asset_type === "native",
  );

  return Number(nativeAsset?.balance ?? 0);
}

export async function readContract<T>(
  method: string,
  args: xdr.ScVal[] = [],
  sourceAddress?: string,
): Promise<T> {
  const readSource = sourceAddress ?? SIMULATION_ACCOUNT;

  if (!readSource) {
    throw new Error(
      "A simulation account or a connected wallet is required for contract reads.",
    );
  }

  const tx = await buildContractTransaction(readSource, method, args);
  const simulation = await server.simulateTransaction(tx);

  if ("error" in simulation && simulation.error) {
    throw new Error(simulation.error);
  }

  if (!("result" in simulation) || !simulation.result?.retval) {
    throw new Error(`No value returned for ${method}.`);
  }

  return scValToNative(simulation.result.retval) as T;
}

export async function getContractSnapshot(
  sourceAddress?: string,
): Promise<ContractSnapshot> {
  const totalMinted = Number(
    await readContract<number>("get_total_minted", [], sourceAddress),
  );

  const recentTokens =
    totalMinted > 0
      ? await readContract<unknown[]>(
          "get_recent_tokens",
          [u32(Math.min(totalMinted, 12))],
          sourceAddress,
        )
      : [];

  const latestLedger = await server.getLatestLedger();

  return {
    totalMinted,
    tokens: recentTokens.map(toToken),
    lastLedger: latestLedger.sequence,
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function getMintEvents(startLedger?: number): Promise<{
  tokens: MintedToken[];
  latestLedger: number;
  lastEventLedger: number;
}> {
  const latestLedger = await server.getLatestLedger();
  const fromLedger = Math.max(1, startLedger ?? latestLedger.sequence - 2000);
  const topic1 = xdr.ScVal.scvSymbol("NFT").toXDR("base64");
  const topic2 = xdr.ScVal.scvSymbol("minted").toXDR("base64");
  const response = await server.getEvents({
    startLedger: fromLedger,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
        topics: [[topic1, topic2]],
      },
    ],
    limit: 30,
  });

  const tokens = response.events
    .map((event) => {
      const token = toToken(scValToNative(event.value));
      token.txHash = (event as { txHash?: string }).txHash ?? null;
      return token;
    })
    .filter((token) => token.tokenId > 0);

  const lastEventLedger = response.events.reduce<number>(
    (max, event) =>
      Math.max(max, Number((event as { ledger?: number }).ledger ?? max)),
    fromLedger,
  );

  return {
    tokens,
    latestLedger: latestLedger.sequence,
    lastEventLedger,
  };
}

export async function mintNft(params: {
  address: string;
  name: string;
  description: string;
  image: string;
  onSubmitted?: (hash: string) => void;
}): Promise<{ hash: string; tokenId: number | null }> {
  const tx = await buildContractTransaction(params.address, "mint", [
    new Address(params.address).toScVal(),
    stringVal(params.name),
    stringVal(params.description),
    stringVal(params.image),
  ]);

  const prepared = await server.prepareTransaction(tx);
  const signedTxXdr = await signWithWallet(
    prepared.toEnvelope().toXDR("base64"),
    params.address,
  );
  const signedTx = TransactionBuilder.fromXDR(
    signedTxXdr,
    NETWORK_PASSPHRASE,
  ) as Transaction;
  const submission = await server.sendTransaction(signedTx);

  if (submission.status !== "PENDING") {
    throw new Error(
      xdrErrorMessage(
        submission.errorResult,
        "The transaction was not accepted by the Soroban RPC server.",
      ),
    );
  }

  params.onSubmitted?.(submission.hash);

  let txResponse = await server.getTransaction(submission.hash);

  while (txResponse.status === "NOT_FOUND") {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    txResponse = await server.getTransaction(submission.hash);
  }

  if (txResponse.status !== "SUCCESS") {
    throw new Error(xdrErrorMessage(txResponse.resultXdr, "Mint transaction failed."));
  }

  const tokenId =
    "returnValue" in txResponse && txResponse.returnValue
      ? Number(scValToNative(txResponse.returnValue))
      : null;

  return {
    hash: submission.hash,
    tokenId,
  };
}

export function getTransactionExplorerUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function getContractExplorerUrl(id: string): string {
  return `https://stellar.expert/explorer/testnet/contract/${id}`;
}
