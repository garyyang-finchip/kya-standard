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

### Deployed addresses

> **Revision note (2026-09-19, later the same day).** After an external design review the contracts and circuit were revised: scheme semantics made immutable, `anchor` added to assertions, `IKYAVerifier.verify` gained `anchor`, the adapter now enforces the epoch window and the attestor credential is scheme-bound (circuit revision 2), the bridge `requestHash` includes the bridge address and unmapped levels revert. **The addresses below are the revision-1 deployment and are superseded**; the revision-2 deployment will be recorded here and in `deployments/sepolia.json` once broadcast.

Deployed 2026-09-19 (chainId 11155111) — **revision 1, superseded**. Full records with every tx hash: [`deployments/sepolia.json`](deployments/sepolia.json) and [`deployments/sepolia-examples.json`](deployments/sepolia-examples.json).

| contract | address | block |
|---|---|---|
| KYASchemeRegistry | [`0xEe9BDEc0790Edd42fC0aB35fa6cF1966D85A4044`](https://sepolia.etherscan.io/address/0xEe9BDEc0790Edd42fC0aB35fa6cF1966D85A4044) | 11736593 |
| KYARegistry | [`0xBFCC1ABc83a0caC5E76348738c551BfAae0a09f5`](https://sepolia.etherscan.io/address/0xBFCC1ABc83a0caC5E76348738c551BfAae0a09f5) | 11736594 |
| KYAPolicyRegistry | [`0xeF72BF34e340DE3E2047fa8d226cF9Dc8c58eD93`](https://sepolia.etherscan.io/address/0xeF72BF34e340DE3E2047fa8d226cF9Dc8c58eD93) | 11736595 |
| ValidationRegistry8004 | [`0x281e9B657d89b0729e51B9031787A00870cAa9aa`](https://sepolia.etherscan.io/address/0x281e9B657d89b0729e51B9031787A00870cAa9aa) | 11736596 |
| KYABridge8004 | [`0x44C1E906CEE7A3b336Ca23E58F0fae7d3AFbCe1A`](https://sepolia.etherscan.io/address/0x44C1E906CEE7A3b336Ca23E58F0fae7d3AFbCe1A) | 11736597 |
| Groth16Verifier | [`0xF8a260a0b9443B03E8435ac21f22075976110f8C`](https://sepolia.etherscan.io/address/0xF8a260a0b9443B03E8435ac21f22075976110f8C) | 11736598 |
| Groth16KYAVerifierAdapter | [`0x540B7651FA94Cd586599Deb478893D800bc3C2d8`](https://sepolia.etherscan.io/address/0x540B7651FA94Cd586599Deb478893D800bc3C2d8) | 11736599 |

Demo agent on the official ERC-8004 IdentityRegistry: **agentId 10387** ([register tx](https://sepolia.etherscan.io/tx/0xafb9f5eeac1e34500707f12a48ed75fc8e71681b948bff1c65ed0d2ebf5b36de)). Schemes: attested `0xc3d44c830a5c118f980f48317b97e9eaa920a7bbd204c7d3595ac191d4726764`, proved (ZK) `0xb7285a191e9264579d633cf4b2ddd435eeb56c93cf5d08d01afc13134cf376ad`. Worked examples: [attest](https://sepolia.etherscan.io/tx/0x9199573fa67a028ce4d2dd767d014e42d8644c0f4056116689a7e31f56b2d452) · [attestWithProof (Groth16)](https://sepolia.etherscan.io/tx/0x7df3c4ad5d651594800d335cc0f04f872d35ced95ec994d39b60ba9570c88c1d) · [policy](https://sepolia.etherscan.io/tx/0xfc3058f2614bc9d4580245f652c14c774336dbc274a65fdce8671e7065a9f25a) · bridge [request](https://sepolia.etherscan.io/tx/0xbf990cb45aeed07b3fd7dd12171d6147824b9b95c9ce2b6bc22da7e4d5d30e3d) → [sync](https://sepolia.etherscan.io/tx/0xdab38a990047a7e3bb1a11a76a3fcc4322861ceb9e4dd59fecc3372fc9fd4a81) (mirrored 60/100 under tag `kya:c3d44c83`).

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
