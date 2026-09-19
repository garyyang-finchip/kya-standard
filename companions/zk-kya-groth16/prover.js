// ERC-KYA companion — prover-side tooling for the kya_public_v1 circuit.
//
//   const zk = await ZK.create();
//   const attestor = zk.newAttestor(seed);               // EdDSA (Baby Jubjub) key
//   const set = zk.issuerSet([attestor.pub, ...]);        // Poseidon Merkle tree, depth 16
//   const secret = zk.randomSecret();
//   const claim = { subjectKey, schemeId, level, claimDigest, expiresAt };   // scheme-bound credential
//   const sig = zk.attest(attestor, claim, secret);       // attestor signs (claim, Poseidon(secret))
//   const epoch = zk.epochFor(nowSeconds, epochLength);   // must match the adapter's window
//   const { publicInputs, proof } = await zk.prove({ ...claim, epoch, secret, attestor, sig, set });
//   // → kya.attestWithProof(subject, schemeId, publicInputs, proof, evidenceURI)
//
// All 256-bit values are bytes32 hex strings on the JS side and split into (hi128, lo128) for the circuit.
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");
const snarkjs = require("snarkjs");
const { buildPoseidon, buildEddsa } = require("circomlibjs");

const DEPTH = 16;
const BUILD = path.join(__dirname, "build");
const coder = ethers.AbiCoder.defaultAbiCoder();

const MASK128 = (1n << 128n) - 1n;
const split = (hex) => { const v = BigInt(hex); return [v >> 128n, v & MASK128]; };
const join = (hi, lo) => ethers.toBeHex((BigInt(hi) << 128n) | BigInt(lo), 32);

class ZK {
  static async create(opts = {}) {
    const z = new ZK();
    z.poseidon = await buildPoseidon();
    z.eddsa = await buildEddsa();
    z.F = z.poseidon.F;
    z.wasm = opts.wasm || path.join(BUILD, "kya_public_v1_js", "kya_public_v1.wasm");
    z.zkey = opts.zkey || path.join(BUILD, "kya_final.zkey");
    return z;
  }

  // ---- field helpers ----
  H(...xs) { return this.F.toObject(this.poseidon(xs.map((x) => BigInt(x)))); }
  randomSecret() { return BigInt("0x" + crypto.randomBytes(31).toString("hex")); }

  // ---- attestor keys (EdDSA-Poseidon over Baby Jubjub) ----
  newAttestor(seed) {
    const prv = seed ? Buffer.from(ethers.keccak256(ethers.toUtf8Bytes(seed)).slice(2), "hex") : crypto.randomBytes(32);
    const pubP = this.eddsa.prv2pub(prv);
    const pub = [this.F.toObject(pubP[0]), this.F.toObject(pubP[1])];
    return { prv, pub, leaf: this.H(pub[0], pub[1]) };
  }

  // ---- issuer set: Poseidon Merkle tree of attestor leaves ----
  issuerSet(pubs) {
    const leaves = pubs.map(([ax, ay]) => this.H(ax, ay));
    const zeros = [0n];
    for (let i = 1; i <= DEPTH; i++) zeros.push(this.H(zeros[i - 1], zeros[i - 1]));
    const layers = [leaves.slice()];
    for (let d = 0; d < DEPTH; d++) {
      const cur = layers[d], next = [];
      for (let i = 0; i < cur.length; i += 2) next.push(this.H(cur[i], i + 1 < cur.length ? cur[i + 1] : zeros[d]));
      layers.push(next.length ? next : [zeros[d + 1]]);
    }
    const root = layers[DEPTH][0];
    const proofFor = (leafIndex) => {
      const pathElements = [], pathIndices = [];
      let idx = leafIndex;
      for (let d = 0; d < DEPTH; d++) {
        const sib = idx ^ 1;
        pathElements.push(sib < layers[d].length ? layers[d][sib] : zeros[d]);
        pathIndices.push(idx & 1);
        idx >>= 1;
      }
      return { pathElements, pathIndices };
    };
    return { root, rootHex: ethers.toBeHex(root, 32), leaves, proofFor };
  }

  // ---- what the attestor signs (revision 2: schemeId is part of the credential) ----
  message(claim, secret) {
    if (!claim.schemeId) throw new Error("claim.schemeId required (credential is scheme-bound)");
    const [skHi, skLo] = split(claim.subjectKey);
    const [siHi, siLo] = split(claim.schemeId);
    const [cdHi, cdLo] = split(claim.claimDigest);
    return this.H(skHi, skLo, siHi, siLo, BigInt(claim.level), cdHi, cdLo, BigInt(claim.expiresAt), this.H(secret));
  }

  // ---- epoch the adapter will accept: floor(now / epochLength); 0 when epochLength == 0 ----
  epochFor(nowSeconds, epochLength) {
    const L = BigInt(epochLength || 0);
    return L === 0n ? 0n : BigInt(nowSeconds) / L;
  }

  attest(attestor, claim, secret) {
    const m = this.F.e(this.message(claim, secret));
    const s = this.eddsa.signPoseidon(attestor.prv, m);
    return { R8x: this.F.toObject(s.R8[0]), R8y: this.F.toObject(s.R8[1]), S: s.S };
  }

  nullifier(secret, schemeId, epoch) {
    const [hi, lo] = split(schemeId);
    return this.H(secret, hi, lo, BigInt(epoch));
  }

  // ---- proving ----
  async prove({ subjectKey, level, claimDigest, expiresAt, schemeId, epoch = 0, secret, attestor, sig, set, leafIndex }) {
    const idx = leafIndex ?? set.leaves.indexOf(attestor.leaf);
    if (idx < 0) throw new Error("attestor not in issuer set");
    const { pathElements, pathIndices } = set.proofFor(idx);
    const [skHi, skLo] = split(subjectKey);
    const [cdHi, cdLo] = split(claimDigest);
    const [rtHi, rtLo] = split(set.rootHex);
    const [siHi, siLo] = split(schemeId);

    const input = {
      subjectKeyHi: skHi, subjectKeyLo: skLo, level: BigInt(level),
      claimDigestHi: cdHi, claimDigestLo: cdLo, expiresAt: BigInt(expiresAt),
      issuerSetRootHi: rtHi, issuerSetRootLo: rtLo, schemeIdHi: siHi, schemeIdLo: siLo, epoch: BigInt(epoch),
      secret, Ax: attestor.pub[0], Ay: attestor.pub[1], S: sig.S, R8x: sig.R8x, R8y: sig.R8y,
      pathElements, pathIndices,
    };
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, this.wasm, this.zkey);

    const nullifierHex = join(publicSignals[0], publicSignals[1]);
    const publicInputs = coder.encode(
      ["bytes32", "bytes32", "uint8", "bytes32", "uint64", "bytes32", "uint64"],
      [subjectKey, nullifierHex, level, claimDigest, expiresAt, set.rootHex, epoch]
    );
    const proofBytes = coder.encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [[proof.pi_a[0], proof.pi_a[1]], [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]], [proof.pi_c[0], proof.pi_c[1]]]
    );
    return { publicInputs, proof: proofBytes, publicSignals, nullifier: nullifierHex, rawProof: proof };
  }

  async verifyLocally(publicSignals, rawProof, vkeyPath) {
    const vkey = require(vkeyPath || path.join(BUILD, "verification_key.json"));
    return snarkjs.groth16.verify(vkey, publicSignals, rawProof);
  }
}

module.exports = { ZK, split, join, DEPTH };
