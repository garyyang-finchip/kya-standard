# Know-Your-Agent (KYA) Framework — ERC draft

A scheme-agnostic registry and handshake standard for recording, resolving and presenting **trust assertions about AI agents**, with a **zero-knowledge (ZK-KYA) profile** and a normative **ERC-8004 binding**.

> Status: Draft · placeholder number `9999` until an EIP editor assigns one · discussion thread: https://ethereum-magicians.org/t/draft-erc-know-your-agent-kya-framework-trust-assertions-for-agents-zk-kya-profile-erc-8004-binding/29735

## What it is — in one paragraph

ERC-8004 gives agents identity and raw trust *signals*. This ERC gives the agent economy a shared container for trust *conclusions*: a **Scheme Registry** that addresses and versions KYA principles (what is checked, what it binds to — identity / controller / instance — how the result is expressed, how assertions are admitted; semantics immutable per `schemeId`), a **KYA Registry** that records assertions (subject · scheme · issuer · result · validity · anchor · revocation) and resolves them under a relying party's chosen issuers, an **EIP-712 handshake** with normative acceptance rules, and a minimal **Policy Registry** (base + optional on-chain evaluator). The framework never defines a KYA algorithm or a credit rule — those live in scheme descriptors and pluggable `IKYAVerifier` contracts. **ZK-KYA is a mode of the same registry**, not a second standard: an assertion is admitted by a verifier contract checking a proof instead of by an issuer's signature; it hides the fact issuer and the facts, not the subject. A **KYA Bridge** optionally mirrors a lossy snapshot into the ERC-8004 Validation Registry so ERC-8004-only clients see it under a `kya:` tag.

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
    verifiers/Groth16KYAVerifierAdapter.sol   snarkjs-style Groth16 → IKYAVerifier (kya-public-v1, 13 signals, epoch window enforced on-chain)
    companions/ValidationRegistry8004.sol     spec-conforming ERC-8004 Validation Registry (canonical one not yet deployed)
    mocks/Mocks.sol                 test-only identity registry and verifiers
  schemas/                          kya-scheme / kya-policy / kya-discovery JSON Schemas
  vectors/                          vectors.json + example descriptors
tools/compile.js                    solc-js build → build/artifacts.json
tools/vectors.js                    regenerates vectors.json
tools/prepare-pr.sh                 lays the files out as an ethereum/ERCs PR
test/kya.test.js                    in-process EVM end-to-end suite (18 cases, no RPC needed)
test/zk.test.js                     real Groth16 proof → Verifier.sol → adapter → KYARegistry, incl. adversarial cases (14 cases)
companions/zk-kya-groth16/          EXPERIMENTAL reference ZK-KYA circuit (circom) + prover tooling + built keys
scripts/deploy-sepolia.js           deploys the stack to Sepolia against the official ERC-8004 IdentityRegistry
scripts/examples-sepolia.js         six worked examples on Sepolia (agent, schemes, attested, ZK, policy, bridge)
```

## Build & test

```bash
npm install
node tools/compile.js        # solc 0.8.28, optimizer on, cancun
node test/kya.test.js        # 18 end-to-end tests on an in-process EVM
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

### Deployed addresses (revision 2, current)

Deployed 2026-09-19 (chainId 11155111) after the external design review. Full records with every tx hash: [`deployments/sepolia.json`](deployments/sepolia.json) and [`deployments/sepolia-examples.json`](deployments/sepolia-examples.json). The revision-1 deployment (same day, earlier) is kept in `deployments/sepolia-r1.json` / `sepolia-examples-r1.json` for the record and **must not be relied on**: its circuit lacks the scheme-bound credential and its adapter does not enforce the epoch window.

