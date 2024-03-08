require("dotenv").config()

import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { FlashbotsBundleProvider, FlashbotsBundleResolution } from "@flashbots/ethers-provider-bundle";
import { ERC721Abis } from "./abis";

const FLASHBOTS_ENDPOINT = "https://relay-sepolia.flashbots.net";

const provider = new JsonRpcProvider(process.env.ETHEREUM_RPC_URL, 11155111)

const authSigner = Wallet.createRandom()
const sponer = new Wallet(process.env.SPONSOR_PRIVATE_KEY!, provider)
const executor = new Wallet(process.env.EXECUTOR_PRIVATE_KEY!, provider)

const getERC721TransferTransactions = (address: string, tokenIds: number[]) => {
  const contract = new Contract(address, ERC721Abis, provider)

  return Promise.all(tokenIds.map((tokenId) => {
    return contract.transferFrom.populateTransaction(sponer.address, executor.address, tokenId)
  }))
}


const main = async () => {
  const txs = await getERC721TransferTransactions("0xA4ABE835081E66b46d02384edcbA5CF4f13b7E60", [1, 2])
  const gasEstimates = await Promise.all(txs.map((tx) => provider.estimateGas(tx)))

  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    authSigner,
    FLASHBOTS_ENDPOINT,
    "sepolia",
  )
  const block = await provider.getBlock("latest")

  const gasEstimateTotal = gasEstimates.reduce((acc, gas) => acc + gas, BigInt(0))

  console.log("Gas estimate total: ", gasEstimateTotal.toString())

  const gasPrice = block?.baseFeePerGas! * BigInt(2) + BigInt(102677274)

  const transactions = [
    {
      transaction: {
        to: executor.address,
        value: gasEstimateTotal * gasPrice,
        gasLimit: gasEstimateTotal,
        maxPriorityFeePerGas: 102677274,
        maxFeePerGas: gasPrice,
        chainId: 11155111
      },
      signer: sponer
    },
    ...txs.map((tx, i) => {
      return {
        transaction: {
          ...tx,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: 102677274,
          gasLimit: gasEstimates[i],
          chainId: 11155111
        },
        signer: executor
      }
    })
  ]

  // const bundleTransaction = await flashbotsProvider.signBundle(transactions)
  // const targetBlockNumber = (await provider.getBlockNumber()) + 1

  // const simulation = await flashbotsProvider.simulate(bundleTransaction, targetBlockNumber)
  // console.log(simulation)
  let i = 1
  while (true) {
    try {
      console.log("Sending bundle.", "Attempt: ", i++)
      const targetBlockNumber = (await provider.getBlockNumber()) + 3
      const response = await flashbotsProvider.sendBundle(transactions, targetBlockNumber)
      
      if ('error' in response) {
        console.log(response.error.message)
      } else {
        const result = await response.wait()
        if (result === FlashbotsBundleResolution.BundleIncluded) {
          console.log("Bundle included in block")
          break
        } else if (result === FlashbotsBundleResolution.AccountNonceTooHigh) {
          console.log("Nonce too high")
        } else {
          console.log("Bundle not included")
        }
      }

    } catch (e) {
      console.log("Error: ", e)
    }
  }

}

main()