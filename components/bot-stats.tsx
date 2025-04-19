"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Clock, Coins, DollarSign, AlertCircle, Wallet, ArrowUpDown } from "lucide-react"

export default function BotStats({ stats }) {
  const StatCard = ({ icon, title, value, className }) => (
    <Card className={className}>
      <CardContent className="p-6 flex items-center gap-4">
        <div className="rounded-full p-3 bg-primary/10">{icon}</div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <h3 className="text-2xl font-bold">{value}</h3>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <StatCard
        icon={<Wallet className="h-5 w-5 text-primary" />}
        title="Wallet Balance"
        value={`${stats.walletBalance.toFixed(4)} SOL`}
      />
      <StatCard
        icon={<ArrowUpDown className="h-5 w-5 text-primary" />}
        title="Tokens Monitored/Sold"
        value={`${stats.tokensMonitored} / ${stats.tokensSold}`}
      />
      <StatCard
        icon={<DollarSign className="h-5 w-5 text-primary" />}
        title="Total Profit"
        value={`${stats.totalProfit.toFixed(4)} SOL`}
      />
      <StatCard
        icon={<AlertCircle className="h-5 w-5 text-primary" />}
        title="Failed Sells"
        value={stats.failedSells}
      />
      <StatCard icon={<Clock className="h-5 w-5 text-primary" />} title="Uptime" value={stats.uptime} />
      <StatCard
        icon={<Coins className="h-5 w-5 text-primary" />}
        title="Current Monitoring"
        value={`${stats.tokensMonitored} tokens`}
      />
    </div>
  )
}
