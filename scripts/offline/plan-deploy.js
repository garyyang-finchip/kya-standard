// Build an offline deployment plan (contract-creation calldata + predicted CREATE addresses).
// Usage: node scripts/offline/plan-deploy.js <startNonce> [reuseFrom.json] > deployments/offline/plan-rN.json
// With reuseFrom.json (a prior deployments/sepolia*.json) the Groth16Verifier and adapter are reused when their
// creation bytecode is unchanged, instead of being redeployed.
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
  const reuse = process.argv[3] ? require(path.resolve(process.argv[3])) : null;
  const reused = {};
  if (reuse && reuse.adapterConfig && reuse.adapterConfig.issuerSetRoot === set.rootHex && reuse.adapterConfig.epochSeconds === EPOCH_SECONDS && reuse.adapterConfig.epochGrace === EPOCH_GRACE) {
    addr.g16 = reuse.contracts.Groth16Verifier.address; reused.g16 = true;
    addr.adapter = reuse.contracts.Groth16KYAVerifierAdapter.address; reused.adapter = true;
  } else {
    add("Groth16Verifier", "g16", []);
    add("Groth16KYAVerifierAdapter", "adapter", [addr.g16, set.rootHex, EPOCH_SECONDS, EPOCH_GRACE]);
  }
  process.stdout.write(JSON.stringify({ deployer, startNonce: start, identityRegistry: net.identityRegistry, issuerSetRoot: set.rootHex, seeds: DEMO_ATTESTOR_SEEDS, adapterConfig: { epochSeconds: EPOCH_SECONDS, epochGrace: EPOCH_GRACE, issuerSetRoot: set.rootHex }, addresses: addr, reused, plan }, null, 1));
})();
