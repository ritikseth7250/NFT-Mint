import { FormEvent, useEffect, useRef, useState } from "react";
import {
  CONTRACT_ID,
  LOW_BALANCE_THRESHOLD,
  SIMULATION_ACCOUNT,
  SUPPORTED_WALLETS,
} from "./config";
import { classifyError, insufficientBalanceError } from "./lib/errors";
import {
  formatBalance,
  formatLedgerTime,
  formatTime,
  shortenAddress,
} from "./lib/format";
import {
  fetchNativeBalance,
  getContractExplorerUrl,
  getContractSnapshot,
  getMintEvents,
  getTransactionExplorerUrl,
  mintNft,
} from "./lib/stellar";
import { connectWallet, disconnectWallet, getSupportedWallets } from "./lib/wallet";
import type {
  AppError,
  ContractSnapshot,
  MintFormState,
  MintedToken,
  TxStatus,
  WalletSession,
} from "./types";

const INITIAL_FORM: MintFormState = {
  name: "",
  description: "",
  image: "",
};

const INITIAL_TX_STATUS: TxStatus = {
  state: "idle",
  hash: null,
  tokenId: null,
  error: null,
  startedAt: null,
  finishedAt: null,
};

const EMPTY_SNAPSHOT: ContractSnapshot = {
  totalMinted: 0,
  tokens: [],
  lastLedger: null,
  lastSyncedAt: null,
};

function mergeTokens(current: MintedToken[], incoming: MintedToken[]): MintedToken[] {
  const byId = new Map<number, MintedToken>();

  for (const token of current) {
    byId.set(token.tokenId, token);
  }

  for (const token of incoming) {
    byId.set(token.tokenId, {
      ...byId.get(token.tokenId),
      ...token,
    });
  }

  return [...byId.values()]
    .filter((token) => token.tokenId > 0)
    .sort((left, right) => right.tokenId - left.tokenId)
    .slice(0, 12);
}

function statusTone(state: TxStatus["state"]): string {
  switch (state) {
    case "pending":
      return "is-pending";
    case "success":
      return "is-success";
    case "failed":
      return "is-failed";
    default:
      return "is-idle";
  }
}

