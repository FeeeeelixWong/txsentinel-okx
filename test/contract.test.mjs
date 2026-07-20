import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ganache from "ganache";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  keccak256,
  stringToHex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(
  fs.readFileSync(path.join(root, "public/contracts/TxSentinelPolicyAnchor.json"), "utf8")
);
const localChain = defineChain({
  id: 1337,
  name: "Ganache",
  nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } }
});
const receiptHash = keccak256(stringToHex("receipt:allow:001"));
const actionDigest = keccak256(stringToHex("action:transfer:001"));
const secondPolicyKey = keccak256(stringToHex("txsentinel:asp-6828:treasury"));

async function fixture() {
  const provider = ganache.provider({
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 3 }
  });
  const transport = custom(provider);
  const publicClient = createPublicClient({ chain: localChain, transport });
  const accounts = Object.values(provider.getInitialAccounts()).map(({ secretKey }) => privateKeyToAccount(secretKey));
  const [ownerAccount, delegateAccount, outsiderAccount] = accounts;
  const walletClient = createWalletClient({ account: ownerAccount, chain: localChain, transport });
  const delegateWalletClient = createWalletClient({ account: delegateAccount, chain: localChain, transport });
  const outsiderWalletClient = createWalletClient({ account: outsiderAccount, chain: localChain, transport });
  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode });
  const deployment = await publicClient.waitForTransactionReceipt({ hash });

  return {
    provider,
    publicClient,
    walletClient,
    delegateWalletClient,
    outsiderWalletClient,
    owner: ownerAccount.address,
    delegate: delegateAccount.address,
    outsider: outsiderAccount.address,
    address: deployment.contractAddress
  };
}

async function writeAndWait(context, wallet, functionName, args) {
  const hash = await wallet.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName,
    args
  });
  return context.publicClient.waitForTransactionReceipt({ hash });
}

async function registerDefault(context, wallet = context.walletClient) {
  return writeAndWait(context, wallet, "registerPolicy", [
    artifact.defaults.policyKey,
    artifact.defaults.policyHash,
    artifact.defaults.versionHash
  ]);
}

test("policies are namespaced by owner and cannot be overwritten", async (t) => {
  const context = await fixture();
  t.after(() => context.provider.disconnect());

  await registerDefault(context);
  const policy = await context.publicClient.readContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "policies",
    args: [context.owner, artifact.defaults.policyKey]
  });
  assert.equal(policy[0], artifact.defaults.policyHash);
  assert.equal(policy[2], 1n);
  assert.equal(policy[3], true);

  await assert.rejects(() => context.walletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "registerPolicy",
    args: [artifact.defaults.policyKey, artifact.defaults.policyHash, artifact.defaults.versionHash]
  }));

  await registerDefault(context, context.outsiderWalletClient);
  const outsiderPolicy = await context.publicClient.readContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "policies",
    args: [context.outsider, artifact.defaults.policyKey]
  });
  assert.equal(outsiderPolicy[2], 1n);
});

test("delegation is policy-scoped and unauthorized anchors fail", async (t) => {
  const context = await fixture();
  t.after(() => context.provider.disconnect());
  await registerDefault(context);
  await writeAndWait(context, context.walletClient, "registerPolicy", [
    secondPolicyKey,
    artifact.defaults.policyHash,
    artifact.defaults.versionHash
  ]);

  await assert.rejects(() => context.outsiderWalletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "anchorReceipt",
    args: [receiptHash, context.owner, artifact.defaults.policyKey, actionDigest, 0]
  }));

  await writeAndWait(context, context.walletClient, "setDelegate", [
    artifact.defaults.policyKey,
    context.delegate,
    true
  ]);
  assert.equal(await context.publicClient.readContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "isAuthorized",
    args: [context.owner, artifact.defaults.policyKey, context.delegate]
  }), true);
  assert.equal(await context.publicClient.readContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "isAuthorized",
    args: [context.owner, secondPolicyKey, context.delegate]
  }), false);

  await writeAndWait(context, context.delegateWalletClient, "anchorReceipt", [
    receiptHash,
    context.owner,
    artifact.defaults.policyKey,
    actionDigest,
    0
  ]);
  await assert.rejects(() => context.delegateWalletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "anchorReceipt",
    args: [receiptHash, context.owner, secondPolicyKey, actionDigest, 0]
  }));
});

