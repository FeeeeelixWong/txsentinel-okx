import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { keccak256, stringToHex } from "viem";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceName = "contracts/TxSentinelPolicyAnchor.sol";
const source = fs.readFileSync(path.join(root, sourceName), "utf8");

const input = {
  language: "Solidity",
  sources: { [sourceName]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    metadata: { appendCBOR: false, bytecodeHash: "none" },
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "evm.bytecode.object",
          "evm.deployedBytecode.object",
          "evm.deployedBytecode.opcodes",
          "evm.methodIdentifiers"
        ]
      }
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((entry) => entry.severity === "error");
if (errors.length > 0) {
  throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
}

const contractName = "TxSentinelPolicyAnchor";
const compiled = output.contracts[sourceName][contractName];
const runtimeOpcodes = new Set(compiled.evm.deployedBytecode.opcodes.split(" "));
const forbiddenOpcodes = ["CALL", "CALLCODE", "DELEGATECALL", "STATICCALL", "SELFDESTRUCT", "CREATE", "CREATE2"];
const detectedForbiddenOpcodes = forbiddenOpcodes.filter((opcode) => runtimeOpcodes.has(opcode));
if (detectedForbiddenOpcodes.length > 0) {
  throw new Error(`Receipt anchor runtime contains forbidden opcodes: ${detectedForbiddenOpcodes.join(", ")}`);
}
const defaultPolicy = {
  maxSpendUsd: 100,
  allowlistedRecipients: [],
  denyUnlimitedApprovals: true,
  requireSimulation: true,
  requireVerifiedContract: false,
  maxSlippageBps: 100,
  maxFeeUsd: 5
};
const canonicalPolicy = JSON.stringify(defaultPolicy);
const artifact = {
  contractName,
  sourceName,
  compilerVersion: solc.version(),
  evmVersion: "paris",
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
  methodIdentifiers: compiled.evm.methodIdentifiers,
  security: {
    forbiddenRuntimeOpcodes: forbiddenOpcodes,
    detectedForbiddenRuntimeOpcodes: detectedForbiddenOpcodes
  },
  network: {
    name: "X Layer Testnet",
    chainId: 1952,
    chainIdHex: "0x7a0",
    rpcUrls: ["https://testrpc.xlayer.tech/terigon", "https://xlayertestrpc.okx.com/terigon"],
    blockExplorerUrl: "https://www.okx.com/web3/explorer/xlayer-test"
  },
  defaults: {
    policyKey: keccak256(stringToHex("txsentinel:asp-6828:default")),
    policyHash: keccak256(stringToHex(canonicalPolicy)),
    policyHashAlgorithm: "keccak256(utf8(canonicalPolicyJson))",
    versionHash: keccak256(stringToHex("txsentinel-policy-v1")),
    policy: defaultPolicy,
    canonicalPolicy
  }
};

const artifactDirectory = path.join(root, "public", "contracts");
fs.mkdirSync(artifactDirectory, { recursive: true });
fs.writeFileSync(
  path.join(artifactDirectory, `${contractName}.json`),
  `${JSON.stringify(artifact, null, 2)}\n`
);

console.log(`Compiled ${contractName} with ${artifact.compilerVersion}`);
