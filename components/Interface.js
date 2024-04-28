import { useState } from "react";
import $u from '../utils/$u.js';
import { ethers } from "ethers";

const wc = require("../circuit/witness_calculator.js");

const mixrAddress = "0xd62d4EA168d7B9713C43159c2BF39459202E7990";

const mixrJSON = require("../json/Mixr.json");
const mixrABI = mixrJSON.abi;
const mixrInterface = new ethers.utils.Interface(mixrABI);

const ButtonState = { Normal: 0, Loading: 1, Disabled: 2 };

const Interface = () => {
    const [account, updateAccount] = useState(null);
    const [proofElements, updateProofElements] = useState(null);
    const [proofStringEl, updateProofStringEl] = useState(null);
    const [textArea, updateTextArea] = useState(null);

    // interface states
    const [section, updateSection] = useState("Deposit");
    const [displayCopiedMessage, updateDisplayCopiedMessage] = useState(false);
    const [withdrawalSuccessful, updateWithdrawalSuccessful] = useState(false);
    const [metamaskButtonState, updateMetamaskButtonState] = useState(ButtonState.Normal);
    const [depositButtonState, updateDepositButtonState] = useState(ButtonState.Normal);
    const [withdrawButtonState, updateWithdrawButtonState] = useState(ButtonState.Normal);


    const connectMetamask = async () => {
        try{
            updateMetamaskButtonState(ButtonState.Disabled);
            if(!window.ethereum){
                alert("Please install Metamask to use this app.");
                throw "no-metamask";
            }

            var accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
            var chainId = window.ethereum.networkVersion;

            if(chainId != "534351"){
                alert("Please switch to the Scroll Sepolia Testnet");
                throw "wrong-chain";
            }

            var activeAccount = accounts[0];
            var balance = await window.ethereum.request({ method: "eth_getBalance", params: [activeAccount, "latest"] });
            balance = $u.moveDecimalLeft(ethers.BigNumber.from(balance).toString(), 18);

            var newAccountState = {
                chainId: chainId,
                address: activeAccount,
                balance: balance
            };
            updateAccount(newAccountState);
        }catch(e){
            console.log(e);
        }

        updateMetamaskButtonState(ButtonState.Normal);
    };
    const depositEther = async () => {
        updateDepositButtonState(ButtonState.Disabled);

        const secret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toString();
        const nullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toString();

        const input = {
            secret: $u.BN256ToBin(secret).split(""),
            nullifier: $u.BN256ToBin(nullifier).split("")
        };

        var res = await fetch("/deposit.wasm");
        var buffer = await res.arrayBuffer();
        var depositWC = await wc(buffer);

        const r = await depositWC.calculateWitness(input, 0);
        
        const commitment = r[1];
        const nullifierHash = r[2];

        const value = ethers.BigNumber.from("100000000000000000").toHexString();

        const tx = {
            to: mixrAddress,
            from: account.address,
            value: value,
            data: mixrInterface.encodeFunctionData("deposit", [commitment])
        };

        try{
            const txHash = await window.ethereum.request({ method: "eth_sendTransaction", params: [tx] });

            const proofElements = {
                nullifierHash: `${nullifierHash}`,
                secret: secret,
                nullifier: nullifier,
                commitment: `${commitment}`,
                txHash: txHash
            };

            console.log(proofElements);

            updateProofElements(btoa(JSON.stringify(proofElements)));
        }catch(e){
            console.log(e);
        }

        updateDepositButtonState(ButtonState.Normal);
    };
    const copyProof = () => {
        if(!!proofStringEl){
            flashCopiedMessage();
            navigator.clipboard.writeText(proofStringEl.innerHTML);
        }  
    };
    const withdraw = async () => {
        updateWithdrawButtonState(ButtonState.Disabled);

        if(!textArea || !textArea.value){ alert("Please input the proof of deposit string."); }

        try{
            const proofString = textArea.value;
            const proofElements = JSON.parse(atob(proofString));

            receipt = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [proofElements.txHash] });
            if(!receipt){ throw "empty-receipt"; }

            const log = receipt.logs[0];
            const decodedData = mixrInterface.decodeEventLog("Deposit", log.data, log.topics);

            const SnarkJS = window['snarkjs'];

            const proofInput = {
                "root": $u.BNToDecimal(decodedData.root),
                "nullifierHash": proofElements.nullifierHash,
                "recipient": $u.BNToDecimal(account.address),
                "secret": $u.BN256ToBin(proofElements.secret).split(""),
                "nullifier": $u.BN256ToBin(proofElements.nullifier).split(""),
                "hashPairings": decodedData.hashPairings.map((n) => ($u.BNToDecimal(n))),
                "hashDirections": decodedData.pairDirection
            };

            const { proof, publicSignals } = await SnarkJS.groth16.fullProve(proofInput, "/withdraw.wasm", "/setup_final.zkey");

            const callInputs = [
                proof.pi_a.slice(0, 2).map($u.BN256ToHex),
                proof.pi_b.slice(0, 2).map((row) => ($u.reverseCoordinate(row.map($u.BN256ToHex)))),
                proof.pi_c.slice(0, 2).map($u.BN256ToHex),
                publicSignals.slice(0, 2).map($u.BN256ToHex)
            ];

            const callData = mixrInterface.encodeFunctionData("withdraw", callInputs);
            const tx = {
                to: mixrAddress,
                from: account.address,
                data: callData
            };
            const txHash = await window.ethereum.request({ method: "eth_sendTransaction", params: [tx] });

            var receipt;
            while(!receipt){
                receipt = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [txHash] });
                await new Promise((resolve, reject) => { setTimeout(resolve, 1000); });
            }

            if(!!receipt){ updateWithdrawalSuccessful(true); }
        }catch(e){
            console.log(e);
        }

        updateWithdrawButtonState(ButtonState.Normal);
    };

    const flashCopiedMessage = async () => {
        updateDisplayCopiedMessage(true);
        setTimeout(() => {
            updateDisplayCopiedMessage(false);
        }, 1000);
    }

    return (
        <div>

            <nav className="navbar navbar-nav fixed-top  text-light" style={{backgroundColor: "#007bff"}}>
                {
                    !!account ? (
                        <div className="container">
                            <div className="navbar-left">
                                <span><strong>ChainId:</strong></span>
                                <br/>
                                <span>{account.chainId}</span>
                            </div>
                            <div className="navbar-right">
                                <span><strong>{account.address.slice(0, 12) + "..."}</strong></span>
                                <br/>
                                <span className="small">{account.balance.slice(0, 10) + ((account.balance.length > 10) ? ("...") : (""))} ETH</span>
                            </div>
                        </div>
                    ) : (
                        <div className="container">
                            <div className="navbar-left"><h5>mixr</h5></div>
                            <div className="navbar-right">
                                <button 
                
                                    className="btn btn-default" 
                                    onClick={connectMetamask}
                                    disabled={metamaskButtonState == ButtonState.Disabled}    
                                >Connect Metamask</button>
                            </div>
                        </div>
                    )
                }

                
            </nav>

            <div style={{ height: "60px" }}></div>

            <div className="container" style={{ marginTop: 60 }}>
                <div className="card mx-auto" style={{ maxWidth: 450 }}>
                    {
                        (section == "Deposit") ? (
                            <img className="card-img-top" src="/img/deposit.png" height={150} width={100} />
                        ) : (
                            <img className="card-img-top" src="/img/withdraw.png" height={150} width={100} />
                        )
                    }
                    <div className="card-body">

                    <div className="btn-group" style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
                            {
                                (section == "Deposit") ? (
                                    <button className="btn btn-primary">Deposit</button>
                                ) : (
                                    <button onClick={() => { updateSection("Deposit"); }} className="btn btn-outline-primary">Deposit</button>   
                                )
                            }
                            {
                                (section == "Deposit") ? (
                                    <button onClick={() => { updateSection("Withdraw"); }} className="btn btn-outline-primary">Withdraw</button> 
                                ) : (
                                    <button className="btn btn-primary">Withdraw</button>
                                )
                            }
                        </div>

                        {
                            (section == "Deposit" && !!account) && (
                                <div>
                                    {
                                        (!!proofElements) ? (
                                            <div>
                                                <div className="alert alert-success">
                                                    <span><strong>Proof of Deposit:</strong></span>
                                                    <div className="p-1" style={{ lineHeight: "12px" }}>
                                                        <span style={{ fontSize: 10 }} ref={(proofStringEl) => { updateProofStringEl(proofStringEl); }}>{proofElements}</span>
                                                    </div>

                                                </div>

                                                <div>
                                                    <button className="btn btn-success" onClick={copyProof}><span className="small">Copy Proof String</span></button>
                                                    {
                                                        (!!displayCopiedMessage) && (
                                                            <span className="small" style={{ color: 'green' }}><strong> Copied!</strong></span>
                                                        )
                                                    }
                                                </div>
                                                
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
                                            <p className="text-secondary">Note: All deposits and withdrawals are of the same denomination of 0.1 ETH.</p>
                                            <button 
                                                className="btn btn-success" 
                                                onClick={depositEther}
                                                disabled={depositButtonState == ButtonState.Disabled}
                                            ><span className="small">Deposit 0.1 ETH</span></button>
                                        </div>
                                        
                                            
                                        ) 
                                    }
                                </div>
                            )
                        }

                        {
                            (section != "Deposit" && !!account) && (
                                <div>
                                    {
                                        (withdrawalSuccessful) ? (
                                            <div>
                                                <div className="alert alert-success p-3">
                                                    <div><span><strong>Success!</strong></span></div>
                                                    <div style={{ marginTop: 5 }}>
                                                        <span className="text-secondary">Withdrawal successful. You can check your wallet to verify your funds.</span>
                                                    </div>

                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
                                                <p className="text-secondary">Note: All deposits and withdrawals are of the same denomination of 0.1 ETH.</p>
                                                <div className="form-group">
                                                    <textarea className="form-control" style={{ resize: "none" }} ref={(ta) => { updateTextArea(ta); }}></textarea>
                                                </div>
                                                <button 
                                                    className="btn btn-primary" 
                                                    onClick={withdraw}
                                                    disabled={withdrawButtonState == ButtonState.Disabled}
                                                ><span className="small">Withdraw 0.1 ETH</span></button>
                                            </div>                  
                                        )
                                    }
                                </div>
                            )
                        }

                        {
                            (!account) && (
                                <div>
                                    <p>Please connect your wallet to use the sections.</p>
                                </div>
                            )
                        }


                    </div>

                    <div className="card-footer p-4" style={{ lineHeight: "15px" }}>
                        <span className="small text-secondary" style={{ fontSize: "12px" }}>
                            <strong>Disclaimer:</strong> This product is intended for demonstration purposes and is <i>not</i> to be used with commercial intent.
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
};

export default Interface;