// Build an offline deployment plan (contract-creation calldata + predicted CREATE addresses).
// Usage: node scripts/offline/plan-deploy.js <startNonce> > deployments/offline/plan-r2.json
const path = require("path");
const { ethers } = require("ethers");
const artifacts = require("../../build/artifacts.json");
const { NETWORKS } = require("../lib");
const { ZK } = require("../../companions/zk-kya-groth16/prover");

const DEMO_ATTESTOR_SEEDS = ["kya-demo-issuer-alice", "kya-demo-issuer-bob", "kya-demo-issuer-carol"];
const EPOCH_SECONDS = 2592000, EPOCH_GRACE = 1;
const deployer = "0x65ab82feC38c3A5F2A5b0bd96cB3255E7A45ae42";

(async () => {
  const start = Number(process.argv[2]);
  const zk = await ZK.create();
  const set = zk.issuerSet(DEMO_ATTESTOR_SEEDS.map((s) => zk.newAttestor(s).pub));
  const net = NETWORKS.sepolia;
  let nonce = start;
  const addr = {};
  const plan = [];
  const add = (name, key, args) => {
    const a = artifacts[name];
    const iface = new ethers.Interface(a.abi);
    const data = a.bytecode + (args.length ? iface.encodeDeploy(args).slice(2) : "");
    const predicted = ethers.getCreateAddress({ from: deployer, nonce });
    addr[key] = predicted;
    plan.push({ label: `deploy ${name}`, name, key, nonce, to: null, data, args: args.map(String), predicted });
    nonce++;
  };
  add("KYASchemeRegistry", "schemes", []);
  add("KYARegistry", "kya", [addr.schemes]);
  add("KYAPolicyRegistry", "policies", [addr.kya]);
  add("ValidationRegistry8004", "validation", [net.identityRegistry]);
  add("KYABridge8004", "bridge", [addr.kya, addr.validation, deployer]);
  add("Groth16Verifier", "g16", []);
  add("Groth16KYAVerifierAdapter", "adapter", [addr.g16, set.rootHex, EPOCH_SECONDS, EPOCH_GRACE]);
  process.stdout.write(JSON.stringify({ deployer, startNonce: start, identityRegistry: net.identityRegistry, issuerSetRoot: set.rootHex, seeds: DEMO_ATTESTOR_SEEDS, adapterConfig: { epochSeconds: EPOCH_SECONDS, epochGrace: EPOCH_GRACE, issuerSetRoot: set.rootHex }, addresses: addr, plan }, null, 1));
})();
