// Generates assets/erc-kya/vectors/vectors.json — deterministic test vectors for the ERC-KYA spec.
// Usage: node tools/vectors.js
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const artifacts = require("../build/artifacts.json");

const coder = ethers.AbiCoder.defaultAbiCoder();
const OUT = path.resolve(__dirname, "../assets/erc-kya/vectors/vectors.json");

// ---- fixed inputs -------------------------------------------------------------
const chainId = 11155111n; // Sepolia
const identityRegistry = "0x8004A818BFB912233c491871b3d84c89A494BD9e"; // placeholder ERC-8004 identity registry
const agentId = 22n;
const controller = "0x1111111111111111111111111111111111111111";
const issuer = "0x2222222222222222222222222222222222222222";
const verifier = "0x3333333333333333333333333333333333333333";
const kyaRegistry = "0x4444444444444444444444444444444444444444";
const policyOwner = "0x5555555555555555555555555555555555555555";
const schemeRegistry = "0x6666666666666666666666666666666666666666";
const proverKey = "0x000000000000000000000000000000000000000000000000000000000000abcd";

// ---- subject ------------------------------------------------------------------
const SUBJECT_TYPES = {};
for (const t of ["erc8004", "account", "erc721", "did"]) SUBJECT_TYPES[t] = ethers.keccak256(ethers.toUtf8Bytes(t));

const subjectData = coder.encode(["uint256", "address", "uint256"], [chainId, identityRegistry, agentId]);
const subjectKey = ethers.keccak256(coder.encode(["bytes32", "bytes"], [SUBJECT_TYPES.erc8004, subjectData]));

// ---- scheme -------------------------------------------------------------------
const schemeDescriptor = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../assets/erc-kya/vectors/example-scheme.json"), "utf8"));
const schemeBytes = fs.readFileSync(path.resolve(__dirname, "../assets/erc-kya/vectors/example-scheme.json"));
const schemeHash = ethers.keccak256(schemeBytes);
const schemeNonce = 0n;
const schemeId = ethers.keccak256(coder.encode(["uint256", "address", "address", "bytes32", "uint256"], [chainId, schemeRegistry, controller, schemeHash, schemeNonce]));

// ---- assertion ----------------------------------------------------------------
const issuerNonce = 0n;
const assertionId = ethers.keccak256(coder.encode(["bytes32", "bytes32", "address", "uint256"], [subjectKey, schemeId, issuer, issuerNonce]));
const provedAssertionId = ethers.keccak256(coder.encode(["bytes32", "bytes32", "address", "uint256"], [subjectKey, schemeId, verifier, 0n]));

// ---- ZK public inputs (kya-public-v1) -----------------------------------------
const nullifier = ethers.keccak256(coder.encode(["bytes32", "bytes32", "uint64"], [proverKey, schemeId, 0n])); // H(secret, schemeId, epoch)
const claimDigest = ethers.id("claims:jurisdiction=SG;capital>=1e6");
const issuerSetRoot = ethers.id("issuer-set-root");
const expiresAt = 1_900_000_000n;
const epoch = 0n;
const publicInputs = coder.encode(["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"], [subjectKey, nullifier, 4, claimDigest, expiresAt, issuerSetRoot, epoch]);
const split = (v) => [(BigInt(v) >> 128n).toString(), (BigInt(v) & ((1n << 128n) - 1n)).toString()];
const groth16Signals = [...split(nullifier), ...split(subjectKey), "4", ...split(claimDigest), expiresAt.toString(), ...split(issuerSetRoot), ...split(schemeId), epoch.toString()];

// ---- policy -------------------------------------------------------------------
const policyDescriptor = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../assets/erc-kya/vectors/example-policy.json"), "utf8"));
const policyHash = ethers.keccak256(fs.readFileSync(path.resolve(__dirname, "../assets/erc-kya/vectors/example-policy.json")));
// executable projection = the document's top-level allOf restricted to what IKYAPolicyEvaluator can express
const projection = [{ schemeId: "0x0000000000000000000000000000000000000000000000000000000000000001", minLevel: 2, issuers: ["0x2222222222222222222222222222222222222222"] }];
const rulesHash = ethers.keccak256(coder.encode(["tuple(bytes32 schemeId,uint8 minLevel,address[] issuers)[]"], [projection]));
const policyIdNoRules = ethers.keccak256(coder.encode(["address", "bytes32", "bytes32", "uint256"], [policyOwner, policyHash, ethers.ZeroHash, 0n]));
const policyId = ethers.keccak256(coder.encode(["address", "bytes32", "bytes32", "uint256"], [policyOwner, policyHash, rulesHash, 1n]));

// ---- ERC-8004 bridge ----------------------------------------------------------
const bridge = "0x7777777777777777777777777777777777777777";
const trustedIssuers = [issuer];
const responseMap = [0, 50, 100];
const configHash = ethers.keccak256(coder.encode(["bytes32", "address[]", "uint8[]"], [schemeId, trustedIssuers, responseMap]));
const requestHash = ethers.keccak256(coder.encode(["bytes32", "uint256", "address", "address", "bytes32", "uint256", "bytes32"], [ethers.id("erc-kya-request-v1"), chainId, identityRegistry, bridge, configHash, agentId, schemeId]));
const responseHash = ethers.keccak256(coder.encode(["bytes32", "uint8", "bytes32"], [assertionId, 2, configHash]));
const tag = "kya:" + schemeId.slice(2);
const metadataValue = coder.encode(["address", "bytes32[]"], [kyaRegistry, [schemeId]]);

