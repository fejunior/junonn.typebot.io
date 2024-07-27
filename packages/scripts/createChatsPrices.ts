import Stripe from 'stripe'
import { promptAndSetEnvironment } from './utils'

const chatsProductId = 'prod_MVXtq5sATQzIcM'

const createChatsPrices = async () => {
  await promptAndSetEnvironment()

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2022-11-15',
  })

  // Assuming "JunonnLabs" plan does not need any Stripe pricing creation
  console.log('No Stripe pricing creation needed for JunonnLabs plan')
}

createChatsPrices()
