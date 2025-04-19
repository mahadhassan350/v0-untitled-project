"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Save } from "lucide-react"

export default function BotSettings({ settings, updateSettings }) {
  const [formSettings, setFormSettings] = useState(settings)

  const handleChange = (field, value) => {
    setFormSettings({
      ...formSettings,
      [field]: value,
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    updateSettings(formSettings)
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Bot Settings</CardTitle>
          <CardDescription>Configure how the bot monitors and sells tokens</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h3 className="font-medium">Sell Conditions</h3>

            <div className="grid gap-2">
              <Label htmlFor="sellDelaySeconds">Sell After Time (seconds)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="sellDelaySeconds"
                  min={5}
                  max={60}
                  step={1}
                  value={[formSettings.sellDelaySeconds]}
                  onValueChange={(value) => handleChange("sellDelaySeconds", value[0])}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={formSettings.sellDelaySeconds}
                  onChange={(e) => handleChange("sellDelaySeconds", Number(e.target.value))}
                  className="w-20"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="takeProfitSol">Take Profit (SOL)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="takeProfitSol"
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  value={[formSettings.takeProfitSol]}
                  onValueChange={(value) => handleChange("takeProfitSol", value[0])}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={formSettings.takeProfitSol}
                  onChange={(e) => handleChange("takeProfitSol", Number(e.target.value))}
                  className="w-20"
                  step={0.01}
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="font-medium">Transaction Settings</h3>

            <div className="grid gap-2">
              <Label htmlFor="slippagePercent">Slippage Tolerance (%)</Label>
              <div className="flex items-center gap-4">
                <Slider
                  id="slippagePercent"
                  min={1}
                  max={50}
                  step={1}
                  value={[formSettings.slippagePercent]}
                  onValueChange={(value) => handleChange("slippagePercent", value[0])}
                  className="flex-1"
                />
                <Input
                  type="number"
                  value={formSettings.slippagePercent}
                  onChange={(e) => handleChange("slippagePercent", Number(e.target.value))}
                  className="w-20"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="priorityFee">Priority Fee (micro-lamports)</Label>
              <Input
                id="priorityFee"
                type="number"
                value={formSettings.priorityFee}
                onChange={(e) => handleChange("priorityFee", Number(e.target.value))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="computeUnits">Compute Units</Label>
              <Input
                id="computeUnits"
                type="number"
                value={formSettings.computeUnits}
                onChange={(e) => handleChange("computeUnits", Number(e.target.value))}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="font-medium">Monitoring Settings</h3>

            <div className="grid gap-2">
              <Label htmlFor="checkIntervalSeconds">Check Interval (seconds)</Label>
              <Input
                id="checkIntervalSeconds"
                type="number"
                value={formSettings.checkIntervalSeconds}
                onChange={(e) => handleChange("checkIntervalSeconds", Number(e.target.value))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="maxSellRetries">Max Sell Retries</Label>
              <Input
                id="maxSellRetries"
                type="number"
                value={formSettings.maxSellRetries}
                onChange={(e) => handleChange("maxSellRetries", Number(e.target.value))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="retryDelaySeconds">Retry Delay (seconds)</Label>
              <Input
                id="retryDelaySeconds"
                type="number"
                value={formSettings.retryDelaySeconds}
                onChange={(e) => handleChange("retryDelaySeconds", Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="gap-2">
            <Save className="h-4 w-4" /> Save Settings
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
