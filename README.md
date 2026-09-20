# Know-Your-Agent (KYA) Framework — ERC draft

A scheme-agnostic registry and handshake standard for recording, resolving and presenting **trust assertions about AI agents**, with a **zero-knowledge (ZK-KYA) profile** and a normative **ERC-8004 binding**.

> Status: Draft · placeholder number `9999` until an EIP editor assigns one · discussion thread: https://ethereum-magicians.org/t/draft-erc-know-your-agent-kya-framework-trust-assertions-for-agents-zk-kya-profile-erc-8004-binding/29735

## What it is — in one paragraph

ERC-8004 gives agents identity and raw trust *signals*. This ERC gives the agent economy a shared container for trust *conclusions*: a **Scheme Registry** that addresses and versions KYA principles (what is checked, what it binds to — identity / controller / instance — how the result is expressed, how assertions are admitted; semantics immutable per `schemeId`), a **KYA Registry** that records assertions (subject · scheme · issuer · result · validity · anchor · revocation) and resolves them under a relying party's chosen issuers, an **EIP-712 handshake** with normative acceptance rules, and a minimal **Policy Registry** (base + optional on-chain evaluator). The framework never defines a KYA algorithm or a credit rule — those live in scheme descriptors and pluggable `IKYAVerifier` contracts. **ZK-KYA is a mode of the same registry**, not a second standard: an assertion is admitted by a verifier contract checking a proof instead of by an issuer's signature; it hides the fact issuer and the facts, not the subject. Two usage patterns (combinable) fit the same interface — *credential* (a hidden issuer signed a verdict in advance; the reference circuit) and *predicate* (the scheme is the decision rule, the prover evaluates it over its own authenticated data, and only the verdict is presented — no pre-issued credit verdict, no raw data sent to the counterparty; the reference implementation does not yet include a predicate circuit) — see ERC §5.1. A **KYA Bridge** optionally mirrors a lossy snapshot into the ERC-8004 Validation Registry so ERC-8004-only clients see it under a `kya:` tag.

```
L4  Policy          "counterparty must satisfy (scheme, minLevel, issuers) …"
L3  Handshake       KYAChallenge / KYAPresentation (EIP-712) · /.well-known/kya.json
L2  KYA Registry    attest() | attestWithProof()  →  resolve() / check()
L1  Scheme Registry registerScheme(descriptorURI, hash, mode, verifier, predecessor)
L0  Subject         erc8004 (MUST) · account · erc721 · did
        ▲ ERC-8004 identity + signals as input      │ KYABridge8004 → Validation Registry (tag "kya:…")
```

## Repository layout

