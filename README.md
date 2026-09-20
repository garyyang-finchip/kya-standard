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
    verifiers/Groth16KYAVerifierAdapter.sol   snarkjs-style Groth16 → IKYAVerifier (kya-public-v1, 13 signals, epoch window enforced on-chain)
    companions/ValidationRegistry8004.sol     spec-conforming ERC-8004 Validation Registry (canonical one not yet deployed)
    mocks/Mocks.sol                 test-only identity registry and verifiers
  schemas/                          kya-scheme / kya-policy / kya-discovery JSON Schemas
  vectors/                          vectors.json + example descriptors
tools/compile.js                    solc-js build → build/artifacts.json
tools/vectors.js                    regenerates vectors.json
tools/prepare-pr.sh                 lays the files out as an ethereum/ERCs PR
test/kya.test.js                    in-process EVM end-to-end suite (18 cases + 6 revision-3 regression cases, no RPC needed)
test/zk.test.js                     real Groth16 proof → Verifier.sol → adapter → KYARegistry, incl. adversarial + cross-registry cases (15 cases)
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

### Deployed addresses (revision 3, current)

Deployed 2026-09-20 (chainId 11155111) after the second external review. Full records with every tx hash: [`deployments/sepolia.json`](deployments/sepolia.json) and [`deployments/sepolia-examples.json`](deployments/sepolia-examples.json). Earlier deployments are kept for the record (`sepolia-r1.json`, `sepolia-r2.json` and their `-examples` files) and **must not be relied on**.

| contract | address | block |
|---|---|---|
| KYASchemeRegistry | [`0x9b11BF52d64Bc3933D974A6461CfdE733a11AA75`](https://sepolia.etherscan.io/address/0x9b11BF52d64Bc3933D974A6461CfdE733a11AA75) | 11740808 |
| KYARegistry | [`0xcac761d7AD0C99a1df65a239c599a004Dd16028f`](https://sepolia.etherscan.io/address/0xcac761d7AD0C99a1df65a239c599a004Dd16028f) | 11740808 |
| KYAPolicyRegistry | [`0x68016fdC949f81025d5D91Ce2016F8ae55bc18Cf`](https://sepolia.etherscan.io/address/0x68016fdC949f81025d5D91Ce2016F8ae55bc18Cf) | 11740808 |
| ValidationRegistry8004 | [`0xecB7e39A6845B1e204F1d42746C676b0c8af0BD3`](https://sepolia.etherscan.io/address/0xecB7e39A6845B1e204F1d42746C676b0c8af0BD3) | 11740808 |
| KYABridge8004 | [`0x4965e40900CBE94293dC43846C289eE2E13c32E9`](https://sepolia.etherscan.io/address/0x4965e40900CBE94293dC43846C289eE2E13c32E9) | 11740812 |
| Groth16Verifier (circuit rev 2) | [`0x20B92472C1e4F9EddD4976FA91232e58d2003FcE`](https://sepolia.etherscan.io/address/0x20B92472C1e4F9EddD4976FA91232e58d2003FcE) | 11740812 |
| Groth16KYAVerifierAdapter (epoch 30 d, grace 1, pinned root) | [`0x23bceea25a69Ce9B3B5CC5a4D8dc3DfEf0967061`](https://sepolia.etherscan.io/address/0x23bceea25a69Ce9B3B5CC5a4D8dc3DfEf0967061) | 11740812 |

Demo agent on the official ERC-8004 IdentityRegistry: **agentId 10387**. Schemes (ids now embed chainId + registry): attested `0x952fa40d0a5836d65a8049b3e0f051c489c9c6d8f62bbb9f6c8d16b18917a676` (binding `controller`, ordered-level), proved (ZK) `0x63fe9b9c75341680bbb485692e0dd011c0dcefe68b026307c48aa3cbf150e27c`. Worked examples: [setMetadata "kya"](https://sepolia.etherscan.io/tx/0x1cdfbb7c1c9aa55a37f7ebc7a77c2f5c0e5c09d541d9e56314ae925035e0e724) · [attest](https://sepolia.etherscan.io/tx/0x591d8d4e78664d904b8337a0f60cf5a1e795869b262aa0c3c092a78c2c6d0876) (controller witness recorded, `bindingStatus` = SATISFIED) · [attestWithProof (Groth16, epoch 690, anchor = issuer-set root)](https://sepolia.etherscan.io/tx/0x7027a7e03064fe893fd566f4c7f38f298d5e3d7a8553aa4d603c25ff360673df) · [policy (policyId commits rulesHash)](https://sepolia.etherscan.io/tx/0x98618cd84a6b02c9731cf58153b3cb535cb9edce411f8d54bb252322c91b66c1) · bridge [configure (configHash)](https://sepolia.etherscan.io/tx/0x1d123fa9c107d4c2a2e295f7670ff0e41a2e91f1ea4e0d48563c1826bb419333) → [request](https://sepolia.etherscan.io/tx/0x3ae75510207caadb09e2061cb132578b925a70eae871516ae297521c4d054051) → [sync](https://sepolia.etherscan.io/tx/0xc45f43ba441948f66e92eca3ba0a5be9a0a33dc61d28c6f267e072b3c7280c4c) (60/100 under the full-schemeId tag, `responseHash = H(assertionId, level, configHash)`).

Ownership: bridge owner and both scheme controllers are still the deployer key until the maintainer supplies an address; the transfer transactions will be recorded in `deployments/ownership.json`.

## Key derivations

| value | formula |
|---|---|
| `subjectKey` | `keccak256(abi.encode(subjectType, subjectData))` |
| `erc8004` subject | `subjectType = keccak256("erc8004")`, `subjectData = abi.encode(chainId, identityRegistry, agentId)` |
| `schemeId` | `keccak256(abi.encode(chainId, schemeRegistry, controller, schemeHash, controllerNonce))` |
| `assertionId` | `keccak256(abi.encode(subjectKey, schemeId, issuer, issuerNonce))` |
| `policyId` | `keccak256(abi.encode(owner, policyHash, rulesHash, ownerNonce))`, `rulesHash = keccak256(abi.encode(Rule[] allOf))` or `0x0` |
| binding witness | `controller`: `keccak256(abi.encode(ownerOf(agentId)))` at issuance · `instance`: `claimDigest` · `identity`: `0x0` |
| bridge `configHash` | `keccak256(abi.encode(schemeId, trustedIssuers, responseMap))` |
| bridge `requestHash` | `keccak256(abi.encode(keccak256("erc-kya-request-v1"), chainId, identityRegistry, bridge, configHash, agentId, schemeId))` |
| bridge `responseHash` | `keccak256(abi.encode(assertionId, level, configHash))` |
| bridge `tag` | `"kya:" + full schemeId as 64 lowercase hex chars` |
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