| contract | address | block |
|---|---|---|
| KYASchemeRegistry | [`0xAc7B642a5760467178F20c984f02cc72CCCa8E3f`](https://sepolia.etherscan.io/address/0xAc7B642a5760467178F20c984f02cc72CCCa8E3f) | 11737350 |
| KYARegistry | [`0xeBf357c87639aCcC0DaA505fAAf3F6E9b079AB9f`](https://sepolia.etherscan.io/address/0xeBf357c87639aCcC0DaA505fAAf3F6E9b079AB9f) | 11737350 |
| KYAPolicyRegistry | [`0x9B53BAD4346AacB34Bac328F1d856dfa2F246cfF`](https://sepolia.etherscan.io/address/0x9B53BAD4346AacB34Bac328F1d856dfa2F246cfF) | 11737350 |
| ValidationRegistry8004 | [`0x4aD87d7D55C753c53A801ca9a23495fb4f9bAd53`](https://sepolia.etherscan.io/address/0x4aD87d7D55C753c53A801ca9a23495fb4f9bAd53) | 11737351 |
| KYABridge8004 | [`0xCcd683927d1fC03A0163B3e9FbE7fC44afFbA5e4`](https://sepolia.etherscan.io/address/0xCcd683927d1fC03A0163B3e9FbE7fC44afFbA5e4) | 11737354 |
| Groth16Verifier (circuit rev 2) | [`0xBaE26c2a9b23c37Da76c4905F9F09004dFDBc7a9`](https://sepolia.etherscan.io/address/0xBaE26c2a9b23c37Da76c4905F9F09004dFDBc7a9) | 11737354 |
| Groth16KYAVerifierAdapter (epoch 30 d, grace 1, pinned root) | [`0xbC2E1A0FF358B64288a7D4157B996C72b6Ad44cD`](https://sepolia.etherscan.io/address/0xbC2E1A0FF358B64288a7D4157B996C72b6Ad44cD) | 11737354 |

Demo agent on the official ERC-8004 IdentityRegistry: **agentId 10387** ([register tx](https://sepolia.etherscan.io/tx/0xafb9f5eeac1e34500707f12a48ed75fc8e71681b948bff1c65ed0d2ebf5b36de)). Schemes: attested `0x3673f050219a78ab695de14ae60319a2934bb220d57eb9dbeba2a2ed77bc3681` (binding `controller`, ordered-level), proved (ZK) `0xe4e030f4af9d9bfdd50e0517985dfc4689572f94c02b6bce4def064fcc9e5626`. Worked examples: [setMetadata "kya"](https://sepolia.etherscan.io/tx/0xf7c1985b57d54a041e4f1f05ff6520a571833772d86831acf073fdda01da656f) · [attest](https://sepolia.etherscan.io/tx/0x44fb70fefec69e6e114226226fbad4da51ccc49152124f3a8d794bd04a5133ac) · [attestWithProof (Groth16, epoch 690, anchor = issuer-set root)](https://sepolia.etherscan.io/tx/0x9d52d732321a29c0a8c463530bb23fdad92bc7eef83ea8cf2f96e5f51454ef0c) · [policy](https://sepolia.etherscan.io/tx/0xb9f635979ddcd43baed010955448d9f3533e56c94401cc27e13940f508dfb901) · bridge [configure](https://sepolia.etherscan.io/tx/0x19b76d05ec8b6ff28275008f37aa727b8ee71e346c6d4267bd75db4aefa1ec20) → [request](https://sepolia.etherscan.io/tx/0xc7de5adff03fed1a4ca6c38f575074c307437ad991911318406c125bba9b5b1f) → [sync](https://sepolia.etherscan.io/tx/0xc47db8f5b007ecb194d1348f3317fd472d08e701592ab8a0c3d0c601a946e6d7) (mirrored 60/100 under tag `kya:3673f050`).

Ownership: bridge owner and both scheme controllers are still the deployer key until the maintainer supplies an address; the transfer transactions will be recorded in `deployments/ownership.json`.

## Key derivations

| value | formula |
|---|---|
| `subjectKey` | `keccak256(abi.encode(subjectType, subjectData))` |
| `erc8004` subject | `subjectType = keccak256("erc8004")`, `subjectData = abi.encode(chainId, identityRegistry, agentId)` |
| `schemeId` | `keccak256(abi.encode(controller, schemeHash, controllerNonce))` |
| `assertionId` | `keccak256(abi.encode(subjectKey, schemeId, issuer, issuerNonce))` |
| `policyId` | `keccak256(abi.encode(owner, policyHash, ownerNonce))` |
| bridge `requestHash` | `keccak256(abi.encode(keccak256("erc-kya-request-v1"), chainId, identityRegistry, bridge, agentId, schemeId))` |
| bridge `tag` | `"kya:" + first 8 lowercase hex chars of schemeId` |
| ZK `publicInputs` (kya-public-v1) | `abi.encode(subjectKey, nullifier, level, claimDigest, expiresAt, issuerSetRoot, epoch)` — adapter appends `schemeId` as signals (13 total) and enforces `current-epochGrace ≤ epoch ≤ current` |
| ZK credential (rev 2) | attestor signs `Poseidon(subjectKey.hi, .lo, schemeId.hi, .lo, level, claimDigest.hi, .lo, expiresAt, Poseidon(secret))` |

## Relationship to other standards

- **ERC-8004 Trustless Agents** — primary subject type and mirror target. No changes to 8004 contracts required.
- **ERC-8143 Smart Credential Resolution** — a single-function credential fetch interface that mentions KYA and ZKPs; this ERC provides the scheme/level/admission/revocation semantics it lacks and can expose an 8143-style view (`getCredential("kya:"+schemeId)`).
- **EAS and similar attestation services** — can serve as a storage layer beneath a KYA Registry; this ERC defines the agent-KYA semantic layer, not another generic attestation primitive.
- **Token-bound skill / task standards (ERC-8338, ERC-8414)** — informative use cases: skill sellers and task fulfillers present KYA assertions; task descriptors reference a `policyId`.

## Filing as an ethereum/ERCs PR

`tools/prepare-pr.sh <path-to-ERCs-fork> <number>` copies `ERCS/erc-kya.md` to `ERCS/erc-<number>.md`, `assets/erc-kya/` to `assets/erc-<number>/`, and rewrites the `9999` placeholders. Work on a fresh branch (`add-erc-kya`) cut from the latest `upstream/master`; never commit to `master`.

## License

CC0-1.0
