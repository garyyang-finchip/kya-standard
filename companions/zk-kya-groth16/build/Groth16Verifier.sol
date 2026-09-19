// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 18344223154136949416641211372874180897464910617073595784307727455081622525217;
    uint256 constant alphay  = 19117610578866676049114083603298527973863121245209816415847151800989738705423;
    uint256 constant betax1  = 16969729569276880345023130609057728644194315496381690517826448104678873513141;
    uint256 constant betax2  = 16648759533051303959527134035721087773100497099566326726072559830980967422957;
    uint256 constant betay1  = 10763582516104689534648331633166995650312937869860559414473228683924067213209;
    uint256 constant betay2  = 236589408524288953789259950828054692738430061911137464976939239728524648810;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 19711617913553225302460953770305002633734065349158063324471270262721452476491;
    uint256 constant deltax2 = 11851060010379052126420143455348985623014769832072298560527099293118139380653;
    uint256 constant deltay1 = 16800870686355797686849172162751592411954998245604528381169750315353596645809;
    uint256 constant deltay2 = 4974998096854129078678677228597116574046633262620117631776187067475354710615;

    
    uint256 constant IC0x = 13569594553546193858080722873357882171384855769728490979894907809106541416131;
    uint256 constant IC0y = 14012214217495664179934420142637825885831967306507898714072964865516693476864;
    
    uint256 constant IC1x = 2847260174851879984613045005349026040479313343635804987216335747835897648861;
    uint256 constant IC1y = 7438679941140078367147077683784281191286376431441890828360316654264290122505;
    
    uint256 constant IC2x = 18505898151873635936131856011094757484299337295004476838806502739120135533208;
    uint256 constant IC2y = 4629781670528635452422195324865588991756724176867482578100567648742552138177;
    
    uint256 constant IC3x = 18804845448079933835121354194226083743278851975457567866586190358682500555077;
    uint256 constant IC3y = 207320695746564263576038209476654988081544276880105260340012727483429609480;
    
    uint256 constant IC4x = 12579599870451295084277992576218191321155031661563070140961308059905608574724;
    uint256 constant IC4y = 21603719660572501646483929173222741918243821454028459333665556193622478748732;
    
    uint256 constant IC5x = 15474928424751092550713478637237464091657669218652330562804481638365838496343;
    uint256 constant IC5y = 17134897032644197922834373011489234970091858317086288505897002180386416907192;
    
    uint256 constant IC6x = 4136344123335568171842066628513135777563729863732910473850667297017136052350;
    uint256 constant IC6y = 12379135099931891696739418322643515427712561957418886310240927322670943114604;
    
    uint256 constant IC7x = 11036532999773398232380638661769228118029057227170878097981722534573867406112;
    uint256 constant IC7y = 14060969952732737522835317979971544806052030797147506606377535972307031985745;
    
    uint256 constant IC8x = 6146399348758470611832802128603276977792123699085139524926459358305755573689;
    uint256 constant IC8y = 1028294086278761575245322634523249693983941818600633320994069866566308793828;
    
    uint256 constant IC9x = 2712985068158957286780562853909589000239005712621588257958769130459931973447;
    uint256 constant IC9y = 21851063369414606848390106034986139416526837141108818022574317232905406264061;
    
    uint256 constant IC10x = 6012760354160599824441027768412629752103178929769996228279347628719892380832;
    uint256 constant IC10y = 12386261245904654398503584616938035912000598583054332405287703314042136857668;
    
    uint256 constant IC11x = 4153801860836547651925139893174669511192792930470113251302676224455718289254;
    uint256 constant IC11y = 3284258003996163525385547856334012600517716225350391275073736678228004958027;
    
    uint256 constant IC12x = 109674552935462385093857979595114547665963937402859402498820148291107449582;
    uint256 constant IC12y = 688582521501886802636383553468059139134173136118858185460694549782781593036;
    
    uint256 constant IC13x = 16076511472900731519102805488577649410235926210628537583305568694817528817376;
    uint256 constant IC13y = 14231532894846851544150746705110500645482359502979546902887319226862195044102;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[13] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
