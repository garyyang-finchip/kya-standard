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
    uint256 constant deltax1 = 2228246010303696307322607235332628450489921028809947649117517321760761861526;
    uint256 constant deltax2 = 8192842372116142905450647628790787309741430540059064744791623862463988839262;
    uint256 constant deltay1 = 1454706418511646298836715897392585444409779719553806963322289276064270221040;
    uint256 constant deltay2 = 4690217297495159838076216476556918559982559924090580944119536056304611183195;

    
    uint256 constant IC0x = 1762653633899566970689892424890300651629242211713893681019038093970019377335;
    uint256 constant IC0y = 20804115185301019001244032206432997024195313884640563749673400648302048020805;
    
    uint256 constant IC1x = 2485409270449031085649646819940304810538806745128586286898228799102198461579;
    uint256 constant IC1y = 500602970013976998455783324513070052839807687112210727351964342460922966323;
    
    uint256 constant IC2x = 7538979900546871258273433556688363729995622902001769173679163600463428754239;
    uint256 constant IC2y = 6371224405671168948790988210869568465835715334074530819266205963877282028304;
    
    uint256 constant IC3x = 9324558341015832044563167525097677863463907396233037873178733556267426934821;
    uint256 constant IC3y = 21715311263662441650098185932450694245366706728704394376987374035213408536952;
    
    uint256 constant IC4x = 16811582375858847127275506447913882811903837560039193110503630864991203449426;
    uint256 constant IC4y = 3105923658891155042878112887460614768098488738610948273203287864138923843883;
    
    uint256 constant IC5x = 20004535704445077127647504125449655416664735754925931025068305271468816822346;
    uint256 constant IC5y = 113647046213890827013349929111932315305439092085938702057337798067335769195;
    
    uint256 constant IC6x = 20339895157104339972210163184126824054748614708463389291837470705307584937377;
    uint256 constant IC6y = 422508290772677572079088163219932369418673718053687622252915971182556349911;
    
    uint256 constant IC7x = 7423631992410537354473650879307223614131466552478536047840910126690317585656;
    uint256 constant IC7y = 4065119421248023582720176558859396614241959543919198640619267962203489270062;
    
    uint256 constant IC8x = 552957142232772148755276605385408328708735076885358718760014687508419274431;
    uint256 constant IC8y = 9556486606305914468705464160268156196460403797024930486207647288423260895609;
    
    uint256 constant IC9x = 15534146526224059854873494946115769322221470036752866148405994595023547143707;
    uint256 constant IC9y = 12268344924478458610346977514912354872004186425470255230666550058021081994606;
    
    uint256 constant IC10x = 9334624639966272407576880155540595669106860285076607460171987642348677202845;
    uint256 constant IC10y = 19491324711897413050323138838958975028487545451198313924193474666960648537670;
    
    uint256 constant IC11x = 2713003357660424228785793220473172038362133322877625571997013200140047120976;
    uint256 constant IC11y = 19493774860324341284019055820897674067434959085378310016613190463690610723378;
    
    uint256 constant IC12x = 20155227039582257657506460213092907292215687445675308127156128187051683624728;
    uint256 constant IC12y = 7767749043250977631693413376334486001120144307170705474085027357152265187700;
    
    uint256 constant IC13x = 1245928908818598828119033176764247852070994481622478876933940310629283366032;
    uint256 constant IC13y = 5616913403720754423137424338677394235412786944462999770229827813472638924706;
    
    uint256 constant IC14x = 5719687148793058780579431943060799168834874225422004422350665199034020729938;
    uint256 constant IC14y = 3535705202848334075887511113465097818004606808888934595574518644927387906663;
    
    uint256 constant IC15x = 21451101207961792270321548694919508893802961428430726263658567199590948792582;
    uint256 constant IC15y = 21379360658213845296245651646969448839720637939280870969157548563235307554178;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[15] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC14x, IC14y, calldataload(add(pubSignals, 416)))
                
                g1_mulAccC(_pVk, IC15x, IC15y, calldataload(add(pubSignals, 448)))
                

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
            
            checkField(calldataload(add(_pubSignals, 416)))
            
            checkField(calldataload(add(_pubSignals, 448)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
