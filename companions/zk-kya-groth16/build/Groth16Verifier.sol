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
    uint256 constant deltax1 = 18669218000142959309343365925767159687912521162524508066557045789524296084570;
    uint256 constant deltax2 = 9929782741176116283443303901569696613406251042032433218547665539599928711455;
    uint256 constant deltay1 = 21794908066913238681337721269580159238265696411905588274338731269923173906227;
    uint256 constant deltay2 = 9568420324521813171735719148772040133182610183754440695572999124216593424408;

    
    uint256 constant IC0x = 1230417080860694287002272247351835154645670714278890524796729865330350155550;
    uint256 constant IC0y = 16666418412730476734844169434074707471283690467941409811116286164096450932336;
    
    uint256 constant IC1x = 6944846641718540939144094267341873454396896114155671076961328191387956096165;
    uint256 constant IC1y = 2378070104591811527148596707075397971224181209416638808153928542621079614038;
    
    uint256 constant IC2x = 14728645342419927061660543285589552110383414186920456689963385581574823507180;
    uint256 constant IC2y = 2676788702766315803567757886459226661604089789965348877443016729308028417327;
    
    uint256 constant IC3x = 13508766958112772394959131472701944968744172999888244919758123445219349826859;
    uint256 constant IC3y = 20681503544161919989249842482273004317390064581540504593005928228839852499432;
    
    uint256 constant IC4x = 5023197528472541951732129962817907781820370888371286446538590262262552068363;
    uint256 constant IC4y = 11711481741544851343438588985027556849595442097306775008118269146518514396068;
    
    uint256 constant IC5x = 10958995999203165754851738289163820142627925755710116103708922858718102391773;
    uint256 constant IC5y = 13749111966896380274725835711039044073451145746190250940877203246590995703884;
    
    uint256 constant IC6x = 7581628253600575635395385306623960872868175633630945713910612863993681250181;
    uint256 constant IC6y = 6926278130901001943908525700044332212765804675757517178237449947484295740440;
    
    uint256 constant IC7x = 62808911180749816920358074249093772776467418568980560472595867591480110136;
    uint256 constant IC7y = 3107732685635678957234224707908853284806991514592450036555897169297073541673;
    
    uint256 constant IC8x = 1366866982538742819816015730746572854053354849554222476168857451341144814118;
    uint256 constant IC8y = 12529871511774352028575993698677288505363790350021473540432936690926443192369;
    
    uint256 constant IC9x = 19760492876540975142189839376676702535312498020547256958410439830486507985379;
    uint256 constant IC9y = 14145185686565395904498696530268832317933672826595069037567177383544818646043;
    
    uint256 constant IC10x = 13817086654056054976586626585629438418529295272287188738705265870442027681138;
    uint256 constant IC10y = 14598156126896729114860088370207699046168599130751811508418362294120021084014;
    
    uint256 constant IC11x = 20967244887421381620513895536295158033364677227511973225129036273805744466572;
    uint256 constant IC11y = 4128319839621316012309585151305096237635487984142741377935147198301906612477;
    
    uint256 constant IC12x = 6091318997586752898234877212728786741899769061800101670162952953348119967375;
    uint256 constant IC12y = 17615869888401063017136112474126153730488530634276730829716079636571729446909;
    
    uint256 constant IC13x = 1711729184241106053238988591533161587209500370684840591842703228817758616061;
    uint256 constant IC13y = 19138759356713498404491263530286973524732868408788888996690874989250733722043;
    
 
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
