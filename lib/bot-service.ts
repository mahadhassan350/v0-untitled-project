export async function getBotStatus() {
  try {
    const response = await fetch("/api/bot")
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || "Failed to get bot status")
    }
    return await response.json()
  } catch (error) {
    console.error("Error getting bot status:", error)
    throw error
  }
}

export async function startBot() {
  try {
    const response = await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "start" }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || "Failed to start bot")
    }

    return await response.json()
  } catch (error) {
    console.error("Error starting bot:", error)
    throw error
  }
}

export async function stopBot() {
  try {
    const response = await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "stop" }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || "Failed to stop bot")
    }

    return await response.json()
  } catch (error) {
    console.error("Error stopping bot:", error)
    throw error
  }
}

export async function updateSettings(settings) {
  try {
    const response = await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "updateSettings", settings }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || "Failed to update settings")
    }

    return await response.json()
  } catch (error) {
    console.error("Error updating settings:", error)
    throw error
  }
}

export async function updateEnvVars(envVars) {
  try {
    const response = await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "updateEnvVars", envVars }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || "Failed to update environment variables")
    }

    return await response.json()
  } catch (error) {
    console.error("Error updating environment variables:", error)
    throw error
  }
}

export async function forceSell(mint) {
  try {
    const response = await fetch("/api/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "forceSell", mint }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || "Failed to force sell")
    }

    return await response.json()
  } catch (error) {
    console.error("Error forcing sell:", error)
    throw error
  }
}
