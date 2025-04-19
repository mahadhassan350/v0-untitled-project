import { NextResponse } from "next/server"
import * as fs from "fs/promises"
import * as path from "path"
import { Connection, Keypair } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token"
import bs58 from "bs58"

// Update the botEnvVars initialization with a more reliable default RPC URL
let botEnvVars = {
  RPC_URL:
    process.env.RPC_URL && (process.env.RPC_URL.startsWith("http://") || process.env.RPC_URL.startsWith("https://"))
      ? process.env.RPC_URL
      : "https://api.mainnet-beta.solana.com",
  DEV_PRIVATE_KEY: process.env.DEV_PRIVATE_KEY || "",
}

// Track bot status
const botStatus = {
  isRunning: false,
  startTime: null,
  lastError: null,
}

// Helper function to get wallet from private key
function getWalletFromPrivateKey(privateKeyString) {
  try {
    // Clean up the private key string (remove quotes, spaces, etc.)
    privateKeyString = privateKeyString.trim().replace(/^['"]|['"]$/g, "")

    // Handle different formats
    let privateKey

    // Check if it's a JSON array format
    if (privateKeyString.startsWith("[") && privateKeyString.endsWith("]")) {
      try {
        privateKey = new Uint8Array(JSON.parse(privateKeyString))
        return Keypair.fromSecretKey(privateKey)
      } catch (e) {
        console.error("Error parsing JSON array private key:", e)
        throw new Error("Invalid JSON array format for private key")
      }
    }

    // Check if it's a hex string (starts with 0x)
    if (privateKeyString.startsWith("0x")) {
      privateKeyString = privateKeyString.slice(2) // Remove 0x prefix
      // Convert hex to byte array
      const bytes = []
      for (let i = 0; i < privateKeyString.length; i += 2) {
        bytes.push(Number.parseInt(privateKeyString.substr(i, 2), 16))
      }
      privateKey = new Uint8Array(bytes)
      return Keypair.fromSecretKey(privateKey)
    }

    // Try base58 decode
    try {
      privateKey = bs58.decode(privateKeyString)
      return Keypair.fromSecretKey(privateKey)
    } catch (e) {
      console.error("Error decoding base58 private key:", e)
      throw new Error("Invalid base58 format for private key")
    }
  } catch (error) {
    console.error("Error creating wallet from private key:", error)

    // For debugging, log the first few characters of the key (safely)
    if (privateKeyString && privateKeyString.length > 0) {
      const safePrefix = privateKeyString.substring(0, 3)
      console.error(`Key starts with: ${safePrefix}...`)
      console.error(`Key length: ${privateKeyString.length}`)
    } else {
      console.error("Private key is empty or undefined")
    }

    throw new Error("Invalid private key format")
  }
}

// Fallback to a demo wallet if there's an issue with the private key
function getDemoWallet() {
  // Generate a new random keypair for demo purposes
  return Keypair.generate()
}

// Helper function to retry a function with exponential backoff
async function withRetry(fn, maxRetries = 3, initialDelay = 1000) {
  let retries = 0

  while (true) {
    try {
      return await fn()
    } catch (error) {
      retries++

      // If we've reached max retries or it's not a rate limit error, throw
      if (retries >= maxRetries || (error.message && !error.message.includes("429"))) {
        throw error
      }

      // Calculate delay with exponential backoff
      const delay = initialDelay * Math.pow(2, retries - 1)
      console.log(`Rate limited (429). Retrying in ${delay}ms... (${retries}/${maxRetries})`)

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

// Get SOL balance for a wallet with retry
async function getSolBalance(connection, publicKey) {
  try {
    return await withRetry(async () => {
      const balance = await connection.getBalance(publicKey)
      return balance / 1e9 // Convert lamports to SOL
    })
  } catch (error) {
    console.error("Error getting SOL balance:", error)
    throw error
  }
}

// Alternative method to get token accounts using getTokenAccountsByOwner
// This method is more widely supported by RPC providers
async function getTokenAccountsAlternative(connection, publicKey) {
  try {
    console.log("Using alternative method to get token accounts")

    // Get all token accounts owned by the wallet
    const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
      programId: TOKEN_PROGRAM_ID,
    })

    // Process the accounts to extract mint and balance
    return await Promise.all(
      tokenAccounts.value.map(async (account) => {
        try {
          // Get the account info
          const accountInfo = await getAccount(connection, account.pubkey)

          return {
            mint: accountInfo.mint.toString(),
            balance: Number(accountInfo.amount) / Math.pow(10, accountInfo.decimals || 0),
            address: account.pubkey.toString(),
          }
        } catch (error) {
          console.error("Error processing token account:", error)
          return {
            mint: "unknown",
            balance: 0,
            address: account.pubkey.toString(),
          }
        }
      }),
    )
  } catch (error) {
    console.error("Error in alternative token account method:", error)
    return []
  }
}

// Get token accounts for a wallet - with multiple fallback methods
async function getTokenAccounts(connection, publicKey) {
  try {
    console.log("Attempting to get parsed token accounts...")

    // Try to get parsed token accounts with retry
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: TOKEN_PROGRAM_ID,
    })

    return tokenAccounts.value.map((account) => {
      const parsedInfo = account.account.data.parsed.info
      const mintAddress = parsedInfo.mint
      const tokenBalance = parsedInfo.tokenAmount.uiAmount

      return {
        mint: mintAddress,
        balance: tokenBalance,
        address: account.pubkey.toString(),
      }
    })
  } catch (error) {
    console.error("Error getting parsed token accounts:", error)

    // If we get a 403 error, try the alternative method
    if (error.message && error.message.includes("403")) {
      console.log("403 Forbidden error. Trying alternative method...")
      try {
        return await getTokenAccountsAlternative(connection, publicKey)
      } catch (fallbackError) {
        console.error("Alternative method also failed:", fallbackError)
        return []
      }
    }

    // For other errors or if alternative method fails, return empty array
    console.warn("Failed to get token accounts, continuing with empty list")
    return []
  }
}

// Get real wallet data
async function getWalletData() {
  try {
    // Validate RPC URL format
    if (!botEnvVars.RPC_URL) {
      throw new Error("Missing RPC URL")
    }

    // Ensure URL starts with http:// or https://
    if (!botEnvVars.RPC_URL.startsWith("http://") && !botEnvVars.RPC_URL.startsWith("https://")) {
      throw new Error("RPC URL must start with http:// or https://")
    }

    console.log("Connecting to RPC URL:", botEnvVars.RPC_URL)

    // Create connection with higher commitment and disable rate limit behavior
    const connection = new Connection(botEnvVars.RPC_URL, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true, // We'll handle retries ourselves
    })

    let wallet
    let usingDemoWallet = false

    try {
      if (!botEnvVars.DEV_PRIVATE_KEY) {
        throw new Error("Missing private key")
      }
      wallet = getWalletFromPrivateKey(botEnvVars.DEV_PRIVATE_KEY)
    } catch (error) {
      console.error("Error with provided private key, using demo wallet:", error)
      wallet = getDemoWallet()
      usingDemoWallet = true
    }

    const publicKey = wallet.publicKey

    // Get SOL balance
    let solBalance = 0
    try {
      solBalance = await getSolBalance(connection, publicKey)
    } catch (error) {
      console.error("Failed to get SOL balance:", error.message)
      // Continue with zero balance rather than failing completely
    }

    // Get token accounts - this might fail with a 403 or 429 error on some RPC endpoints
    let tokenAccounts = []
    let tokenError = null
    try {
      tokenAccounts = await getTokenAccounts(connection, publicKey)
    } catch (error) {
      console.warn("Failed to get token accounts, continuing with empty list:", error.message)
      tokenError = error.message
      // Continue with empty token accounts rather than failing completely
    }

    return {
      publicKey: publicKey.toString(),
      solBalance,
      tokenAccounts,
      usingDemoWallet,
      tokenError,
    }
  } catch (error) {
    console.error("Error getting wallet data:", error)
    throw error
  }
}

