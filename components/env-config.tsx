"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Save, Eye, EyeOff, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"

export default function EnvConfig({ envVars, updateEnvVars }) {
  const { toast } = useToast()
  const [formVars, setFormVars] = useState(envVars)
  const [showPrivateKey, setShowPrivateKey] = useState(false)

  const handleChange = (field, value) => {
    setFormVars({
      ...formVars,
      [field]: value,
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    // Validate RPC URL format
    if (!formVars.RPC_URL) {
      toast({
        title: "Validation Error",
        description: "RPC URL is required",
        variant: "destructive",
      })
      return
    }

    // Ensure URL starts with http:// or https://
    if (!formVars.RPC_URL.startsWith("http://") && !formVars.RPC_URL.startsWith("https://")) {
      toast({
        title: "Validation Error",
        description: "RPC URL must start with http:// or https://",
        variant: "destructive",
      })
      return
    }

    updateEnvVars(formVars)
    toast({
      title: "Environment variables updated",
      description: "Your configuration has been saved.",
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Environment Configuration</CardTitle>
          <CardDescription>Configure the connection to Solana blockchain</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="rpcUrl">Solana RPC URL</Label>
            <Input
              id="rpcUrl"
              value={formVars.RPC_URL}
              onChange={(e) => handleChange("RPC_URL", e.target.value)}
              placeholder="https://mainnet.helius-rpc.com/?api-key=your-api-key"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Your Solana RPC endpoint. We recommend using Helius, QuickNode, or Alchemy for best performance.
            </p>

            <Alert variant="warning" className="mt-2 bg-amber-50 border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                <strong>Important:</strong> Public RPC endpoints (like api.mainnet-beta.solana.com) often return 403
                Forbidden errors when accessing token accounts. For full functionality, use a dedicated RPC provider
                with an API key.
              </AlertDescription>
            </Alert>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="privateKey">Developer Wallet Private Key</Label>
            <div className="flex">
              <Input
                id="privateKey"
                type={showPrivateKey ? "text" : "password"}
                value={formVars.DEV_PRIVATE_KEY}
                onChange={(e) => handleChange("DEV_PRIVATE_KEY", e.target.value)}
                placeholder="Your base58 encoded private key"
                className="font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="ml-2"
                onClick={() => setShowPrivateKey(!showPrivateKey)}
              >
                {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your wallet's private key in base58 format. This is used to sign transactions.
            </p>
            <p className="text-xs text-red-500 font-medium">
              WARNING: Keep this key secure. Never share it with anyone.
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="gap-2">
            <Save className="h-4 w-4" /> Save Configuration
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