test("only the policy owner can mutate policy state or manage delegates", async (t) => {
  const context = await fixture();
  t.after(() => context.provider.disconnect());
  await registerDefault(context);

  const nextPolicyHash = keccak256(stringToHex("unauthorized-policy-update"));
  const nextVersionHash = keccak256(stringToHex("unauthorized-version-update"));
  await assert.rejects(() => context.outsiderWalletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "updatePolicy",
    args: [artifact.defaults.policyKey, nextPolicyHash, nextVersionHash]
  }));
  await assert.rejects(() => context.outsiderWalletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "setPolicyActive",
    args: [artifact.defaults.policyKey, false]
  }));
  await assert.rejects(() => context.outsiderWalletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "setDelegate",
    args: [artifact.defaults.policyKey, context.delegate, true]
  }));

  const policy = await context.publicClient.readContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "policies",
    args: [context.owner, artifact.defaults.policyKey]
  });
  assert.equal(policy[0], artifact.defaults.policyHash);
  assert.equal(policy[2], 1n);
  assert.equal(policy[3], true);
});

test("anchored receipts preserve the exact policy revision after later updates", async (t) => {
  const context = await fixture();
  t.after(() => context.provider.disconnect());
  await registerDefault(context);
  await writeAndWait(context, context.walletClient, "anchorReceipt", [
    receiptHash,
    context.owner,
    artifact.defaults.policyKey,
    actionDigest,
    0
  ]);

  const nextPolicyHash = keccak256(stringToHex("txsentinel-policy-v2-rules"));
  const nextVersionHash = keccak256(stringToHex("txsentinel-policy-v2"));
  await writeAndWait(context, context.walletClient, "updatePolicy", [
    artifact.defaults.policyKey,
    nextPolicyHash,
    nextVersionHash
  ]);

  const receipt = await context.publicClient.readContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "receipts",
    args: [context.owner, artifact.defaults.policyKey, receiptHash]
  });
  assert.equal(receipt[0], actionDigest);
  assert.equal(receipt[1], artifact.defaults.policyHash);
  assert.equal(receipt[2], artifact.defaults.versionHash);
  assert.equal(receipt[3].toLowerCase(), context.owner.toLowerCase());
  assert.equal(receipt[4], 1n);
  assert.equal(receipt[6], 0);

  const currentPolicy = await context.publicClient.readContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "policies",
    args: [context.owner, artifact.defaults.policyKey]
  });
  assert.equal(currentPolicy[0], nextPolicyHash);
  assert.equal(currentPolicy[2], 2n);
});

test("receipt uniqueness is scoped to owner and policy", async (t) => {
  const context = await fixture();
  t.after(() => context.provider.disconnect());
  await registerDefault(context);
  await registerDefault(context, context.outsiderWalletClient);

  await writeAndWait(context, context.walletClient, "anchorReceipt", [
    receiptHash,
    context.owner,
    artifact.defaults.policyKey,
    actionDigest,
    0
  ]);
  await assert.rejects(() => context.walletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "anchorReceipt",
    args: [receiptHash, context.owner, artifact.defaults.policyKey, actionDigest, 0]
  }));

  await writeAndWait(context, context.outsiderWalletClient, "anchorReceipt", [
    receiptHash,
    context.outsider,
    artifact.defaults.policyKey,
    actionDigest,
    0
  ]);
});

test("inactive policies fail closed", async (t) => {
  const context = await fixture();
  t.after(() => context.provider.disconnect());
  await registerDefault(context);
  await writeAndWait(context, context.walletClient, "setPolicyActive", [artifact.defaults.policyKey, false]);

  assert.equal(await context.publicClient.readContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "isAuthorized",
    args: [context.owner, artifact.defaults.policyKey, context.owner]
  }), false);

  await assert.rejects(() => context.walletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "anchorReceipt",
    args: [receiptHash, context.owner, artifact.defaults.policyKey, actionDigest, 2]
  }));
});

test("zero identifiers, self-delegation, revoked delegates, and invalid decisions are rejected", async (t) => {
  const context = await fixture();
  t.after(() => context.provider.disconnect());
  const zero = `0x${"0".repeat(64)}`;

  await assert.rejects(() => context.walletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "registerPolicy",
    args: [zero, artifact.defaults.policyHash, artifact.defaults.versionHash]
  }));
  await registerDefault(context);
  await assert.rejects(() => context.walletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "setDelegate",
    args: [artifact.defaults.policyKey, context.owner, true]
  }));

  await writeAndWait(context, context.walletClient, "setDelegate", [
    artifact.defaults.policyKey,
    context.delegate,
    true
  ]);
  await writeAndWait(context, context.walletClient, "setDelegate", [
    artifact.defaults.policyKey,
    context.delegate,
    false
  ]);
  await assert.rejects(() => context.delegateWalletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "anchorReceipt",
    args: [receiptHash, context.owner, artifact.defaults.policyKey, actionDigest, 0]
  }));
  await assert.rejects(() => context.walletClient.writeContract({
    address: context.address,
    abi: artifact.abi,
    functionName: "anchorReceipt",
    args: [receiptHash, context.owner, artifact.defaults.policyKey, actionDigest, 3]
  }));
});