```
ERCS/erc-kya.md                     the ERC text (EIP-1 format, placeholder 9999)
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
test/kya.test.js                    in-process EVM end-to-end suite (18 cases + 6 regression cases from review rounds 1–2 (R1–R6), no RPC needed)
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

### Deployed addresses (revision 4, current)

Deployed 2026-09-20 (chainId 11155111) after the second round of external review ("Admission Domain + Continuous Mirror"). Full records with every tx hash: [`deployments/sepolia.json`](deployments/sepolia.json) and [`deployments/sepolia-examples.json`](deployments/sepolia-examples.json). Earlier deployments are kept for the record (`sepolia-r1.json`, `sepolia-r2.json`, `sepolia-r3.json`, the withdrawn `sepolia-r4-draft.json`, and their `-examples` files) and **must not be relied on**; in particular their bridges' records in their own Validation Registries are not part of the current query path.

| contract | address | block |
|---|---|---|
| KYASchemeRegistry | [`0x946F20056944640ECf2Af2C05D71ec384AFA4d5D`](https://sepolia.etherscan.io/address/0x946F20056944640ECf2Af2C05D71ec384AFA4d5D) | 11744752 |
| KYARegistry (`admissionDomain()` = `0x08521d80…34f5`) | [`0xCaeE3d765871096FD1fcC2C9C13CEe2155BaaFdb`](https://sepolia.etherscan.io/address/0xCaeE3d765871096FD1fcC2C9C13CEe2155BaaFdb) | 11744752 |
| KYAPolicyRegistry | [`0x4689d5569Af043920A6F939A72589C9350437845`](https://sepolia.etherscan.io/address/0x4689d5569Af043920A6F939A72589C9350437845) | 11744752 |
| ValidationRegistry8004 | [`0x032D4aCa0F86707c9d331C11A382E6989CFE8aB9`](https://sepolia.etherscan.io/address/0x032D4aCa0F86707c9d331C11A382E6989CFE8aB9) | 11744753 |
| KYABridge8004 | [`0x9079bb07698e1045EAc13e531B9AdBe1a7cDB261`](https://sepolia.etherscan.io/address/0x9079bb07698e1045EAc13e531B9AdBe1a7cDB261) | 11744756 |
| Groth16Verifier (circuit rev 3, 15 signals) | [`0x64c18C506e8a202d98822F97911dF774e9b85f85`](https://sepolia.etherscan.io/address/0x64c18C506e8a202d98822F97911dF774e9b85f85) | 11744756 |
| Groth16KYAVerifierAdapter (epoch 30 d, grace 1, pinned root) | [`0x7C424db1f07d5BCA5b58Dc4b573f31c32a70bCE7`](https://sepolia.etherscan.io/address/0x7C424db1f07d5BCA5b58Dc4b573f31c32a70bCE7) | 11744757 |

Demo agent on the official ERC-8004 IdentityRegistry: **agentId 10387**. Schemes (rule identities: chainId + scheme registry, no registry of use): attested `0x1b9a269407206381fc794c8fb9f089f26e793a43033bf7df5984b0b7408bffbd` (binding `controller`, ordered-level), proved (ZK) `0xe8b5ebea4a171970b3d596228e53b95736e44032fcf766b5505e742379031a14`. Worked examples: [setMetadata "kya"](https://sepolia.etherscan.io/tx/0x1ea72463cebc89ed03f3f00b88becb74fa51ff4d0aa870a0ecd5c71684b010f6) · [attest](https://sepolia.etherscan.io/tx/0x1b22ffafe965564ec3e8fe7996f8a9fc031440ca026326a2892622d4adf27029) (controller witness recorded) · [attestWithProof (Groth16 rev 3, epoch 690, nullifier scoped to this registry's admission domain, anchor = issuer-set root)](https://sepolia.etherscan.io/tx/0x0fe2b0c21d98e170405a3d9d9b6621441260e5b45fde7eb31a2b2fbff36da324) · [policy (policyId commits rulesHash)](https://sepolia.etherscan.io/tx/0x06276a41a5c6c2e49561b2bd4368e3179d83c513e2de0fc93ee55ffca44e42cb) · bridge [configure (configHash)](https://sepolia.etherscan.io/tx/0xc53af4d4adc3ea167dafce121b15402bac54163cb64dc5a03a90a70605465569) → [request (stable requestHash)](https://sepolia.etherscan.io/tx/0x7c1bee4c7dd485bded377a8eeb97d21b99c289a4998b2ed05661d5b7aa6d7e28) → [sync](https://sepolia.etherscan.io/tx/0xbf0943984aa50aaca3e5c32ffaddd8e92f470024582a52747eb81ae4f7b11702) (60/100 under the full-schemeId tag, `responseHash = H(assertionId, level, configHash)`, `getSummary(agent, [bridge], tag)` count 1). Read back on-chain: the adapter accepts the recorded proof under this registry's domain and rejects the identical proof under another registry's domain.

Ownership: bridge owner and both scheme controllers are still the deployer key until the maintainer supplies an address; the transfer transactions will be recorded in `deployments/ownership.json`.

## Key derivations

| value | formula |
|---|---|
| `subjectKey` | `keccak256(abi.encode(subjectType, subjectData))` |
| `erc8004` subject | `subjectType = keccak256("erc8004")`, `subjectData = abi.encode(chainId, identityRegistry, agentId)` |
| `schemeId` | `keccak256(abi.encode(chainId, schemeRegistry, controller, schemeHash, controllerNonce))` — a rule identity; reusable by several KYA Registries |
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

`tools/prepare-pr.sh <path-to-ERCs-fork> <number>` copies `ERCS/erc-kya.md` to `ERCS/erc-<number>.md`, `assets/erc-kya/` to `assets/erc-<number>/`, and rewrites the `9999` placeholders. Work on a fresh branch (`add-erc-kya`) cut from the latest `upstream/master`; never commit to `master`.

## License

CC0-1.0
