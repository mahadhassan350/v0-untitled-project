"use client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AlertCircle, CheckCircle2, Clock, Copy, ExternalLink, MoreHorizontal, RotateCw } from "lucide-react"
import { forceSell } from "@/lib/bot-service"
import { useToast } from "@/hooks/use-toast"

// Status badge variants
const getStatusBadge = (status) => {
  switch (status) {
    case "monitoring":
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          <Clock className="w-3 h-3 mr-1" /> Monitoring
        </Badge>
      )
    case "sold":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle2 className="w-3 h-3 mr-1" /> Sold
        </Badge>
      )
    case "sell_failed":
      return (
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
          <RotateCw className="w-3 h-3 mr-1" /> Retry
        </Badge>
      )
    case "failed_max_retries":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <AlertCircle className="w-3 h-3 mr-1" /> Failed
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export default function TokenTable({ tokens }) {
  const { toast } = useToast()

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    toast({
      title: "Copied to clipboard",
      description: "Token address has been copied to clipboard",
    })
  }

  const openExplorer = (mint) => {
    window.open(`https://solscan.io/token/${mint}`, "_blank")
  }

  // This would be replaced with actual sell logic
  const handleForceSell = async (mint) => {
    try {
      await forceSell(mint)
      toast({
        title: "Force Sell Initiated",
        description: `Force sell initiated for token ${mint.substring(0, 6)}...`,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to force sell: ${error.message}`,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">Token</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right">Value (SOL)</TableHead>
            <TableHead className="text-right">Age (s)</TableHead>
            <TableHead className="text-right">Attempts</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                No tokens found in wallet
              </TableCell>
            </TableRow>
          ) : (
            tokens.map((token) => (
              <TableRow key={token.mint}>
                <TableCell className="font-medium">
                  {token.mint.substring(0, 6)}...{token.mint.substring(token.mint.length - 4)}
                </TableCell>
                <TableCell>{getStatusBadge(token.status || "monitoring")}</TableCell>
                <TableCell className="text-right">{token.balance.toFixed(2)}</TableCell>
                <TableCell className="text-right">{(token.value || 0).toFixed(4)}</TableCell>
                <TableCell className="text-right">{token.age || 0}</TableCell>
                <TableCell className="text-right">{token.attempts || 0}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => copyToClipboard(token.mint)}>
                        <Copy className="mr-2 h-4 w-4" /> Copy Address
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openExplorer(token.mint)}>
                        <ExternalLink className="mr-2 h-4 w-4" /> View on Explorer
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleForceSell(token.mint)}
                        disabled={token.status === "sold" || token.balance === 0}
                      >
                        <RotateCw className="mr-2 h-4 w-4" /> Force Sell
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
