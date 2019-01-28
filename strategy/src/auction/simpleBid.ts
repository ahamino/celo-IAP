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
import { balanceOf, parseFromContractDecimals } from '@celo/sdk/dist/src/erc20-utils'
import { Exchange as ExchangeType } from '@celo/sdk/types/Exchange'

// Strategy parameters (feel free to play around with these)
const bidDiscount = 1.06 // The 'discount' we bid at (1.1 = 10%)
const balanceProportionToBid = 0.9 // The proportion of our sellTokenBalance we bid
const randomFactor = Math.random() * 0.001 - 0.0005 // a random 'jitter' to make a bid easy to identify

const FOUR_WEEKS = 4 * 7 * 24 * 3600

// This implements a simple auction strategy. We bid half our dollar balance in the auction and
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
    const price = await exchangePrice(exchange, sellToken, buyToken)

    let sellTokenAmount
    let buyTokenAmount

    const bidAdjustment = bidDiscount + randomFactor

    // buyToken here is what we are purchasing/winning from the auction
    // sellToken is what we are selling/releasing to the auction
    sellTokenAmount = sellTokenBalance.times(balanceProportionToBid).decimalPlaces(0)
    buyTokenAmount = sellTokenAmount
      .div(price)
      .times(bidAdjustment)
      .decimalPlaces(0)

    // Tokens are divisible by 10^-d, where d typically equals 18. The balance returned by balanceOf
    // is in the smalled currency unit, and thus needs to be converted into a more readable number.
    // For example, for a token with d == 18, if balanceOf returns 1,800,000,000,000,000,000 we
    // would want to log a balance of 1.8.

    const sellTokenBalanceDisplay = await parseFromContractDecimals(
      sellTokenBalance,
      sellToken
    )
    const sellTokenAmountDisplay = await parseFromContractDecimals(
      sellTokenAmount,
      sellToken
    )
    const buyTokenAmountDisplay = await parseFromContractDecimals(
      buyTokenAmount,
      buyToken
    )

    console.info(`The auction cap is ${web3.utils.fromWei(web3.utils.toBN(auctionCap))}`)

    console.info(
      `Your current balance of ${sellTokenSymbol} is ${sellTokenBalanceDisplay} and we will bid ${sellTokenAmountDisplay} in this auction`
    )

    // Bid on the auction
    console.info(
      `Bidding on auction with ${sellTokenAmountDisplay} ${sellTokenSymbol} to purchase ${buyTokenAmountDisplay} ${buyTokenSymbol}`
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
    if (parseInt(auctionSellTokenWithdrawn) > 0) {
      console.info(
        `Withdrew ${await parseFromContractDecimals(new BigNumber(auctionSellTokenWithdrawn), sellToken)} ${await sellToken.methods.symbol().call()} from the auction`
      )
    }
    if (parseInt(auctionBuyTokenWithdrawn) > 0) {
      console.info(
        `Withdrew ${await parseFromContractDecimals(new BigNumber(auctionBuyTokenWithdrawn), buyToken)} ${await buyToken.methods.symbol().call()} from the auction`
      )
    }
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
    account = await unlockAccount(web3, FOUR_WEEKS) // Unlock for 4 weeks so our strategy can run.
  } else {
    const accounts = await web3.eth.getAccounts()
    account = accounts[0]
  }
  simpleBidStrategy(web3, account)
}

bid()
