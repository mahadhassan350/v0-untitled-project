"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Play, StopCircle, AlertCircle, RefreshCw } from "lucide-react"
import TokenTable from "./token-table"
import BotSettings from "./bot-settings"
import BotConsole from "./bot-console"
import BotStats from "./bot-stats"
import EnvConfig from "./env-config"
import { startBot, stopBot, getBotStatus, updateSettings, updateEnvVars } from "@/lib/bot-service"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const mockSettings = {
  sellDelaySeconds: 15,
  takeProfitSol: 0.05,
  checkIntervalSeconds: 2,
  maxSellRetries: 5,
  retryDelaySeconds: 2,
  slippagePercent: 25.0,
  priorityFee: 50000,
  computeUnits: 200000,
}

// Replace the mockEnvVars initialization with this version that doesn't include the private key
const mockEnvVars = {
  RPC_URL:
    process.env.NEXT_PUBLIC_RPC_URL &&
    (process.env.NEXT_PUBLIC_RPC_URL.startsWith("http://") || process.env.NEXT_PUBLIC_RPC_URL.startsWith("https://"))
      ? process.env.NEXT_PUBLIC_RPC_URL
      : "https://api.mainnet-beta.solana.com",
  DEV_PRIVATE_KEY: "", // Initialize with empty string instead of using environment variable
}

