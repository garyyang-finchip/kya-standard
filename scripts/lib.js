// Shared helpers for the Sepolia scripts (plain ethers v6, no framework).
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const artifacts = require(path.join(ROOT, "build/artifacts.json"));

const NETWORKS = {
  sepolia: {
    chainId: 11155111n,
    // Official ERC-8004 deployments (erc-8004/erc-8004-contracts README). The canonical Validation
    // Registry is not yet deployed; the companion deploys a spec-conforming one bound to this identity registry.
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    explorer: "https://sepolia.etherscan.io",
    defaultRpc: "https://ethereum-sepolia-rpc.publicnode.com",
  },
};

function env(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

function getSigner(networkName = "sepolia") {
  const net = NETWORKS[networkName];
  const provider = new ethers.JsonRpcProvider(env("RPC_URL", net.defaultRpc), Number(net.chainId));
  const wallet = new ethers.Wallet(env("PRIVATE_KEY"), provider);
  return { net, provider, wallet };
}

function factory(name, signer) {
  const a = artifacts[name];
  if (!a) throw new Error(`no artifact ${name} — run node tools/compile.js`);
  return new ethers.ContractFactory(a.abi, a.bytecode, signer);
}

function attach(name, address, signer) {
  return new ethers.Contract(address, artifacts[name].abi, signer);
}

function identityRegistry(address, signer) {
  const abi = require("./abis/ERC8004IdentityRegistry.json");
  return new ethers.Contract(address, abi, signer);
}

const deploymentsDir = path.join(ROOT, "deployments");
function loadDeployment(networkName) {
  const p = path.join(deploymentsDir, `${networkName}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}
function saveJson(name, obj) {
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const p = path.join(deploymentsDir, name);
  fs.writeFileSync(p, JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  return p;
}

async function sendAndWait(label, promise, net) {
  const tx = await promise;
  process.stdout.write(`  ${label} … ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`  ✓ block ${rc.blockNumber}, gas ${rc.gasUsed}`);
  return rc;
}

const dataUri = (obj) => "data:application/json;base64," + Buffer.from(JSON.stringify(obj)).toString("base64");

module.exports = { NETWORKS, getSigner, factory, attach, identityRegistry, loadDeployment, saveJson, sendAndWait, dataUri, ethers, ROOT };