// Convert token accounts to the format expected by the UI
function formatTokensForUI(tokenAccounts) {
  return tokenAccounts.map((token, index) => ({
    mint: token.mint,
    status: "monitoring", // Default status since we don't have real status yet
    balance: token.balance,
    value: 0, // We would need price data to calculate this
    age: 0, // We don't have this information yet
    attempts: 0, // We don't have this information yet
  }))
}

export async function GET() {
  try {
    let walletData = {
      publicKey: "",
      solBalance: 0,
      tokenAccounts: [],
      usingDemoWallet: false,
      tokenError: null,
    }

    let tokens = []
    let errorMessage = null

    // Try to get real wallet data
    try {
      walletData = await getWalletData()
      tokens = formatTokensForUI(walletData.tokenAccounts)
    } catch (error) {
      console.error("Error fetching real wallet data:", error)
      errorMessage = error.message
      // Fall back to mock data if there's an error
      tokens = []
    }

    // In a real implementation, you would get the actual state from the Python script
    // For example, by reading the state file that the Python script creates
    let botState = {}
    try {
      const stateFilePath = path.join(process.cwd(), "bot_state.json")
      const exists = await fs
        .stat(stateFilePath)
        .then(() => true)
        .catch(() => false)

      if (exists) {
        const stateContent = await fs.readFile(stateFilePath, "utf8")
        botState = JSON.parse(stateContent)
      }
    } catch (error) {
      console.error("Error reading bot state:", error)
    }

    // Calculate uptime if bot is running
    let uptime = "00:00:00"
    if (botStatus.isRunning && botStatus.startTime) {
      const uptimeMs = Date.now() - botStatus.startTime
      const hours = Math.floor(uptimeMs / 3600000)
        .toString()
        .padStart(2, "0")
      const minutes = Math.floor((uptimeMs % 3600000) / 60000)
        .toString()
        .padStart(2, "0")
      const seconds = Math.floor((uptimeMs % 60000) / 1000)
        .toString()
        .padStart(2, "0")
      uptime = `${hours}:${minutes}:${seconds}`
    }

    // Response with bot status and real wallet data
    return NextResponse.json({
      status: botStatus.isRunning ? "running" : "stopped",
      lastError: botStatus.lastError,
      tokens: tokens,
      stats: {
        walletBalance: walletData.solBalance,
        tokensMonitored: tokens.length,
        tokensSold: 0, // We don't have this information yet
        totalProfit: 0, // We don't have this information yet
        failedSells: 0, // We don't have this information yet
        uptime: uptime,
      },
      botState,
      walletPublicKey: walletData.publicKey,
      usingDemoWallet: walletData.usingDemoWallet,
      errorMessage: errorMessage,
      tokenError: walletData.tokenError,
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()

    // Handle different command types
    switch (body.command) {
      case "start":
        if (botStatus.isRunning) {
          return NextResponse.json({ error: "Bot is already running" }, { status: 400 })
        }

        try {
          // Validate environment variables
          if (!botEnvVars.RPC_URL) {
            return NextResponse.json(
              { error: "Missing required environment variables. Please configure RPC_URL." },
              { status: 400 },
            )
          }

          // Validate that we can connect to RPC and create a wallet
          try {
            const connection = new Connection(botEnvVars.RPC_URL, {
              commitment: "confirmed",
              disableRetryOnRateLimit: true,
            })

            let wallet

            try {
              if (!botEnvVars.DEV_PRIVATE_KEY) {
                throw new Error("Missing private key")
              }
              wallet = getWalletFromPrivateKey(botEnvVars.DEV_PRIVATE_KEY)
            } catch (error) {
              console.error("Error with provided private key, using demo wallet:", error)
              wallet = getDemoWallet()
            }

            // Test the connection by getting the wallet balance
            await withRetry(async () => {
              await connection.getBalance(wallet.publicKey)
            })
          } catch (error) {
            return NextResponse.json({ error: `Failed to connect to Solana: ${error.message}` }, { status: 400 })
          }

          // In a real implementation, you would start the Python script here
          // For now, we'll just simulate starting the bot
          console.log("Bot would start with env vars:", botEnvVars)

          // Update bot status
          botStatus.isRunning = true
          botStatus.startTime = Date.now()
          botStatus.lastError = null

          return NextResponse.json({
            success: true,
            message: "Bot started successfully",
            note: "This is a simulated start. In production, this would execute the Python script.",
          })
        } catch (error) {
          botStatus.lastError = error.message
          console.error("Error starting bot:", error)
          return NextResponse.json({ error: `Failed to start bot: ${error.message}` }, { status: 500 })
        }

      case "stop":
        if (!botStatus.isRunning) {
          return NextResponse.json({ error: "Bot is not running" }, { status: 400 })
        }

        try {
          // In a real implementation, you would stop the Python script here
          // For now, we'll just simulate stopping the bot
          console.log("Bot would stop")

          // Update bot status
          botStatus.isRunning = false
          botStatus.startTime = null

          return NextResponse.json({
            success: true,
            message: "Bot stopped successfully",
            note: "This is a simulated stop. In production, this would terminate the Python script.",
          })
        } catch (error) {
          botStatus.lastError = error.message
          console.error("Error stopping bot:", error)
          return NextResponse.json({ error: `Failed to stop bot: ${error.message}` }, { status: 500 })
        }

      case "updateSettings":
        // In a real implementation, you would update the bot settings
        console.log("Bot settings would update to:", body.settings)
        return NextResponse.json({
          success: true,
          message: "Settings updated successfully",
          note: "This is a simulated update. In production, this would update the bot's configuration.",
        })

      case "updateEnvVars":
        // Update environment variables
        botEnvVars = { ...botEnvVars, ...body.envVars }
        console.log("Environment variables updated:", botEnvVars)

        // If bot is running, we would restart it to apply new environment variables
        if (botStatus.isRunning) {
          console.log("Bot would restart with new environment variables")
        }

        return NextResponse.json({
          success: true,
          message: "Environment variables updated successfully",
          note: "In production, this would update the environment variables and restart the bot if running.",
        })

      case "forceSell":
        // In a real implementation, you would trigger a force sell
        console.log(`Force sell would be initiated for ${body.mint}`)
        return NextResponse.json({
          success: true,
          message: `Force sell initiated for ${body.mint}`,
          note: "This is a simulated action. In production, this would trigger the bot to sell the specified token.",
        })

      default:
        return NextResponse.json({ error: "Unknown command" }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
