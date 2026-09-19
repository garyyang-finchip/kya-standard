#!/usr/bin/env bash
# TEST-ONLY single-party Groth16 setup for the kya_public_v1 circuit. ~15 min on 2 cores.
set -euo pipefail
cd "$(dirname "$0")/build"
SNARK="../../../node_modules/.bin/snarkjs"
[ -f kya_public_v1.r1cs ] || { echo "run npm run zk:compile first"; exit 1; }
$SNARK powersoftau new bn128 15 pot15_0000.ptau
$SNARK powersoftau contribute pot15_0000.ptau pot15_0001.ptau --name="kya-test-ceremony" -e="$(head -c 64 /dev/urandom | base64)"
$SNARK powersoftau prepare phase2 pot15_0001.ptau pot15_final.ptau
$SNARK groth16 setup kya_public_v1.r1cs pot15_final.ptau kya_0000.zkey
$SNARK zkey contribute kya_0000.zkey kya_final.zkey --name="kya-test-phase2" -e="$(head -c 64 /dev/urandom | base64)"
$SNARK zkey export verificationkey kya_final.zkey verification_key.json
$SNARK zkey export solidityverifier kya_final.zkey Groth16Verifier.sol
echo "done: kya_final.zkey, verification_key.json, Groth16Verifier.sol"
