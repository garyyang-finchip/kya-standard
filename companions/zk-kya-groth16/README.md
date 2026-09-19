# ZK-KYA companion — reference Groth16 circuit for `kya-public-v1`

**Status: EXPERIMENTAL companion. Not part of the ERC text.** It exists to show that the ZK-KYA profile in the ERC is implementable end to end with a real proof system, and to give scheme authors a starting point. The trusted setup shipped here is a **single-party test ceremony**; do not use these keys in production.

> This circuit is the **credential pattern** of ZK-KYA (ERC §5.1): a hidden attestor signed a verdict in advance. The **predicate pattern** — the scheme is the decision rule and the prover evaluates it over its own authenticated data (storage proofs, zkTLS, or source-signed inputs) — uses the same `IKYAVerifier` boundary but a different circuit; it is **not** demonstrated by this companion. A minimal example is planned.

## What the circuit proves

> "An attestor whose EdDSA key is a member of the issuer set committed to by `issuerSetRoot` signed
> `(subjectKey, schemeId, level, claimDigest, expiresAt, Poseidon(secret))`, and I know `secret`.
> My nullifier for `(schemeId, epoch)` is `Poseidon(secret, schemeId.hi, schemeId.lo, epoch)`."

This is the **issuer-hiding** shape from Section 5 of the ERC: the chain learns *which agent*, the level, the claim digest, the expiry and *which issuer set* vouched — never *which issuer* and never the underlying facts. It is not anonymous: `subjectKey` is public and re-proofs of the same subject are linkable by it. The attestor binds the prover into the signed message through `Poseidon(secret)`, so only the party holding `secret` can turn the credential into an assertion; the credential names the `schemeId`, so it cannot be presented under another scheme; and the nullifier lets that party re-prove once per epoch, where the epoch is enforced by the on-chain adapter from `block.timestamp` (not chosen by the prover).

**Circuit revision 2** (after external review): `schemeId` added to the signed credential (closes cross-scheme replay); `Split128` uses `Num2Bits_strict` (unique hi/lo encoding, closes nullifier aliasing); epoch window enforced by `Groth16KYAVerifierAdapter(epochLength, epochGrace)`. Revision 1 keys and the revision 1 Sepolia deployment are superseded.

Constraints: ~14.4k non-linear (EdDSA-Poseidon verify + Poseidon Merkle depth 16 + Poseidon(9) message and Poseidon(4) nullifier + strict range checks). Proving time on a laptop: 2–4 s.

## Public signals (13, snarkjs order)

| # | signal | source |
|---|---|---|
| 0–1 | `nullifier.hi/lo` | circuit output |
| 2–3 | `subjectKey.hi/lo` | `publicInputs` |
| 4 | `level` | `publicInputs` |
| 5–6 | `claimDigest.hi/lo` | `publicInputs` |
| 7 | `expiresAt` | `publicInputs` |
| 8–9 | `issuerSetRoot.hi/lo` | `publicInputs` |
| 10–11 | `schemeId.hi/lo` | **the adapter's `schemeId` argument** — the prover cannot pick it |
| 12 | `epoch` | `publicInputs` — adapter requires `current - epochGrace <= epoch <= current` |

`publicInputs = abi.encode(subjectKey, nullifier, level, claimDigest, expiresAt, issuerSetRoot, epoch)` — the canonical `kya-public-v1` layout. 256-bit values are split into `(hi128, lo128)` so nothing is truncated under the BN254 scalar field. The on-chain `Groth16KYAVerifierAdapter` reconstructs exactly this vector (`adapter.signals(schemeId, pub)` exposes it for tooling).

## Files

```
circuits/kya_public_v1.circom   the circuit (circom 2.1+, circomlib Poseidon / EdDSA-Poseidon)
prover.js                       JS: attestor keys, issuer-set Merkle tree, signing, proving, ABI packing
build/                          generated: r1cs, wasm, zkey, verification_key.json, Groth16Verifier.sol
```

## Build

```bash
# circom 2.1.6+ on PATH (https://docs.circom.io/getting-started/installation/)
npm install                                    # snarkjs, circomlib, circomlibjs
npm run zk:compile                             # r1cs + wasm
npm run zk:setup                               # local powers-of-tau 2^15 + phase 2 (TEST CEREMONY, ~15 min on 2 cores; reuses pot15_final.ptau if present)
node tools/compile.js                          # picks up build/Groth16Verifier.sol
npm run test:zk                                # real proof → Verifier.sol → adapter → KYARegistry
```

Replace `zk:setup` with a real ceremony (e.g. a Hermez `powersOfTau28_hez_final_15.ptau` plus a multi-party phase 2) before any non-test deployment.

## Using your own circuit

The framework does not care what you prove. Keep three things and you stay compatible with every KYA Registry:

1. Output or expose `subjectKey` and a `nullifier` scoped at least to `schemeId`, and make the fact issuer's credential commit to `schemeId` (Section 5 binding rules).
2. Publish the layout in the Scheme Descriptor's `circuit.publicInputLayout` / `publicInputAbi`, plus `epochSeconds` / `epochGrace`.
3. Ship an `IKYAVerifier` adapter that decodes your `publicInputs`, enforces the epoch window from `block.timestamp`, feeds the verifier, and returns `(ok, subjectKey, nullifier, level, claimDigest, expiresAt, anchor)`.

Everything else — proving system, hash choices, what `claimDigest` commits to, how attestors are admitted to the issuer set — is the scheme author's business.
