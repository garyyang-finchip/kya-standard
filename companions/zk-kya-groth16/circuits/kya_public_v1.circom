pragma circom 2.1.6;

// ERC-KYA companion: reference ZK-KYA circuit for the `kya-public-v1` layout.
//
// Statement proved (issuer-hiding attestation):
//   "An attestor whose key is a member of the issuer set committed to by `issuerSetRoot`
//    signed (subjectKey, level, claimDigest, expiresAt, Poseidon(secret)), and I know `secret`.
//    My nullifier for (schemeId, epoch) is Poseidon(secret, schemeIdHi, schemeIdLo, epoch)."
//
// Public signals (snarkjs order: outputs first, then public inputs in declaration order):
//   [0] nullifierHi   (output)
//   [1] nullifierLo   (output)
//   [2] subjectKeyHi
//   [3] subjectKeyLo
//   [4] level
//   [5] claimDigestHi
//   [6] claimDigestLo
//   [7] expiresAt
//   [8] issuerSetRootHi
//   [9] issuerSetRootLo
//  [10] schemeIdHi     (fed by the on-chain adapter from its `schemeId` argument)
//  [11] schemeIdLo
//  [12] epoch
//
// 256-bit values are carried as (hi128, lo128) so they fit in the BN254 scalar field.
// The Merkle root and the nullifier are Poseidon outputs (< p), split the same way.

include "../../../node_modules/circomlib/circuits/poseidon.circom";
include "../../../node_modules/circomlib/circuits/eddsaposeidon.circom";
include "../../../node_modules/circomlib/circuits/bitify.circom";
include "../../../node_modules/circomlib/circuits/mux1.circom";

// Split a field element into (hi128, lo128).
template Split128() {
    signal input in;
    signal output hi;
    signal output lo;
    component n2b = Num2Bits(254);
    n2b.in <== in;
    component loB = Bits2Num(128);
    component hiB = Bits2Num(126);
    for (var i = 0; i < 128; i++) loB.in[i] <== n2b.out[i];
    for (var i = 0; i < 126; i++) hiB.in[i] <== n2b.out[128 + i];
    hi <== hiB.out;
    lo <== loB.out;
}

// Merkle inclusion with Poseidon(2) hashing, depth `levels`.
template MerkleInclusion(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    component mux[levels];
    signal cur[levels + 1];
    cur[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== cur[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== cur[i];
        mux[i].s <== pathIndices[i];
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[levels];
}

template KYAPublicV1(depth) {
    // ---- public inputs (canonical kya-public-v1 fields, split) ----
    signal input subjectKeyHi;
    signal input subjectKeyLo;
    signal input level;
    signal input claimDigestHi;
    signal input claimDigestLo;
    signal input expiresAt;
    signal input issuerSetRootHi;
    signal input issuerSetRootLo;
    signal input schemeIdHi;
    signal input schemeIdLo;
    signal input epoch;

    // ---- private inputs ----
    signal input secret;
    signal input Ax;                 // attestor EdDSA (Baby Jubjub) public key
    signal input Ay;
    signal input S;                  // signature
    signal input R8x;
    signal input R8y;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // ---- outputs ----
    signal output nullifierHi;
    signal output nullifierLo;

    // range sanity on public fields
    component lvl = Num2Bits(8);   lvl.in <== level;
    component exp = Num2Bits(64);  exp.in <== expiresAt;
    component ep  = Num2Bits(64);  ep.in <== epoch;
    component skh = Num2Bits(128); skh.in <== subjectKeyHi;
    component skl = Num2Bits(128); skl.in <== subjectKeyLo;
    component cdh = Num2Bits(128); cdh.in <== claimDigestHi;
    component cdl = Num2Bits(128); cdl.in <== claimDigestLo;
    component sih = Num2Bits(128); sih.in <== schemeIdHi;
    component sil = Num2Bits(128); sil.in <== schemeIdLo;

    // prover commitment bound into the signed message
    component pc = Poseidon(1);
    pc.inputs[0] <== secret;

    // message the attestor signed
    component msg = Poseidon(7);
    msg.inputs[0] <== subjectKeyHi;
    msg.inputs[1] <== subjectKeyLo;
    msg.inputs[2] <== level;
    msg.inputs[3] <== claimDigestHi;
    msg.inputs[4] <== claimDigestLo;
    msg.inputs[5] <== expiresAt;
    msg.inputs[6] <== pc.out;

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax <== Ax;
    sig.Ay <== Ay;
    sig.S <== S;
    sig.R8x <== R8x;
    sig.R8y <== R8y;
    sig.M <== msg.out;

    // attestor membership in issuer set
    component leaf = Poseidon(2);
    leaf.inputs[0] <== Ax;
    leaf.inputs[1] <== Ay;
    component inc = MerkleInclusion(depth);
    inc.leaf <== leaf.out;
    for (var i = 0; i < depth; i++) {
        inc.pathElements[i] <== pathElements[i];
        inc.pathIndices[i] <== pathIndices[i];
    }
    component rootSplit = Split128();
    rootSplit.in <== inc.root;
    rootSplit.hi === issuerSetRootHi;
    rootSplit.lo === issuerSetRootLo;

    // nullifier scoped to (schemeId, epoch)
    component nul = Poseidon(4);
    nul.inputs[0] <== secret;
    nul.inputs[1] <== schemeIdHi;
    nul.inputs[2] <== schemeIdLo;
    nul.inputs[3] <== epoch;
    component nulSplit = Split128();
    nulSplit.in <== nul.out;
    nullifierHi <== nulSplit.hi;
    nullifierLo <== nulSplit.lo;
}

component main { public [subjectKeyHi, subjectKeyLo, level, claimDigestHi, claimDigestLo, expiresAt, issuerSetRootHi, issuerSetRootLo, schemeIdHi, schemeIdLo, epoch] } = KYAPublicV1(16);
