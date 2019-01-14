import { BigNumber } from 'bignumber.js'
import Web3 = require('web3')

import BSTAuction from '@celo/sdk/dist/contracts/BSTAuction'
import Exchange from '@celo/sdk/dist/contracts/Exchange'
import GoldToken from '@celo/sdk/dist/contracts/GoldToken'
import StableToken from '@celo/sdk/dist/contracts/StableToken'
import { unlockAccount } from '@celo/sdk/dist/src/account-utils'
import { executeBid, findAuctionInProgress } from '@celo/sdk/dist/src/auction-utils'
import { selectContractByAddress } from '@celo/sdk/dist/src/contract-utils'
import { exchangePrice } from '@celo/sdk/dist/src/exchange-utils'
import { balanceOf } from '@celo/sdk/dist/src/erc20-utils'
import { Exchange as ExchangeType } from '@celo/sdk/types/Exchange'

// Strategy parameters (feel free to play around with these)
const bidDiscount = 1.1 // The 'discount' we bid at (1.1 = 10%)
const capProportionToBid = 0.9 // The proportion of the cap we bid
const randomFactor = Math.random() * 0.001 - 0.0005 // a random 'jitter' to make a bid easy to identify

const FOUR_WEEKS = 4 * 7 * 24 * 3600

// This implements a simple auction strategy. We bid 90% of the cap in the auction and
// ask for tokens such that we get a 10% discount relative to the current price quoted
// on the exchange.
const simpleBidStrategy = async (web3: any, account: string) => {
  // Initialize contract objects
  const exchange: ExchangeType = await Exchange(web3)
  const auction = await BSTAuction(web3)
  const stableToken = await StableToken(web3)
  const goldToken = await GoldToken(web3)

  auction.events.AuctionStarted().on('data', async (event: any) => {
    const sellToken = selectContractByAddress(
      [stableToken, goldToken],
      event.returnValues.sellToken
    )
    const buyToken = selectContractByAddress([stableToken, goldToken], event.returnValues.buyToken)

    const sellTokenSymbol = await sellToken.methods.symbol().call()
    const buyTokenSymbol = await buyToken.methods.symbol().call()

    const auctionInProgress = await findAuctionInProgress(stableToken, goldToken, auction)
    const auctionCap = auctionInProgress.params.cap

    const sellTokenBalance = await balanceOf(sellToken, account, web3)
    const sellTokenAmount = BigNumber.min(auctionCap, sellTokenBalance)
      .times(capProportionToBid)
      .decimalPlaces(0)

    console.info(
      `your current balance of ${sellTokenSymbol} is ${sellTokenBalance}, the cap is ${web3.utils.toBN(
        auctionInProgress.params.cap
      )}, and we will bid ${sellTokenAmount} in this auction`
    )

    const bidAdjustment = bidDiscount + randomFactor

    const price = await exchangePrice(exchange, buyToken, sellToken)
    const buyTokenAmount = sellTokenAmount
      .times(price)
      .times(bidAdjustment)
      .decimalPlaces(0)

    // Bid on the auction
    console.info(
      `Bidding on auction with ${sellTokenSymbol} ${sellTokenAmount} to purchase ${buyTokenSymbol} ${buyTokenAmount}`
    )

    const [auctionSellTokenWithdrawn, auctionBuyTokenWithdrawn] = await executeBid(
      auction,
      sellToken,
      buyToken,
      sellTokenAmount,
      buyTokenAmount,
      account,
      web3
    )
    console.info('Bid successfully executed!')
    console.info(`${sellTokenSymbol} withdrawn: ${auctionSellTokenWithdrawn}`)
    console.info(`${buyTokenSymbol} withdrawn: ${auctionBuyTokenWithdrawn}`)
  })
}

const bid = async () => {
  const argv = require('minimist')(process.argv.slice(2), {
    string: ['host'],
    default: { host: 'localhost', noUnlock: false },
  })

  // @ts-ignore
  const web3: Web3 = new Web3(`ws://${argv.host}:8546`)
  let account: string

  if (!argv.noUnlock) {
    // TODO(asa): Don't unlock when already unlocked, won't work with the miner as is
    account = await unlockAccount(web3, FOUR_WEEKS) // Unlock for 4 weeks so our strategy can run.
  } else {
    const accounts = await web3.eth.getAccounts()
    account = accounts[0]
  }
  simpleBidStrategy(web3, account)
}

bid()
