# Know-Your-Agent (KYA) Framework — ERC draft

A scheme-agnostic registry and handshake standard for recording, resolving and presenting **trust assertions about AI agents**, with a **zero-knowledge (ZK-KYA) profile** and a normative **ERC-8004 binding**.

> Status: Draft · **ERC-8419** (number assigned 2026-09-20 in ethereum/ERCs PR #2012) · discussion thread: https://ethereum-magicians.org/t/erc-8419-know-your-agent-kya-framework/29735

## What it is — in one paragraph

ERC-8004 gives agents identity and raw trust *signals*. This ERC gives the agent economy a shared container for trust *conclusions*: a **Scheme Registry** that addresses and versions KYA principles (what is checked, what it binds to — identity / controller / instance — how the result is expressed, how assertions are admitted; semantics immutable per `schemeId`), a **KYA Registry** that records assertions (subject · scheme · issuer · result · validity · anchor · revocation) and resolves them under a relying party's chosen issuers, an **EIP-712 handshake** with normative acceptance rules, and a minimal **Policy Registry** (base + optional on-chain evaluator). The framework never defines a KYA algorithm or a credit rule — those live in scheme descriptors and pluggable `IKYAVerifier` contracts. **ZK-KYA is a mode of the same registry**, not a second standard: an assertion is admitted by a verifier contract checking a proof instead of by an issuer's signature; it hides the fact issuer and the facts, not the subject. Two usage patterns (combinable) fit the same interface — *credential* (a hidden issuer signed a verdict in advance; the reference circuit) and *predicate* (the scheme is the decision rule, the prover evaluates it over its own authenticated data, and only the verdict is presented — no pre-issued credit verdict, no raw data sent to the counterparty; the reference implementation does not yet include a predicate circuit) — see ERC §5.1. A **KYA Bridge** optionally mirrors a lossy snapshot into the ERC-8004 Validation Registry so ERC-8004-only clients see it under a `kya:` tag.

```
L4  Policy          "counterparty must satisfy (scheme, minLevel, issuers) …"
L3  Handshake       KYAChallenge / KYAPresentation (EIP-712) · /.well-known/kya.json
L2  KYA Registry    attest() | attestWithProof()  →  resolve() / check()
L1  Scheme Registry registerScheme(SchemeInput{uri, hash, mode, binding, resultKind, levelMask, verifier, predecessor})
L0  Subject         erc8004 (MUST) · account · erc721 · did
        ▲ ERC-8004 identity + signals as input      │ KYABridge8004 → Validation Registry (tag "kya:…")
```

## Repository layout

```
ERCS/erc-kya.md                     the ERC text (EIP-1 format, ERC-8419)
assets/erc-kya/
  contracts/
    interfaces/                     IKYATypes, IKYASchemeRegistry, IKYARegistry, IKYAPolicyRegistry, IKYAVerifier, IERC8004Validation
    KYASchemeRegistry.sol           permissionless scheme registry
    KYARegistry.sol                 assertions: attested + proved modes, supersession, revocation, resolve/check
    KYAPolicyRegistry.sol           policy ids + optional on-chain allOf evaluation
    KYABridge8004.sol               curated ERC-8004 validator mirroring KYA levels to 0–100 (lossy snapshot; reverts on unmapped levels)
    verifiers/Groth16KYAVerifierAdapter.sol   snarkjs-style Groth16 → IKYAVerifier (kya-public-v1, 15 signals incl. schemeId + admissionDomain, epoch window enforced on-chain)
    companions/ValidationRegistry8004.sol     spec-conforming ERC-8004 Validation Registry (canonical one not yet deployed)
    mocks/Mocks.sol                 test-only identity registry and verifiers
  schemas/                          kya-scheme / kya-policy / kya-discovery JSON Schemas
  vectors/                          vectors.json + example descriptors
tools/compile.js                    solc-js build → build/artifacts.json
tools/vectors.js                    regenerates vectors.json
tools/prepare-pr.sh                 lays the files out as an ethereum/ERCs PR
test/kya.test.js                    in-process EVM end-to-end suite (18 cases + 7 regression cases from the review thread (R1–R7), no RPC needed)
test/zk.test.js                     real Groth16 proof → Verifier.sol → adapter → KYARegistry, incl. adversarial + admission-domain cases (17 cases)
companions/zk-kya-groth16/          EXPERIMENTAL reference ZK-KYA circuit (circom) + prover tooling + built keys
scripts/deploy-sepolia.js           deploys the stack to Sepolia against the official ERC-8004 IdentityRegistry
scripts/examples-sepolia.js         six worked examples on Sepolia (agent, schemes, attested, ZK, policy, bridge)
```

## Build & test

```bash
npm install
node tools/compile.js        # solc 0.8.28, optimizer on, cancun
node test/kya.test.js        # 24 end-to-end tests on an in-process EVM
node tools/vectors.js        # regenerate assets/erc-kya/vectors/vectors.json
npm run test:zk              # ZK companion end-to-end with a real Groth16 proof (uses the shipped test zkey)
```

## Sepolia

```bash
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com   # or your own
export PRIVATE_KEY=0x...                                      # funded with ~0.05 Sepolia ETH
npm run deploy:sepolia       # → deployments/sepolia.json
npm run examples:sepolia     # → deployments/sepolia-examples.json (every tx hash)
```

The deployment binds to the **official ERC-8004 IdentityRegistry on Sepolia** (`0x8004A818BFB912233c491871b3d84c89A494BD9e`); the demo agent is a real ERC-8004 agent. Because the canonical ERC-8004 Validation Registry is not yet deployed on any public network, the companion deploys a spec-conforming `ValidationRegistry8004` bound to that identity registry so the KYA Bridge can be exercised end to end. The ZK example uses the shipped **test-ceremony** keys and three demo attestors derived from public seeds — reproducible by anyone, secure for no one.

### Deployed addresses (revision 5, current)

Deployed 2026-10-11 (chainId 11155111) after the third round of external review ("Result Domain": `resultKind` + `levelMask` committed per scheme, undeclared levels refused at admission, `check` rejects `minLevel == 0` and non-ordered schemes). Full records with every tx hash: [`deployments/sepolia.json`](deployments/sepolia.json) and [`deployments/sepolia-examples.json`](deployments/sepolia-examples.json). The Groth16 verifier and adapter are unchanged since revision 4 and are reused (creation bytecode verified identical). Earlier deployments are kept for the record (`sepolia-r1.json` … `sepolia-r4.json`, the withdrawn `sepolia-r4-draft.json`, and their `-examples` files) and **must not be relied on**; in particular their bridges' records in their own Validation Registries are not part of the current query path.

| contract | address | block |
|---|---|---|
| KYASchemeRegistry | [`0x8Dd5ec713E21a726FB864f6541F9AAA59aEC0cc0`](https://sepolia.etherscan.io/address/0x8Dd5ec713E21a726FB864f6541F9AAA59aEC0cc0) | 11886801 |
| KYARegistry (`admissionDomain()` = `0x779cd7d5…4fc6`) | [`0xE06FBA26561E7A385B32514f6657De68723d5cF1`](https://sepolia.etherscan.io/address/0xE06FBA26561E7A385B32514f6657De68723d5cF1) | 11886819 |
| KYAPolicyRegistry | [`0x7767966702bf12C31CDD600807B77443998f0F21`](https://sepolia.etherscan.io/address/0x7767966702bf12C31CDD600807B77443998f0F21) | 11886838 |
| ValidationRegistry8004 | [`0x91103a508b0525B0b16146Ad5C0a7c719148b14c`](https://sepolia.etherscan.io/address/0x91103a508b0525B0b16146Ad5C0a7c719148b14c) | 11886838 |
| KYABridge8004 | [`0xdc39aaE1319EC81AF64F72B36A7F8Aa42520B850`](https://sepolia.etherscan.io/address/0xdc39aaE1319EC81AF64F72B36A7F8Aa42520B850) | 11886851 |
| Groth16Verifier (circuit rev 3, 15 signals; reused from revision 4) | [`0x64c18C506e8a202d98822F97911dF774e9b85f85`](https://sepolia.etherscan.io/address/0x64c18C506e8a202d98822F97911dF774e9b85f85) | 11744756 |
| Groth16KYAVerifierAdapter (epoch 30 d, grace 1, pinned root; reused from revision 4) | [`0x7C424db1f07d5BCA5b58Dc4b573f31c32a70bCE7`](https://sepolia.etherscan.io/address/0x7C424db1f07d5BCA5b58Dc4b573f31c32a70bCE7) | 11744757 |

Demo agent on the official ERC-8004 IdentityRegistry: **agentId 10387**. Schemes (rule identities: chainId + scheme registry, no registry of use): attested `0x928e5f455d77881a4e9bec600236a5d1124c8176fb174c90b2b89aa9b6375907` (binding `controller`, `ORDERED_LEVEL`, `levelMask 0xf` = levels 0–3), proved (ZK) `0x50daf587aadc42f6f6d0e32376874054cddda59b41656c844e8a0d5e8f0d8a99` (`ORDERED_LEVEL`, `levelMask 0x11` = levels 0 and 4). Worked examples: [registerScheme (SchemeInput)](https://sepolia.etherscan.io/tx/0x0292c40a232fa566e01102b48b21f8ee66fb6833b59c0c83f362bbded6179173) · [setMetadata "kya"](https://sepolia.etherscan.io/tx/0xb77d28bd76f9be23820c98933ccfa641d57024cca88d91e9b722d21a5c65b405) · [attest](https://sepolia.etherscan.io/tx/0x364b326523fe0abc313493f81ad1b673a7f6b8513e904a33625e134a4147f4d7) (controller witness recorded) · [attestWithProof (Groth16 rev 3, epoch 691, nullifier scoped to this registry's admission domain, anchor = issuer-set root)](https://sepolia.etherscan.io/tx/0x842e9351fc8fb1ea6e483e86bb9e40d92567ed2c11ed0cad5b9f2946f680f4e9) · [policy (policyId commits rulesHash; both rules ordered, minLevel > 0)](https://sepolia.etherscan.io/tx/0x283d6dd312ad6b2c74b75295ded0ddd04fe274bc03784a06b68e4d88f3be85a2) · bridge [configure (configHash; responseMap covers the mask)](https://sepolia.etherscan.io/tx/0x80aaf1196ec5b80b85e8be1ab24210d9e4ef04e72bd3ec20b9a2e34001a3cd8f) → [request (stable requestHash)](https://sepolia.etherscan.io/tx/0xf242c18a0a9cf37a7da2cc91b818907b0a9857f94688549ce240a5994cff0870) → [sync](https://sepolia.etherscan.io/tx/0x3bc8f88877ef7dc59d830975690d0c9e4f790fb6fbef4ff92804ecfd550993e1) (60/100 under the full-schemeId tag, `responseHash = H(assertionId, level, configHash)`, `getSummary(agent, [bridge], tag)` count 1). Read back on-chain: `resultDomain` returns `(0, 0xf)` / `(0, 0x11)`; `attest(…, level 9)` reverts `KYA_LevelNotDeclared`; `check(…, minLevel 0)` reverts `KYA_ZeroThreshold`; `check(…, 2)` is true and `check(…, 3)` false for the level-2 assertion; the revision-4 proof reverts `KYA_VerifierRejected` here and a replay of the admitted proof reverts `KYA_NullifierUsed`. The demo descriptors now carry `eip-8419` `type` URIs.

Ownership: bridge owner and both scheme controllers are still the deployer key until the maintainer supplies an address; the transfer transactions will be recorded in `deployments/ownership.json`.

## Key derivations

| value | formula |
|---|---|
| `subjectKey` | `keccak256(abi.encode(subjectType, subjectData))` |
| `erc8004` subject | `subjectType = keccak256("erc8004")`, `subjectData = abi.encode(chainId, identityRegistry, agentId)` |
| `schemeId` | `keccak256(abi.encode(chainId, schemeRegistry, controller, schemeHash, controllerNonce))` — a rule identity; reusable by several KYA Registries |
| `levelMask` / `resultKind` | immutable per scheme; bit `n` of `levelMask` set ⇔ level `n` is a valid result. `ORDERED_LEVEL`: bit 0 plus at least one higher bit · `CATEGORICAL`: any non-zero mask · `OPAQUE`: exactly bit 0. `attest`/`attestWithProof` revert on an undeclared level; `check`/`resolve`/policy/bridge accept ordered schemes only |
| `admissionDomain` | `keccak256(abi.encode(keccak256("erc-kya-registry-admission-v1"), chainId, schemeRegistry, kyaRegistry))` — computed by the admitting KYA Registry, passed to `IKYAVerifier.verify`; proofs and nullifiers are scoped to it |
| `assertionId` | `keccak256(abi.encode(subjectKey, schemeId, issuer, issuerNonce))` |
| `policyId` | `keccak256(abi.encode(owner, policyHash, rulesHash, ownerNonce))`, `rulesHash = keccak256(abi.encode(Rule[] allOf))` or `0x0` |
| binding witness | `controller`: `keccak256(abi.encode(ownerOf(agentId)))` at issuance · `instance`: `claimDigest` · `identity`: `0x0` |
| bridge `configHash` | `keccak256(abi.encode(schemeId, trustedIssuers, responseMap))` |
| bridge `requestHash` | `keccak256(abi.encode(keccak256("erc-kya-request-v1"), chainId, identityRegistry, bridge, agentId, schemeId))` — stable; configuration lives in `responseHash` |
| bridge `responseHash` | `keccak256(abi.encode(assertionId, level, configHash))` |
| bridge `tag` | `"kya:" + full schemeId as 64 lowercase hex chars` |
| ZK `publicInputs` (kya-public-v1) | `abi.encode(subjectKey, nullifier, level, claimDigest, expiresAt, issuerSetRoot, epoch)` — adapter appends `schemeId` and `admissionDomain` as signals (15 total) and enforces `current-epochGrace ≤ epoch ≤ current` |
| ZK nullifier (circuit rev 3) | `Poseidon(secret, schemeId.hi, .lo, admissionDomain.hi, .lo, epoch)` |
| ZK credential (unchanged since circuit rev 2) | attestor signs `Poseidon(subjectKey.hi, .lo, schemeId.hi, .lo, level, claimDigest.hi, .lo, expiresAt, Poseidon(secret))` |

## Relationship to other standards

- **ERC-8004 Trustless Agents** — primary subject type and mirror target. No changes to 8004 contracts required.
- **ERC-8143 Smart Credential Resolution** — a single-function credential fetch interface that mentions KYA and ZKPs; this ERC provides the scheme/level/admission/revocation semantics it lacks and can expose an 8143-style view (`getCredential("kya:"+schemeId)`).
- **EAS and similar attestation services** — can serve as a storage layer beneath a KYA Registry; this ERC defines the agent-KYA semantic layer, not another generic attestation primitive.
- **Token-bound skill / task standards (ERC-8338, ERC-8414)** — informative use cases: skill sellers and task fulfillers present KYA assertions; task descriptors reference a `policyId`.

## Filing as an ethereum/ERCs PR

`tools/prepare-pr.sh <path-to-ERCs-fork> <number>` copies `ERCS/erc-kya.md` to `ERCS/erc-<number>.md`, `assets/erc-kya/` to `assets/erc-<number>/`, (the sources already carry the assigned number 8419; the script is kept for renumbering if ever needed). Work on a fresh branch (`add-erc-kya`) cut from the latest `upstream/master`; never commit to `master`.

## License

CC0-1.0