// ---- EIP-712 ------------------------------------------------------------------
const domain = { name: "KYA", version: "1", chainId: Number(chainId), verifyingContract: kyaRegistry };
const types = {
  KYAChallenge: [
    { name: "verifierSubjectKey", type: "bytes32" },
    { name: "proverSubjectKey", type: "bytes32" },
    { name: "schemeIds", type: "bytes32[]" },
    { name: "policyId", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint64" },
  ],
  KYAPresentation: [
    { name: "challengeHash", type: "bytes32" },
    { name: "assertionIds", type: "bytes32[]" },
    { name: "proofSchemeId", type: "bytes32" },
    { name: "publicInputs", type: "bytes" },
    { name: "proof", type: "bytes" },
  ],
};
const verifierSubjectKey = ethers.keccak256(coder.encode(["bytes32", "bytes"], [SUBJECT_TYPES.account, coder.encode(["uint256", "address"], [chainId, issuer])]));
const challenge = { verifierSubjectKey, proverSubjectKey: subjectKey, schemeIds: [schemeId], policyId, nonce: ethers.id("nonce-1"), expiry: 1_800_003_600 };
const challengeHash = ethers.TypedDataEncoder.hash(domain, { KYAChallenge: types.KYAChallenge }, challenge);
const presentation = { challengeHash, assertionIds: [assertionId], proofSchemeId: ethers.ZeroHash, publicInputs: "0x", proof: "0x" };
const presentationHash = ethers.TypedDataEncoder.hash(domain, { KYAPresentation: types.KYAPresentation }, presentation);
const zkPresentation = { challengeHash, assertionIds: [], proofSchemeId: schemeId, publicInputs, proof: "0x" };
const zkPresentationHash = ethers.TypedDataEncoder.hash(domain, { KYAPresentation: types.KYAPresentation }, zkPresentation);

// deterministic signer for the presentation vector
const wallet = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // well-known test key
const presentationSignature = wallet.signingKey.sign(presentationHash).serialized;

// ---- interface ids from compiled InterfaceIds.sol are read at test time; recompute here via ethers
const ifaceId = (abi, fns) => {
  const iface = new ethers.Interface(abi);
  let acc = 0n;
  for (const f of iface.fragments.filter((f) => f.type === "function")) acc ^= BigInt(iface.getFunction(f.name).selector);
  return "0x" + acc.toString(16).padStart(8, "0");
};
const interfaceIds = {
  IKYASchemeRegistry: ifaceId(artifacts.IKYASchemeRegistry.abi),
  IKYARegistry: ifaceId(artifacts.IKYARegistry.abi),
  IKYAPolicyRegistry: ifaceId(artifacts.IKYAPolicyRegistry.abi),
  IKYAPolicyEvaluator: ifaceId(artifacts.IKYAPolicyEvaluator.abi),
  IKYAVerifier: ifaceId(artifacts.IKYAVerifier.abi),
};

const vectors = {
  _comment: "Deterministic vectors for ERC-KYA (placeholder number 9999). Regenerate with `node tools/vectors.js`.",
  subjectTypes: SUBJECT_TYPES,
  subject: { chainId: chainId.toString(), identityRegistry, agentId: agentId.toString(), subjectType: SUBJECT_TYPES.erc8004, subjectData, subjectKey },
  scheme: { chainId: chainId.toString(), schemeRegistry, controller, schemeHash, nonce: schemeNonce.toString(), schemeId, schemeIdPreimage: "abi.encode(chainId, schemeRegistry, controller, schemeHash, nonce)", descriptorKeccak: "keccak256 of the raw bytes of example-scheme.json", binding: "controller (1)", bindingWitnessExample: { controller: "0x8888888888888888888888888888888888888888", witness: ethers.keccak256(coder.encode(["address"], ["0x8888888888888888888888888888888888888888"])) } },
  assertion: { issuer, issuerNonce: issuerNonce.toString(), assertionId, provedIssuer: verifier, provedAssertionId },
  zk: { layout: "kya-public-v1", signalOrder: "[nullifier.hi, nullifier.lo, subjectKey.hi, subjectKey.lo, level, claimDigest.hi, claimDigest.lo, expiresAt, issuerSetRoot.hi, issuerSetRoot.lo, schemeId.hi, schemeId.lo, epoch]", proverSecret: proverKey, epoch: epoch.toString(), nullifier, claimDigest, issuerSetRoot, expiresAt: expiresAt.toString(), publicInputs, evidenceHash: ethers.keccak256(publicInputs), groth16Signals },
  policy: { owner: policyOwner, policyHash, withoutRules: { nonce: "0", rulesHash: ethers.ZeroHash, policyId: policyIdNoRules }, withRules: { nonce: "1", projection, rulesHash, rulesHashPreimage: "abi.encode(Rule[] allOf)", policyId }, policyIdPreimage: "abi.encode(owner, policyHash, rulesHash, nonce)" },
  bridge8004: { requestType: ethers.id("erc-kya-request-v1"), bridge, trustedIssuers, responseMap, configHash, configHashPreimage: "abi.encode(schemeId, trustedIssuers, responseMap)", requestHashPreimage: "abi.encode(requestType, chainId, identityRegistry, bridge, configHash, agentId, schemeId)", requestHash, responseHashExample: { assertionId, level: 2, responseHash }, responseHashPreimage: "abi.encode(assertionId, level, configHash)", tag, metadataKey: "kya", metadataValue },
  eip712: { domain, types, challenge, challengeHash, presentation, presentationHash, zkPresentation, zkPresentationHash, signer: wallet.address, presentationSignature },
  interfaceIds,
};

fs.writeFileSync(OUT, JSON.stringify(vectors, null, 2));
console.log("wrote", path.relative(process.cwd(), OUT));
console.log(JSON.stringify({ subjectKey, schemeId, assertionId, requestHash, tag, challengeHash, interfaceIds }, null, 2));
