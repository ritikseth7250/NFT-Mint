import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import * as StellarSDK from "@stellar/stellar-sdk";

const rpcUrl =
  process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const horizonUrl =
  process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const wasmPath =
  process.env.WASM_PATH ??
  path.resolve(
    "target",
    "wasm32v1-none",
    "release",
    "nft_minter.wasm",
  );

const networkPassphrase = StellarSDK.Networks.TESTNET;
const server = new StellarSDK.rpc.Server(rpcUrl);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function accountExists(address) {
  const response = await fetch(`${horizonUrl}/accounts/${address}`);
  return response.ok;
}

async function ensureTestnetFunds(address) {
  if (await accountExists(address)) {
    return;
  }

  const response = await fetch(
    `${horizonUrl}/friendbot?addr=${encodeURIComponent(address)}`,
  );

  if (!response.ok) {
    throw new Error("Friendbot could not fund the generated testnet account.");
  }
}

function buildContractCall(account, contractId, ownerAddress) {
  const contract = new StellarSDK.Contract(contractId);

  return new StellarSDK.TransactionBuilder(account, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "mint",
        StellarSDK.Address.fromString(ownerAddress).toScVal(),
        StellarSDK.nativeToScVal("Launch NFT"),
        StellarSDK.nativeToScVal("Deployment verification mint from the script."),
        StellarSDK.nativeToScVal("https://placehold.co/1200x800/png"),
      ),
    )
    .setTimeout(30)
    .build();
}

async function waitForTransaction(hash) {
  while (true) {
    const response = await server.getTransaction(hash);
    if (response.status !== "NOT_FOUND") {
      return response;
    }
    await sleep(1200);
  }
}

async function prepareAndSend(account, operation, keypair) {
  const tx = new StellarSDK.TransactionBuilder(account, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const submission = await server.sendTransaction(prepared);

  if (submission.status !== "PENDING") {
    throw new Error(submission.errorResultXdr ?? "Submission failed.");
  }

  const settled = await waitForTransaction(submission.hash);

  if (settled.status !== "SUCCESS") {
    throw new Error(settled.resultXdr ?? "Transaction failed on chain.");
  }

  return {
    hash: submission.hash,
    response: settled,
  };
}

async function uploadWasm(keypair) {
  const wasmBytes = fs.readFileSync(wasmPath);
  const account = await server.getAccount(keypair.publicKey());
  const operation = StellarSDK.Operation.uploadContractWasm({
    wasm: wasmBytes,
  });

  return prepareAndSend(account, operation, keypair);
}

async function deployContract(keypair, wasmHashBytes, saltBytes) {
  const account = await server.getAccount(keypair.publicKey());
  const operation = StellarSDK.Operation.createCustomContract({
    wasmHash: wasmHashBytes,
    address: StellarSDK.Address.fromString(keypair.publicKey()),
    salt: saltBytes,
  });

  const deployed = await prepareAndSend(account, operation, keypair);
  const contractAddress = StellarSDK.StrKey.encodeContract(
    StellarSDK.Address.fromScAddress(
      deployed.response.returnValue.address(),
    ).toBuffer(),
  );

  return {
    contractAddress,
    hash: deployed.hash,
  };
}

async function invokeMint(keypair, contractId) {
  const account = await server.getAccount(keypair.publicKey());
  const tx = buildContractCall(account, contractId, keypair.publicKey());
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const submission = await server.sendTransaction(prepared);

  if (submission.status !== "PENDING") {
    throw new Error(submission.errorResultXdr ?? "Mint invoke failed.");
  }

  const settled = await waitForTransaction(submission.hash);

  if (settled.status !== "SUCCESS") {
    throw new Error(settled.resultXdr ?? "Mint invoke failed on chain.");
  }

  const mintedTokenId = settled.returnValue
    ? Number(StellarSDK.scValToNative(settled.returnValue))
    : null;

  return {
    hash: submission.hash,
    tokenId: mintedTokenId,
  };
}

async function main() {
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      `Compiled contract not found at ${wasmPath}. Build the contract first.`,
    );
  }

  const keypair = process.env.STELLAR_SECRET_KEY
    ? StellarSDK.Keypair.fromSecret(process.env.STELLAR_SECRET_KEY)
    : StellarSDK.Keypair.random();

  await ensureTestnetFunds(keypair.publicKey());

  const upload = await uploadWasm(keypair);
  const wasmHashBytes = upload.response.returnValue.bytes();
  const wasmHash = Buffer.from(wasmHashBytes).toString("hex");
  const deployment = await deployContract(
    keypair,
    wasmHashBytes,
    crypto.randomBytes(32),
  );
  const verificationMint = await invokeMint(keypair, deployment.contractAddress);

  const summary = {
    deployerPublicKey: keypair.publicKey(),
    rpcUrl,
    horizonUrl,
    wasmPath,
    wasmHash,
    contractId: deployment.contractAddress,
    uploadTxHash: upload.hash,
    deployTxHash: deployment.hash,
    verificationMintTxHash: verificationMint.hash,
    verificationMintTokenId: verificationMint.tokenId,
  };

  fs.mkdirSync("deployment", { recursive: true });
  fs.writeFileSync(
    path.resolve("deployment", "testnet.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