export default function BotInterface() {
  const { toast } = useToast()
  const [isRunning, setIsRunning] = useState(false)
  const [tokens, setTokens] = useState([])
  const [settings, setSettings] = useState(mockSettings)
  const [envVars, setEnvVars] = useState(mockEnvVars)
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState({
    walletBalance: 0,
    tokensMonitored: 0,
    tokensSold: 0,
    totalProfit: 0,
    failedSells: 0,
    uptime: "00:00:00",
  })
  const [activeTab, setActiveTab] = useState("tokens")
  const [walletPublicKey, setWalletPublicKey] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tokenError, setTokenError] = useState(null)
  const [usingDemoWallet, setUsingDemoWallet] = useState(false)
  const [isPolling, setIsPolling] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Use a ref to track the last successful poll time
  const lastPollRef = useRef(Date.now())

  // Fetch initial data
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setIsLoading(true)
        const status = await getBotStatus()

        if (status.tokens) setTokens(status.tokens)
        if (status.stats) setStats(status.stats)
        if (status.status === "running") setIsRunning(true)
        if (status.walletPublicKey) setWalletPublicKey(status.walletPublicKey)
        if (status.usingDemoWallet) setUsingDemoWallet(status.usingDemoWallet)
        if (status.tokenError) setTokenError(status.tokenError)

        // Add initial log entries
        const initialLogs = [
          "--- Pump.fun Auto-Sell Bot Interface ---",
          `Wallet: ${status.walletPublicKey || "Not connected"}`,
          `SOL Balance: ${status.stats?.walletBalance.toFixed(4) || "0"} SOL`,
          `Tokens: ${status.tokens?.length || 0}`,
        ]

        if (status.usingDemoWallet) {
          initialLogs.push("WARNING: Using demo wallet due to private key issues")
          initialLogs.push("Please update your private key in the Environment tab")
        }

        if (status.errorMessage) {
          initialLogs.push(`Error: ${status.errorMessage}`)
        }

        if (status.tokenError) {
          initialLogs.push(`Token Error: ${status.tokenError}`)
          initialLogs.push("Consider using a dedicated RPC provider with full access to token methods")
        }

        initialLogs.push("------------------------------")
        setLogs(initialLogs)

        if (status.errorMessage) {
          setError(status.errorMessage)
        } else {
          setError(null)
        }

        // Update last successful poll time
        lastPollRef.current = Date.now()
      } catch (error) {
        console.error("Error fetching initial data:", error)
        setError(error.message || "Failed to connect to the bot service")
        setLogs([
          "--- Pump.fun Auto-Sell Bot Interface ---",
          `Error: ${error.message || "Failed to connect to the bot service"}`,
          "------------------------------",
        ])
      } finally {
        setIsLoading(false)
      }
    }

    fetchInitialData()
  }, [])

  // This would be replaced with actual communication with your Python script
  const toggleBot = async () => {
    try {
      if (!isRunning) {
        // Check if environment variables are set
        if (!envVars.RPC_URL) {
          toast({
            title: "Configuration Error",
            description: "Please set your RPC URL in the Environment tab.",
            variant: "destructive",
          })
          setActiveTab("environment")
          return
        }

        // Try to start the bot
        const result = await startBot()
        setIsRunning(true)
        const newLog = `Bot started at ${new Date().toLocaleTimeString()}`
        setLogs((prev) => [...prev, newLog])

        // If there's a note in the response (for development), add it to logs
        if (result.note) {
          setLogs((prev) => [...prev, `Note: ${result.note}`])
        }

        toast({
          title: "Bot Started",
          description: "The bot is now running and monitoring for new tokens.",
        })
      } else {
        // Try to stop the bot
        const result = await stopBot()
        setIsRunning(false)
        const newLog = `Bot stopped at ${new Date().toLocaleTimeString()}`
        setLogs((prev) => [...prev, newLog])

        // If there's a note in the response (for development), add it to logs
        if (result.note) {
          setLogs((prev) => [...prev, `Note: ${result.note}`])
        }

        toast({
          title: "Bot Stopped",
          description: "The bot has been stopped.",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error.message || `Failed to ${isRunning ? "stop" : "start"} the bot`,
        variant: "destructive",
      })
      console.error(`Error ${isRunning ? "stopping" : "starting"} bot:`, error)
    }
  }

  // This would be replaced with actual settings update logic
  const handleUpdateSettings = async (newSettings) => {
    try {
      await updateSettings(newSettings)
      setSettings(newSettings)
      const newLog = `Settings updated at ${new Date().toLocaleTimeString()}`
      setLogs((prev) => [...prev, newLog])
      toast({
        title: "Settings Updated",
        description: "Bot settings have been updated successfully.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to update settings: ${error.message}`,
        variant: "destructive",
      })
    }
  }

  // This would be replaced with actual env vars update logic
  const handleUpdateEnvVars = async (newEnvVars) => {
    try {
      // Validate RPC URL format
      if (!newEnvVars.RPC_URL) {
        throw new Error("RPC URL is required")
      }

      // Ensure URL starts with http:// or https://
      if (!newEnvVars.RPC_URL.startsWith("http://") && !newEnvVars.RPC_URL.startsWith("https://")) {
        throw new Error("RPC URL must start with http:// or https://")
      }

      await updateEnvVars(newEnvVars)
      setEnvVars(newEnvVars)
      const newLog = `Environment configuration updated at ${new Date().toLocaleTimeString()}`
      setLogs((prev) => [...prev, newLog])

      // Refresh data to get updated wallet info
      const status = await getBotStatus()
      if (status.tokens) setTokens(status.tokens)
      if (status.stats) setStats(status.stats)
      if (status.walletPublicKey) setWalletPublicKey(status.walletPublicKey)
      if (status.usingDemoWallet !== undefined) setUsingDemoWallet(status.usingDemoWallet)
      if (status.tokenError) setTokenError(status.tokenError)

      if (status.usingDemoWallet) {
        setLogs((prev) => [...prev, "WARNING: Using demo wallet due to private key issues"])
        setLogs((prev) => [...prev, "Please check your private key format"])
      } else {
        setLogs((prev) => [...prev, "Successfully connected to wallet"])
      }

      if (status.tokenError) {
        setLogs((prev) => [...prev, `Token Error: ${status.tokenError}`])
        setLogs((prev) => [...prev, "Consider using a dedicated RPC provider with full access to token methods"])
      }

      toast({
        title: "Environment Updated",
        description: "Environment variables have been updated successfully.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to update environment variables: ${error.message}`,
        variant: "destructive",
      })
    }
  }

  // Poll for bot status updates with rate limiting protection
  useEffect(() => {
    // Only poll if isPolling is true
    if (!isPolling) return

    const pollInterval = 10000 // 10 seconds between polls to avoid rate limiting

    const pollStatus = async () => {
      try {
        // Check if enough time has passed since the last poll
        const now = Date.now()
        const timeSinceLastPoll = now - lastPollRef.current

        if (timeSinceLastPoll < pollInterval) {
          // If not enough time has passed, wait for the remaining time
          const remainingTime = pollInterval - timeSinceLastPoll
          await new Promise((resolve) => setTimeout(resolve, remainingTime))
        }

        const status = await getBotStatus()

        if (status.tokens) setTokens(status.tokens)
        if (status.stats) setStats(status.stats)
        if (status.status === "running") setIsRunning(true)
        else if (status.status === "stopped" && isRunning) setIsRunning(false)
        if (status.walletPublicKey) setWalletPublicKey(status.walletPublicKey)
        if (status.usingDemoWallet !== undefined) setUsingDemoWallet(status.usingDemoWallet)
        if (status.tokenError) setTokenError(status.tokenError)

        // Update last successful poll time
        lastPollRef.current = Date.now()

        // If there was an error before, clear it
        if (error && !status.errorMessage) {
          setError(null)
        }

        // If there's a new error, set it
        if (status.errorMessage) {
          setError(status.errorMessage)
        }
      } catch (error) {
        console.error("Failed to get bot status:", error)

        // If we get a rate limit error, add it to the logs but don't show a toast
        if (error.message && error.message.includes("429")) {
          setLogs((prev) => [...prev, `Rate limited (429). Reducing polling frequency.`])
        }
      }

      // Schedule the next poll if we're still polling
      if (isPolling) {
        setTimeout(pollStatus, pollInterval)
      }
    }

    // Start polling
    pollStatus()

    // Cleanup function to stop polling when component unmounts
    return () => {
      setIsPolling(false)
    }
  }, [isPolling, error, isRunning])

  // Function to manually refresh data
  const handleRefresh = async () => {
    try {
      setIsRefreshing(true)
      setLogs((prev) => [...prev, "Manually refreshing data..."])
      const status = await getBotStatus()

      if (status.tokens) setTokens(status.tokens)
      if (status.stats) setStats(status.stats)
      if (status.status === "running") setIsRunning(true)
      else if (status.status === "stopped") setIsRunning(false)
      if (status.walletPublicKey) setWalletPublicKey(status.walletPublicKey)
      if (status.usingDemoWallet !== undefined) setUsingDemoWallet(status.usingDemoWallet)
      if (status.tokenError) setTokenError(status.tokenError)

      setLogs((prev) => [...prev, "Data refreshed successfully"])

      if (status.tokenError) {
        setLogs((prev) => [...prev, `Token Error: ${status.tokenError}`])
        setLogs((prev) => [...prev, "Consider using a dedicated RPC provider with full access to token methods"])
      }

      // Update last poll time
      lastPollRef.current = Date.now()

      toast({
        title: "Data Refreshed",
        description: "Bot status has been refreshed successfully.",
      })
    } catch (error) {
      console.error("Error refreshing data:", error)
      setLogs((prev) => [...prev, `Error refreshing data: ${error.message}`])

      toast({
        title: "Refresh Error",
        description: `Failed to refresh data: ${error.message}`,
        variant: "destructive",
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-lg">Loading bot interface...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Pump.fun Auto-Sell Bot</h1>
          <p className="text-muted-foreground">Monitor and automatically sell tokens based on time or profit targets</p>
          {walletPublicKey && (
            <p className="text-sm mt-1">
              Wallet:{" "}
              <span className="font-mono">
                {walletPublicKey.substring(0, 8)}...{walletPublicKey.substring(walletPublicKey.length - 8)}
              </span>
              {usingDemoWallet && (
                <Badge variant="outline" className="ml-2 bg-yellow-50 text-yellow-700 border-yellow-200">
                  Demo Wallet
                </Badge>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Button onClick={handleRefresh} variant="outline" size="sm" className="gap-1" disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Badge variant={isRunning ? "success" : "secondary"} className="px-3 py-1">
            {isRunning ? "Running" : "Stopped"}
          </Badge>
          <Button onClick={toggleBot} variant={isRunning ? "destructive" : "default"} className="gap-2">
            {isRunning ? <StopCircle className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isRunning ? "Stop Bot" : "Start Bot"}
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {tokenError && (
        <Alert variant="warning" className="bg-amber-50 border-amber-200 text-amber-800">
          <AlertCircle className="h-4 w-4 text-amber-800" />
          <AlertTitle>Token Access Error</AlertTitle>
          <AlertDescription>
            {tokenError.includes("403")
              ? "Your RPC endpoint returned a 403 Forbidden error when trying to access token accounts. This is common with public RPC endpoints. Consider using a dedicated RPC provider with full access to token methods."
              : tokenError}
          </AlertDescription>
        </Alert>
      )}

      {usingDemoWallet && (
        <Alert variant="warning" className="bg-yellow-50 border-yellow-200 text-yellow-800">
          <AlertCircle className="h-4 w-4 text-yellow-800" />
          <AlertTitle>Using Demo Wallet</AlertTitle>
          <AlertDescription>
            There was an issue with your private key. A demo wallet is being used instead. Please update your private
            key in the Environment tab.
          </AlertDescription>
        </Alert>
      )}

      <BotStats stats={stats} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full max-w-md">
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="console">Console</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="help">Help</TabsTrigger>
        </TabsList>

        <TabsContent value="tokens" className="mt-4">
          <TokenTable tokens={tokens} />
        </TabsContent>

        <TabsContent value="console" className="mt-4">
          <BotConsole logs={logs} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <BotSettings settings={settings} updateSettings={handleUpdateSettings} />
        </TabsContent>

        <TabsContent value="environment" className="mt-4">
          <EnvConfig envVars={envVars} updateEnvVars={handleUpdateEnvVars} />
        </TabsContent>

        <TabsContent value="help" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Bot Documentation</CardTitle>
              <CardDescription>How to use the Pump.fun Auto-Sell Bot</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg">Overview</h3>
                <p>
                  This bot monitors tokens created by your wallet on Pump.fun and automatically sells them based on your
                  configured settings.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-lg">Key Features</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Automatic detection of new tokens created by your wallet</li>
                  <li>Sell tokens after a specified time delay</li>
                  <li>Sell tokens when they reach a profit target</li>
                  <li>Configurable slippage tolerance</li>
                  <li>Transaction priority fee settings</li>
                  <li>Automatic retry on failed sells</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-lg">Getting Started</h3>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Set your RPC URL and wallet private key in the Environment tab</li>
                  <li>Configure your settings in the Settings tab</li>
                  <li>Click the "Start Bot" button to begin monitoring</li>
                  <li>Monitor token status in the Tokens tab</li>
                  <li>View detailed logs in the Console tab</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold text-lg">RPC URL Information</h3>
                <p>Some RPC endpoints may have limitations on which methods they support:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Public RPC endpoints often return 403 Forbidden errors for token account queries</li>
                  <li>Consider using a dedicated RPC provider like Helius, QuickNode, or Alchemy</li>
                  <li>Make sure your RPC endpoint has the necessary permissions for token account methods</li>
                  <li>
                    If you see 403 or 429 errors, the interface will try alternative methods or reduce polling frequency
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-lg">Private Key Format</h3>
                <p>The private key should be in one of these formats:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Base58 encoded string (most common)</li>
                  <li>JSON array of numbers (e.g., [123, 45, 67, ...])</li>
                  <li>Hex string with 0x prefix (e.g., 0x123abc...)</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
