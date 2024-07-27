import Cors from 'micro-cors'
import { IncomingMessage, ServerResponse } from 'http'

const cors = Cors({
  allowMethods: ['POST', 'HEAD'],
})

export const config = {
  api: {
    bodyParser: false,
  },
}

// A placeholder handler since webhookHandler is removed.
const placeholderHandler = async (
  req: IncomingMessage,
  res: ServerResponse
) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('This endpoint is not used in JunonnLabs plan.')
  return Promise.resolve()
}

export default cors(placeholderHandler)
