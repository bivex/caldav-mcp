#!/usr/bin/env node

import "dotenv/config"
import { createClient, WebDAVClient } from "webdav"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { registerCreateEvent } from "./tools/create-event.js"
import { registerDeleteEvent } from "./tools/delete-event.js"
import { registerListCalendars } from "./tools/list-calendars.js"
import { registerListEvents } from "./tools/list-events.js"

const server = new McpServer({
  name: "caldav-mcp",
  version: "0.1.0",
})

async function main() {
  const rawBaseUrl = process.env.CALDAV_BASE_URL || ""
  const username = process.env.CALDAV_USERNAME || ""
  const password = process.env.CALDAV_PASSWORD || ""

  console.error(`[DEBUG] Attempting CalDAV connection with:`)
  console.error(`[DEBUG] Base URL: ${rawBaseUrl}`)
  console.error(`[DEBUG] Username: ${username}`)
  console.error(`[DEBUG] Password length: ${password.length}`)

  // Create WebDAV client with Digest authentication support
  const client: WebDAVClient = createClient(rawBaseUrl, {
    username,
    password,
    authType: "digest" as any, // Try digest first
  })

  try {
    console.error(`[DEBUG] Testing connection...`)
    // Test the connection by getting directory contents
    const contents = await client.getDirectoryContents("/") as any[]
    console.error(`[DEBUG] Connection successful! Found ${contents.length} items`)
    console.error(`[DEBUG] Contents:`, contents.map((item: any) => ({ name: item.filename, type: item.type })))
  } catch (error) {
    console.error(`[DEBUG] Connection failed: ${error}`)
    throw new Error(`CalDAV connection failed: ${error}`)
  }

  // Register tools with the WebDAV client
  registerCreateEvent(client, server)
  registerListEvents(client, server)
  registerDeleteEvent(client, server)
  await registerListCalendars(client, server)

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main()