function App() {
  const [wallet, setWallet] = useState<WalletSession | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [form, setForm] = useState<MintFormState>(INITIAL_FORM);
  const [snapshot, setSnapshot] = useState<ContractSnapshot>(EMPTY_SNAPSHOT);
  const [txStatus, setTxStatus] = useState<TxStatus>(INITIAL_TX_STATUS);
  const [appError, setAppError] = useState<AppError | null>(null);
  const [walletOptions, setWalletOptions] = useState<string[]>(SUPPORTED_WALLETS);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const lastSeenLedgerRef = useRef<number | null>(null);

  const hasContract = CONTRACT_ID.length > 0;
  const readSource = wallet?.address ?? (SIMULATION_ACCOUNT || undefined);
  const contractLink = hasContract ? getContractExplorerUrl(CONTRACT_ID) : null;

  async function refreshBalance(address: string): Promise<number> {
    const nextBalance = await fetchNativeBalance(address);
    setBalance(nextBalance);
    return nextBalance;
  }

  async function syncSnapshot(sourceAddress?: string): Promise<void> {
    if (!hasContract) {
      return;
    }

    const source = sourceAddress ?? readSource;

    if (!source) {
      return;
    }

    setIsSyncing(true);

    try {
      const nextSnapshot = await getContractSnapshot(source);
      lastSeenLedgerRef.current = nextSnapshot.lastLedger;
      setSnapshot(nextSnapshot);
    } catch (error) {
      setAppError(classifyError(error));
    } finally {
      setIsSyncing(false);
    }
  }

  useEffect(() => {
    let active = true;

    void getSupportedWallets()
      .then((wallets) => {
        if (!active) {
          return;
        }

        setWalletOptions(wallets.map((wallet) => wallet.name));
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hasContract) {
      return;
    }

    void syncSnapshot(readSource);
  }, [hasContract]);

  useEffect(() => {
    if (!hasContract) {
      return;
    }

    let active = true;

    const poll = async () => {
      try {
        const live = await getMintEvents(
          lastSeenLedgerRef.current ? lastSeenLedgerRef.current + 1 : undefined,
        );

        if (!active) {
          return;
        }

        lastSeenLedgerRef.current = live.lastEventLedger;

        if (live.tokens.length > 0) {
          setSnapshot((current) => ({
            totalMinted: Math.max(
              current.totalMinted,
              ...live.tokens.map((token) => token.tokenId),
            ),
            tokens: mergeTokens(current.tokens, live.tokens),
            lastLedger: live.latestLedger,
            lastSyncedAt: new Date().toISOString(),
          }));
        } else {
          setSnapshot((current) => ({
            ...current,
            lastLedger: live.latestLedger,
          }));
        }
      } catch (error) {
        console.error(error);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 6000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [hasContract]);

  async function handleConnect(): Promise<void> {
    setIsConnecting(true);
    setAppError(null);

    try {
      const session = await connectWallet();
      setWallet(session);
      await refreshBalance(session.address);
      await syncSnapshot(session.address);
    } catch (error) {
      setAppError(classifyError(error));
    } finally {
      setIsConnecting(false);
    }
  }

  function handleDisconnect(): void {
    void disconnectWallet().catch((error) => {
      console.error(error);
    });
    setWallet(null);
    setBalance(null);
    setTxStatus(INITIAL_TX_STATUS);
  }

  async function handleMint(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAppError(null);

    if (!wallet) {
      setAppError({
        kind: "wallet_not_found",
        title: "Connect a wallet first",
        description:
          "A connected Stellar wallet is required before the frontend can submit the mint transaction.",
      });
      return;
    }

    if (!hasContract) {
      setAppError({
        kind: "contract_read",
        title: "Contract address missing",
        description:
          "Set VITE_CONTRACT_ID before trying to mint from the frontend.",
      });
      return;
    }

    setIsMinting(true);
    setTxStatus({
      state: "pending",
      hash: null,
      tokenId: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    try {
      const latestBalance = await refreshBalance(wallet.address);

      if (latestBalance < LOW_BALANCE_THRESHOLD) {
        throw insufficientBalanceError().description;
      }

      const result = await mintNft({
        address: wallet.address,
        name: form.name,
        description: form.description,
        image: form.image,
        onSubmitted: (hash) => {
          setTxStatus((current) => ({
            ...current,
            hash,
          }));
        },
      });

      setTxStatus({
        state: "success",
        hash: result.hash,
        tokenId: result.tokenId,
        error: null,
        startedAt: txStatus.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      setForm(INITIAL_FORM);
      await refreshBalance(wallet.address);
      await syncSnapshot(wallet.address);
    } catch (error) {
      const parsed = classifyError(error);
      setAppError(parsed);
      setTxStatus((current) => ({
        ...current,
        state: "failed",
        error: parsed.description,
        finishedAt: new Date().toISOString(),
      }));
    } finally {
      setIsMinting(false);
    }
  }

  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Stellar Level 2 Delivery</span>
          <h1>NFT Minter with live Soroban contract sync</h1>
          <p>
            Multi-wallet minting, frontend contract calls, real-time event
            updates, and visible transaction status on Stellar testnet.
          </p>
          <div className="hero-meta">
            <span className="meta-pill">3 error types handled</span>
            <span className="meta-pill">Contract write from frontend</span>
            <span className="meta-pill">Polling + event sync</span>
          </div>
        </div>
        <div className="hero-aside">
          <div className="panel panel-highlight">
            <p className="panel-label">Contract</p>
            {contractLink ? (
              <a href={contractLink} target="_blank" rel="noreferrer">
                {shortenAddress(CONTRACT_ID, 9)}
              </a>
            ) : (
              <span>Waiting for deployment</span>
            )}
            <p className="panel-footnote">
              {readSource
                ? "Read calls can simulate immediately from the frontend."
                : "Add a simulation account or connect a wallet to read state."}
            </p>
          </div>
        </div>
      </header>

      {appError ? (
        <section className={`alert alert-${appError.kind}`}>
          <strong>{appError.title}</strong>
          <p>{appError.description}</p>
        </section>
      ) : null}

      <main className="content-grid">
        <section className="stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Wallet access</p>
                <h2>Choose your signer</h2>
              </div>
              <span className="signal">{wallet ? "Connected" : "Idle"}</span>
            </div>
            <p className="muted">
              Powered by StellarWalletsKit with multiple Stellar wallet options.
            </p>
            <div className="wallet-tags">
              {walletOptions.map((label) => (
                <span key={label} className="wallet-tag">
                  {label}
                </span>
              ))}
            </div>
            {wallet ? (
              <div className="wallet-card">
                <div>
                  <p className="wallet-name">{wallet.walletName}</p>
                  <p className="wallet-address">{wallet.address}</p>
                </div>
                <div className="wallet-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void refreshBalance(wallet.address)}
                  >
                    Refresh balance
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={handleDisconnect}
                  >
                    Clear session
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleConnect()}
                disabled={isConnecting}
              >
                {isConnecting ? "Opening wallet modal..." : "Connect wallet"}
              </button>
            )}
            <div className="stats-row">
              <div className="stat">
                <span>Balance</span>
                <strong>{formatBalance(balance)}</strong>
              </div>
              <div className="stat">
                <span>Error handling</span>
                <strong>not found / rejected / low balance</strong>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Mint flow</p>
                <h2>Write to the contract</h2>
              </div>
              <span className="signal">
                {isMinting ? "Submitting" : "Ready"}
              </span>
            </div>
            <form className="mint-form" onSubmit={(event) => void handleMint(event)}>
              <label>
                NFT name
                <input
                  required
                  maxLength={48}
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Cosmic Ticket #1"
                />
              </label>
              <label>
                Description
                <textarea
                  required
                  maxLength={160}
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="A tiny testnet collectible with on-chain metadata."
                />
              </label>
              <label>
                Image URL
                <input
                  required
                  maxLength={160}
                  value={form.image}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      image: event.target.value,
                    }))
                  }
                  placeholder="https://images.example/nft.png"
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={isMinting || !wallet || !hasContract}
              >
                {isMinting ? "Minting on testnet..." : "Mint NFT"}
              </button>
            </form>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Transaction status</p>
                <h2>Pending, success, or failure</h2>
              </div>
              <span className={`signal ${statusTone(txStatus.state)}`}>
                {txStatus.state}
              </span>
            </div>
            <div className="timeline">
              <div className="timeline-item">
                <span>Started</span>
                <strong>{formatTime(txStatus.startedAt)}</strong>
              </div>
              <div className="timeline-item">
                <span>Finished</span>
                <strong>{formatTime(txStatus.finishedAt)}</strong>
              </div>
              <div className="timeline-item">
                <span>Token id</span>
                <strong>{txStatus.tokenId ?? "Waiting"}</strong>
              </div>
            </div>
            <div className="hash-box">
              <span>Hash</span>
              {txStatus.hash ? (
                <a
                  href={getTransactionExplorerUrl(txStatus.hash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortenAddress(txStatus.hash, 10)}
                </a>
              ) : (
                <strong>Appears here after submission</strong>
              )}
            </div>
            {txStatus.error ? <p className="error-copy">{txStatus.error}</p> : null}
          </article>
        </section>

        <section className="stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Frontend reads</p>
                <h2>Live contract snapshot</h2>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void syncSnapshot()}
                disabled={isSyncing || !readSource || !hasContract}
              >
                {isSyncing ? "Syncing..." : "Refresh state"}
              </button>
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <span>Total minted</span>
                <strong>{snapshot.totalMinted}</strong>
                <small>via `get_total_minted()`</small>
              </div>
              <div className="stat-card">
                <span>Last ledger</span>
                <strong>{snapshot.lastLedger ?? "Unknown"}</strong>
                <small>event stream checkpoint</small>
              </div>
              <div className="stat-card">
                <span>Last sync</span>
                <strong>{formatTime(snapshot.lastSyncedAt)}</strong>
                <small>RPC simulation + event polling</small>
              </div>
            </div>
            <p className="muted">
              The gallery below is refreshed from the contract and topped up by
              `getEvents()` polling so the UI tracks live writes.
            </p>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Real-time gallery</p>
                <h2>Recent mints</h2>
              </div>
              <span className="signal">
                {snapshot.tokens.length} visible
              </span>
            </div>
            {snapshot.tokens.length > 0 ? (
              <div className="gallery">
                {snapshot.tokens.map((token) => (
                  <article key={token.tokenId} className="token-card">
                    <div
                      className="token-image"
                      style={{
                        backgroundImage: `linear-gradient(135deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55)), url(${token.image})`,
                      }}
                    />
                    <div className="token-copy">
                      <div className="token-topline">
                        <span>#{token.tokenId}</span>
                        <span>{shortenAddress(token.owner)}</span>
                      </div>
                      <h3>{token.name}</h3>
                      <p>{token.description}</p>
                      <div className="token-meta">
                        <span>{formatLedgerTime(token.mintedAt)}</span>
                        {token.txHash ? (
                          <a
                            href={getTransactionExplorerUrl(token.txHash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View tx
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No mints yet</strong>
                <p>
                  Deploy the contract, connect a wallet, and mint the first testnet NFT.
                </p>
              </div>
            )}
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Submission targets</p>
                <h2>Level 2 checklist view</h2>
              </div>
            </div>
            <ul className="checklist">
              <li>Multiple wallets shown and connected through StellarWalletsKit.</li>
              <li>Contract writes are signed from the frontend and tracked on testnet.</li>
              <li>Contract reads are simulated from the frontend for live sync.</li>
              <li>Transaction state is visible from submit through final status.</li>
              <li>Event polling updates the UI after on-chain changes land.</li>
            </ul>
            <p className="muted">
              Minimum balance guidance for testnet minting:{" "}
              {LOW_BALANCE_THRESHOLD.toFixed(1)} XLM.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}

export default App;
