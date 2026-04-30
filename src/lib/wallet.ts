import { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit-tech/stellar-wallets-kit/modules/utils";
import { Networks, type ISupportedWallet } from "@creit-tech/stellar-wallets-kit/types";
import { NETWORK_PASSPHRASE } from "../config";
import type { WalletSession } from "../types";

StellarWalletsKit.init({
  network: Networks.TESTNET,
  modules: defaultModules(),
  authModal: {
    showInstallLabel: true,
    hideUnsupportedWallets: false,
  },
});

function walletLabel(wallet: ISupportedWallet): string {
  return wallet.name || wallet.id;
}

export async function getSupportedWallets(): Promise<ISupportedWallet[]> {
  return StellarWalletsKit.refreshSupportedWallets();
}

export async function connectWallet(): Promise<WalletSession> {
  const { address } = await StellarWalletsKit.authModal();
  const module = StellarWalletsKit.selectedModule;

  return {
    address,
    walletId: module.productId,
    walletName: module.productName,
  };
}

export async function signWithWallet(
  xdr: string,
  address: string,
): Promise<string> {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  return signedTxXdr;
}

export async function disconnectWallet(): Promise<void> {
  await StellarWalletsKit.disconnect();
}
