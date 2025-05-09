import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VersionedTransaction, Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// Thêm interface SwapResult
interface SwapResult {
    signature: string;
    dex: string;
    outputAmount: number;
}

@Injectable()
export class PumpFunService {
    private readonly connection: Connection;

    constructor(
        private configService: ConfigService
    ) {
        const rpcEndpoint = this.configService.get<string>('SOLANA_RPC_URL')
            || 'https://api.mainnet-beta.solana.com';
        this.connection = new Connection(rpcEndpoint, 'confirmed');
    }

    private async trySwapWithDecreasingAmount(
        wallet: Keypair,
        fromToken: string,
        toToken: string,
        originalAmount: number,
        slippage: number,
        isBuy: boolean = false
    ): Promise<SwapResult> {
        let currentDeduction = 0.0005; // Bắt đầu với 0.05%
        const maxDeduction = 0.005; // Tối đa 0.5%

        while (currentDeduction <= maxDeduction) {
            try {
                const adjustedAmount = originalAmount * (1 - currentDeduction);
                console.log(`Attempting swap with ${currentDeduction * 100}% deduction. Amount: ${adjustedAmount}`);

                const params = {
                    publicKey: wallet.publicKey.toString(),
                    action: isBuy ? 'buy' : 'sell',
                    mint: isBuy ? toToken : fromToken,
                    denominatedInSol: isBuy ? 'true' : 'false',
                    amount: adjustedAmount,
                    slippage: slippage,
                    priorityFee: 0.00001,
                    pool: 'pump'
                };

                const response = await fetch('https://pumpportal.fun/api/trade-local', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(params)
                });

                if (response.status === 200) {
                    const data = await response.arrayBuffer();
                    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
                    tx.sign([wallet]);
                    const signature = await this.connection.sendTransaction(tx);

                    return {
                        signature,
                        dex: 'pumpfun',
                        outputAmount: adjustedAmount
                    };
                }

                // Nếu không thành công, tăng mức giảm lên
                currentDeduction += 0.0005; // Tăng thêm 0.05%
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.log(`Attempt failed with ${currentDeduction * 100}% deduction:`, error.message);
                currentDeduction += 0.0005;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        throw new Error('Failed to execute swap after all reduction attempts');
    }

    async swap(
        privateKeyJson: string,
        fromToken: string,
        toToken: string,
        amount: number,
        slippage: number,
        isBuy: boolean = true,
        forceSellAll: boolean = false
    ): Promise<SwapResult> {
        try {
            // Parse JSON private key
            let solanaPrivateKey: string;
            try {
                const keys = JSON.parse(privateKeyJson);
                solanaPrivateKey = keys.solana;
                if (!solanaPrivateKey) {
                    throw new Error('Solana private key not found in JSON');
                }
            } catch (e) {
                console.log('>>> Not a JSON string, using original key');
                solanaPrivateKey = privateKeyJson;
            }

            const wallet = Keypair.fromSecretKey(bs58.decode(solanaPrivateKey));

            // Nếu là sell (không phải buy), luôn kiểm tra số dư thực tế
            if (!isBuy) {
                try {
                    // Lấy số dư thực tế của token
                    const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                        wallet.publicKey,
                        { mint: new PublicKey(fromToken) }
                    );

                    if (tokenAccounts.value.length > 0) {
                        const tokenAccount = tokenAccounts.value[0];
                        const actualBalance = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;

                        if (actualBalance) {
                            // Nếu số lượng yêu cầu lớn hơn số dư thực tế, điều chỉnh lại
                            if (amount > actualBalance) {
                                console.log(`>>> Adjusting amount from ${amount} to actual balance ${actualBalance}`);
                                amount = actualBalance * 0.999; // Giảm 0.1% để đảm bảo thành công
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`>>> Error checking token balance: ${error.message}`);
                }
            }

            // Nếu là force sell all, sử dụng logic giảm dần
            if (forceSellAll && !isBuy) {
                return await this.trySwapWithDecreasingAmount(
                    wallet,
                    fromToken,
                    toToken,
                    amount,
                    slippage,
                    isBuy
                );
            }

            // Normal swap logic
            const params = {
                publicKey: wallet.publicKey.toString(),
                action: isBuy ? 'buy' : 'sell',
                mint: isBuy ? toToken : fromToken,
                denominatedInSol: isBuy ? 'true' : 'false',
                amount: amount,
                slippage: slippage,
                priorityFee: 0.00001,
                pool: 'pump'
            };

            console.log('>>> PumpFun swap params:', {
                ...params,
                privateKey: '***hidden***'
            });

            const response = await fetch('https://pumpportal.fun/api/trade-local', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });

            if (response.status === 200) {
                const data = await response.arrayBuffer();
                const tx = VersionedTransaction.deserialize(new Uint8Array(data));
                tx.sign([wallet]);
                const signature = await this.connection.sendTransaction(tx);

                return {
                    signature,
                    dex: 'pumpfun',
                    outputAmount: amount
                };
            } else {
                throw new Error(`PumpFun API error: ${response.statusText}`);
            }
        } catch (error) {
            console.error('>>> PumpFun swap error:', error);
            throw error;
        }
    }
} 